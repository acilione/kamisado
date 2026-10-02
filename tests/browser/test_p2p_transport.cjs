'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { chromium } = require('playwright');
const { io } = require('socket.io-client');
const esbuild = require('esbuild');
const { startServer } = require('../../dist/server/index.js');

const root = path.resolve(__dirname, '../..');
const bundle = esbuild.buildSync({
    entryPoints: [path.join(root, 'src/client/p2p-transport.ts')], bundle: true,
    write: false, platform: 'browser', format: 'iife', globalName: 'KamisadoPeer', target: 'es2020',
}).outputFiles[0].text;

async function until(check, message, timeout = 10000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const value = await check();
        if (value) return value;
        await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error(`Timed out: ${message}`);
}

function acknowledged(socket, event, data) {
    return new Promise((resolve, reject) => socket.timeout(5000).emit(event, data, (error, response) => error ? reject(error) : resolve(response)));
}

async function browserRequest(page, event, data, timed = false) {
    return page.evaluate(({ event, data, timed }) => new Promise(resolve => {
        const socket = window.peer.getGuestSocket();
        if (timed) socket.timeout(1000).emit(event, data, (error, value) => resolve({ error: error?.message || null, value }));
        else socket.emit(event, data, resolve);
    }), { event, data, timed });
}

function mutateCode(code, update) {
    const prefix = 'KAMISADO1.';
    const value = JSON.parse(Buffer.from(code.slice(prefix.length), 'base64url').toString('utf8'));
    update(value);
    return prefix + Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function installTransport(page, role, options = {}) {
    await page.addScriptTag({ content: bundle });
    await page.evaluate(({ role, options }) => {
        window.peer = new KamisadoPeer.P2pTransport(role, { iceServers: [], ...options });
        window.statuses = [];
        window.events = [];
        window.connections = 0;
        window.peer.onStatus(status => window.statuses.push(status));
        const socket = window.peer.getGuestSocket();
        socket.on('connect', () => { window.connections++; });
        for (const event of ['gameStateUpdate', 'playerDisconnected', 'playerReconnected', 'hostStopped', 'disconnect', 'error']) {
            socket.on(event, data => window.events.push({ event, data }));
        }
    }, { role, options });
}

async function pair(host, guest, gameId) {
    const offer = await host.evaluate(gameId => window.peer.createOffer(gameId), gameId);
    const answer = await guest.evaluate(code => window.peer.acceptOffer(code), offer);
    await host.evaluate(code => window.peer.acceptAnswer(code), answer);
    await guest.waitForFunction(() => window.peer.getGuestSocket().connected);
    await host.waitForFunction(() => window.statuses.at(-1).state === 'connected');
    return { offer, answer };
}

async function run() {
    const server = await startServer({ port: 0, host: '127.0.0.1' });
    const origin = `http://127.0.0.1:${server.port}`;
    // The guest loads its own local application. It never contacts the host's
    // HTTP or Socket.IO endpoint; only the WebRTC data channel crosses peers.
    const guestServer = http.createServer((_request, response) => response.end('Local guest app'));
    await new Promise(resolve => guestServer.listen(0, '127.0.0.1', resolve));
    const guestOrigin = `http://127.0.0.1:${guestServer.address().port}`;
    const socketScript = await fs.readFile(path.join(root, 'node_modules/socket.io/client-dist/socket.io.js'), 'utf8');
    const hostPlayerId = randomUUID();
    const owner = io(origin, { transports: ['websocket'], reconnection: false });
    let browser;
    let stopped = false;
    const errors = [];
    const ownerEvents = [];
    owner.onAny((event, data) => ownerEvents.push({ event, data }));
    try {
        await until(() => owner.connected, 'host socket connection');
        const created = await acknowledged(owner, 'createGame', {
            playerId: hostPlayerId, matchType: '1', timer: '0', colorMode: 'black', positionMode: 'standard',
        });
        assert.equal(created.success, true);
        const gameId = created.gameId;
        browser = await chromium.launch({ headless: true,
            ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
        });
        const hostContext = await browser.newContext();
        const guestContext = await browser.newContext();
        for (const context of [hostContext, guestContext]) {
            await context.route('**/peer-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><script src="/socket.io/socket.io.js"></script>' }));
            await context.route('**/socket.io/socket.io.js', route => route.fulfill({ contentType: 'application/javascript', body: socketScript }));
            context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
        }
        const host = await hostContext.newPage();
        const guest = await guestContext.newPage();
        host.setDefaultTimeout(10000);
        guest.setDefaultTimeout(10000);
        const guestRequests = [];
        const guestWebSockets = [];
        guest.on('request', request => guestRequests.push(request.url()));
        guest.on('websocket', socket => guestWebSockets.push(socket.url()));
        await Promise.all([host.goto(origin + '/peer-test'), guest.goto(guestOrigin + '/peer-test')]);
        await Promise.all([installTransport(host, 'host'), installTransport(guest, 'guest')]);

        const callbackOrder = await guest.evaluate(gameId => {
            const order = [];
            const socket = new KamisadoPeer.P2pSocket({ sendRequest: () => true });
            socket.on('disconnect', () => order.push('disconnect'));
            socket.setConnected(true);
            socket.emit('joinGame', { gameId, playerId: 'test-player' }, () => order.push('pending-join'));
            socket.setConnected(false);
            return order;
        }, gameId);
        assert.deepEqual(callbackOrder, ['disconnect', 'pending-join'], 'disconnect must invalidate UI generations before pending join callbacks fail');

        console.log('Peer transport: real WebRTC offer/reply exchange and local server readiness');
        await assert.rejects(() => guest.evaluate(() => window.peer.acceptOffer('not-a-code')), /complete Kamisado/);
        assert.equal(await guest.evaluate(() => window.peer.gameId), null);
        const offer = await host.evaluate(gameId => window.peer.createOffer(gameId), gameId);
        assert.ok(offer.length < 65536);
        assert.equal(await host.evaluate(() => window.statuses.at(-1).state), 'waiting-answer');
        const wrappedOffer = '  ' + offer.match(/.{1,80}/g).join('\r\n ') + '\t';
        const answer = await guest.evaluate(code => window.peer.acceptOffer(code), wrappedOffer);
        const stale = mutateCode(answer, value => { value.sessionId = randomUUID(); });
        await assert.rejects(() => host.evaluate(code => window.peer.acceptAnswer(code), stale), /does not match/);
        assert.equal(await host.evaluate(() => window.statuses.at(-1).state), 'waiting-answer');
        await host.evaluate(code => window.peer.acceptAnswer(code), answer);
        await guest.waitForFunction(() => window.peer.getGuestSocket().connected);
        assert.equal(await guest.evaluate(() => window.connections), 1);
        assert.equal(await guest.evaluate(() => window.peer.gameId), gameId);
        assert.equal(await host.evaluate(() => window.peer.proxy.connected), true, 'guest connect must wait until the host-side Socket.IO proxy is connected');

        console.log('Peer transport: malformed signaling preserves an existing working connection');
        await assert.rejects(() => guest.evaluate(() => window.peer.acceptOffer('KAMISADO1.' + 'A'.repeat(65536))), /too long/);
        const invalidSdp = mutateCode(offer, value => { value.sdp = 'v=0\r\nm=application invalid\r\n'; });
        await assert.rejects(() => guest.evaluate(code => window.peer.acceptOffer(code), invalidSdp), /could not be read/);
        assert.equal(await guest.evaluate(() => window.peer.getGuestSocket().connected), true);

        console.log('Peer transport: scoped invitations, protected host identity, typed acknowledgements');
        const check = await browserRequest(guest, 'checkActiveSession', { playerId: hostPlayerId }, true);
        assert.equal(check.error, null);
        assert.equal(check.value.active, false, 'a guest must never claim the host player ID');
        const wrongGame = await browserRequest(guest, 'joinGame', { gameId: '000000000000', playerId: hostPlayerId });
        assert.equal(wrongGame.success, false);
        assert.match(wrongGame.message, /own game/);
        const denied = await browserRequest(guest, 'createGame', { playerId: hostPlayerId });
        assert.equal(denied.success, false, 'guests cannot create unrelated games through the proxy');
        const joined = await browserRequest(guest, 'joinGame', { gameId, playerId: hostPlayerId });
        assert.equal(joined.success, true);
        assert.equal(joined.color, 'white');
        assert.notEqual(joined.isSpectator, true);
        assert.equal(joined.gameState.roundState, 'playing');
        assert.equal(owner.connected, true);
        assert.ok(!ownerEvents.some(event => event.event === 'sessionTakenOver'));

        console.log('Peer transport: both players move through authoritative game rules');
        owner.emit('makeMove', { gameId, move: { fromR: 0, fromC: 0, toR: 1, toC: 0 } });
        await guest.waitForFunction(() => window.events.some(({ event, data }) => event === 'gameStateUpdate' && data.board[1][0]?.player === 'black'));
        const afterBlack = await guest.evaluate(() => window.events.filter(({ event }) => event === 'gameStateUpdate').at(-1).data);
        const white = afterBlack.board.flat().find(piece => piece?.player === 'white' && piece.color === afterBlack.requiredColor);
        assert.ok(white);
        await guest.evaluate(({ gameId, white }) => window.peer.getGuestSocket().emit('makeMove', {
            gameId, move: { fromR: white.r, fromC: white.c, toR: white.r - 1, toC: white.c },
        }), { gameId, white });
        await until(() => ownerEvents.some(({ event, data }) => event === 'gameStateUpdate' && data.board[6][white.c]?.player === 'white'), 'peer move delivered to original host');
        assert.ok(guestRequests.every(url => new URL(url).origin === guestOrigin), 'guest HTTP requests must stay on its own application origin');
        assert.deepEqual(guestWebSockets, [], 'guest must not open a direct Socket.IO/WebSocket connection to the host');

        console.log('Peer transport: close releases proxy and reconnect reclaims the existing seat');
        await guest.evaluate(() => window.peer.close());
        await until(() => ownerEvents.some(({ event }) => event === 'playerDisconnected'), 'server observes peer departure');
        await host.waitForFunction(() => window.peer.proxy === null);
        assert.equal(owner.connected, true, 'closing the guest must preserve the owner connection');
        await pair(host, guest, gameId);
        const restored = await browserRequest(guest, 'checkActiveSession', { playerId: 'different-browser-id' });
        assert.equal(restored.active, true);
        assert.equal(restored.gameId, gameId);
        assert.equal(restored.color, 'white');
        assert.notEqual(restored.isSpectator, true);

        console.log('Peer transport: host-page reload preserves the secret seat identity');
        await host.reload();
        await guest.waitForFunction(() => !window.peer.getGuestSocket().connected);
        await installTransport(host, 'host');
        await pair(host, guest, gameId);
        const afterReload = await browserRequest(guest, 'checkActiveSession', { playerId: hostPlayerId });
        assert.equal(afterReload.active, true);
        assert.equal(afterReload.color, 'white');
        assert.notEqual(afterReload.isSpectator, true);

        console.log('Peer transport: unrecognized RPC and oversized frames are rejected');
        await guest.evaluate(() => window.peer.channel.send(JSON.stringify({ kind: 'request', event: '__proto__', data: {} })));
        await host.waitForFunction(() => window.statuses.at(-1).state === 'error');
        assert.match(await host.evaluate(() => window.statuses.at(-1).message), /unsupported game request/);
        assert.equal(owner.connected, true);
        await pair(host, guest, gameId);
        await guest.evaluate(() => window.peer.channel.send('x'.repeat(65537)));
        await host.waitForFunction(() => window.statuses.at(-1).state === 'error');
        assert.match(await host.evaluate(() => window.statuses.at(-1).message), /invalid message/);

        console.log('Peer transport: message floods are bounded');
        await pair(host, guest, gameId);
        await guest.evaluate(() => {
            for (let i = 0; i < 101; i++) window.peer.channel.send(JSON.stringify({ kind: 'ready-request' }));
        });
        await host.waitForFunction(() => window.statuses.at(-1).state === 'error');
        assert.match(await host.evaluate(() => window.statuses.at(-1).message), /too many messages/);

        console.log('Peer transport: cancellation and unanswered attempts finish within their deadlines');
        await host.evaluate(async gameId => {
            const promise = window.peer.createOffer(gameId);
            window.peer.close();
            try { await promise; throw new Error('Cancelled offer unexpectedly completed'); }
            catch (error) { if (error.message === 'Cancelled offer unexpectedly completed') throw error; }
        }, gameId);
        assert.equal(await host.evaluate(() => window.statuses.at(-1).state), 'closed');
        await guest.evaluate(() => window.peer.close());
        await installTransport(guest, 'guest', { exchangeTimeoutMs: 150 });
        const unanswered = await host.evaluate(gameId => window.peer.createOffer(gameId), gameId);
        await guest.evaluate(code => window.peer.acceptOffer(code), unanswered);
        await guest.waitForFunction(() => window.statuses.at(-1).state === 'error');
        assert.match(await guest.evaluate(() => window.statuses.at(-1).message), /expired/);

        console.log('Peer transport: wait 36 seconds before pasting reply to verify native ICE stays usable');
        await installTransport(guest, 'guest', { connectionTimeoutMs: 1000 });
        const delayedOffer = await host.evaluate(gameId => window.peer.createOffer(gameId), gameId);
        const delayedAnswer = await guest.evaluate(code => window.peer.acceptOffer(code), delayedOffer);
        await new Promise(resolve => setTimeout(resolve, 36000));
        assert.equal(await guest.evaluate(() => window.statuses.at(-1).state), 'connecting');
        await host.evaluate(code => window.peer.acceptAnswer(code), delayedAnswer);
        await guest.waitForFunction(() => window.peer.getGuestSocket().connected);
        await guest.evaluate(() => window.peer.close());
        await host.evaluate(() => window.peer.close());

        console.log('Peer transport: actual connection attempts have a separate bounded timeout');
        await installTransport(host, 'host', { connectionTimeoutMs: 150 });
        await installTransport(guest, 'guest');
        const timeoutOffer = await host.evaluate(gameId => window.peer.createOffer(gameId), gameId);
        const timeoutAnswer = await guest.evaluate(code => window.peer.acceptOffer(code), timeoutOffer);
        await guest.evaluate(() => window.peer.close());
        await host.evaluate(code => window.peer.acceptAnswer(code), timeoutAnswer);
        await host.waitForFunction(() => window.statuses.at(-1).state === 'error');
        assert.match(await host.evaluate(() => window.statuses.at(-1).message), /timed out/);

        console.log('Peer transport: host shutdown reaches the remote guest');
        await installTransport(host, 'host');
        await installTransport(guest, 'guest');
        await pair(host, guest, gameId);
        await browserRequest(guest, 'checkActiveSession', { playerId: hostPlayerId });
        await server.close();
        stopped = true;
        await guest.waitForFunction(() => window.events.some(({ event }) => event === 'hostStopped'));
        assert.deepEqual(errors, []);
        await Promise.all([host.evaluate(() => window.peer.close()), guest.evaluate(() => window.peer.close())]);
        console.log('P2P transport checks passed: real WebRTC, manual signaling, scoped proxy, authoritative moves, offline asset origins, reconnection, protocol bounds, deadlines, and shutdown.');
    } finally {
        owner.disconnect();
        await browser?.close();
        await new Promise(resolve => guestServer.close(resolve));
        if (!stopped) await server.close();
    }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
