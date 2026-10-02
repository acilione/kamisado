const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer } = require('../../dist/server/index.js');

function cell(row, column) {
  return `#board .cell[data-r="${row}"][data-c="${column}"]`;
}

async function move(page, fromRow, fromColumn, toRow, toColumn) {
  await page.locator(cell(fromRow, fromColumn) + ' .piece.playable').waitFor();
  await page.locator(cell(fromRow, fromColumn)).click();
  await page.locator(cell(toRow, toColumn)).click();
}

async function boardPosition(page) {
  return page.locator('#board .piece').evaluateAll(pieces => pieces.map(piece => ({
    row: Number(piece.parentElement.dataset.r), column: Number(piece.parentElement.dataset.c),
    player: piece.classList.contains('black') ? 'black' : 'white', color: piece.dataset.color,
    rank: piece.querySelector('.sumo-rank')?.textContent || '0',
  })).sort((a, b) => a.row - b.row || a.column - b.column));
}

async function run() {
  let server = await startServer({ port: 0, host: '127.0.0.1' });
  const origin = `http://127.0.0.1:${server.port}`;
  const screenshots = path.resolve(__dirname, '../../out/p2p-checks');
  await fs.mkdir(screenshots, { recursive: true });
  let browser;
  try {
    browser = await chromium.launch({ headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    });
    const hostContext = await browser.newContext({ viewport: { width: 1000, height: 1100 } });
    const guestContext = await browser.newContext({ viewport: { width: 1000, height: 1100 } });
    for (const context of [hostContext, guestContext]) {
      await context.addInitScript(() => {
        // Use real peer connections and data channels, with local ICE candidates.
        // Public STUN reliability is not a dependency of this deterministic test.
        const NativeConnection = window.RTCPeerConnection;
        window.__peerConnections = [];
        window.RTCPeerConnection = class extends NativeConnection {
          constructor(configuration) {
            super({ ...configuration, iceServers: [] });
            window.__peerConnections.push(this);
          }
        };
      });
    }
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    const errors = [];
    const expectedDialogs = [];
    const guestSocketRequests = [];
    for (const [label, page] of [['host', host], ['guest', guest]]) {
      page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(`${label}: ${error.message}`));
      page.on('dialog', async dialog => {
        const actual = `${label}: ${dialog.type()}: ${dialog.message()}`;
        if (actual === expectedDialogs[0]) expectedDialogs.shift();
        else errors.push(actual);
        await dialog.accept();
      });
    }
    guest.on('request', request => {
      if (/\/socket\.io\/(?:\?|$)/.test(request.url())) guestSocketRequests.push(request.url());
    });
    guest.on('websocket', socket => {
      if (/\/socket\.io\//.test(socket.url())) guestSocketRequests.push(socket.url());
    });
    await Promise.all([host.goto(origin + '/?peer=host'), guest.goto(origin + '/?peer=guest')]);
    await host.locator('#peer-panel').waitFor();
    await guest.locator('#peer-panel').waitFor();
    assert.equal(await host.locator('#peer-generate').isDisabled(), true, 'The host must create a room before generating an invitation');
    assert.equal(await guest.locator('#peer-generate').isDisabled(), true, 'The guest must paste an invitation first');
    assert.equal(await guest.locator('#create-btn').isVisible(), false, 'A P2P guest joins the offered room and cannot create another room');
    assert.equal(await guest.locator('#join-btn').isVisible(), false, 'A P2P guest cannot join a different room by ID');

    await guest.locator('#peer-incoming').fill('this is not an invitation');
    await guest.locator('#peer-generate').click();
    await guest.waitForFunction(() => /invalid|invitation|code|paste/i.test(document.getElementById('peer-status').textContent)
      && !document.getElementById('peer-generate').disabled);
    assert.equal(await guest.locator('#peer-outgoing').inputValue(), '', 'Malformed invitations must not produce a reply');
    assert.deepEqual(guestSocketRequests, [], 'An unconnected P2P guest must not open Socket.IO');

    await host.locator('#color-mode').selectOption('black');
    await host.locator('#match-type').selectOption('3');
    await host.locator('#timer').selectOption('600');
    await host.locator('#position-mode').selectOption('standard');

    // Cancelling an unjoined room must close its transport and clear its codes,
    // while leaving the same page ready to create a different peer game.
    await host.locator('#create-btn').click();
    await host.locator('#game-screen').waitFor();
    const cancelledRoomPath = new URL(host.url()).pathname;
    await host.locator('#peer-generate').click();
    await host.waitForFunction(() => document.getElementById('peer-outgoing').value.length > 100);
    const cancelledOffer = await host.locator('#peer-outgoing').inputValue();
    expectedDialogs.push(
      'host: confirm: Are you sure you want to cancel the lobby?',
      'host: alert: Lobby has expired or was cancelled.',
    );
    await host.locator('#cancel-game-btn').click();
    await host.locator('#menu-screen').waitFor();
    assert.equal(await host.locator('#game-screen').isVisible(), false);
    assert.equal(new URL(host.url()).searchParams.get('peer'), 'host', 'Cancelling must preserve Internet hosting mode');
    assert.equal(await host.locator('#peer-outgoing').inputValue(), '');
    assert.equal(await host.locator('#peer-incoming').inputValue(), '');
    assert.equal(await host.locator('#peer-generate').isDisabled(), true);
    assert.equal(await host.evaluate(() => window.__peerConnections.every(connection => connection.connectionState === 'closed')), true);
    assert.deepEqual(expectedDialogs, []);

    await host.locator('#create-btn').click();
    await host.locator('#game-screen').waitFor();
    assert.notEqual(new URL(host.url()).pathname, cancelledRoomPath);
    assert.equal(await host.locator('#invite-panel').isVisible(), false, 'P2P must share codes, not an unreachable localhost URL');
    await host.locator('#peer-generate').click();
    await host.waitForFunction(() => document.getElementById('peer-outgoing').value.length > 100);
    const offer = await host.locator('#peer-outgoing').inputValue();
    assert.notEqual(offer, cancelledOffer, 'A replacement room needs a fresh invitation');
    assert.equal(await host.locator('#peer-outgoing').getAttribute('readonly'), '');
    await guest.locator('#peer-incoming').fill(offer);
    await guest.locator('#peer-generate').click();
    await guest.waitForFunction(() => document.getElementById('peer-outgoing').value.length > 100);
    const answer = await guest.locator('#peer-outgoing').inputValue();
    assert.notEqual(answer, offer);

    await host.locator('#peer-incoming').fill('not a reply code');
    await host.locator('#peer-connect').click();
    await host.waitForFunction(() => /invalid|reply|code|paste/i.test(document.getElementById('peer-status').textContent)
      && !document.getElementById('peer-connect').disabled);
    await host.locator('#peer-incoming').fill(answer);
    await host.locator('#peer-connect').click();
    await guest.locator('#game-screen').waitFor();
    await Promise.all([host, guest].map(page => page.waitForFunction(() =>
      document.getElementById('turn-indicator').textContent.includes('Turn: BLACK'))));
    assert.equal(await guest.locator('#invite-panel').isVisible(), false);
    assert.equal(await host.locator('#peer-panel').getAttribute('open'), null, 'Connected games should collapse the setup codes');
    assert.equal(await guest.locator('#peer-panel').getAttribute('open'), null);
    assert.deepEqual(await boardPosition(host), await boardPosition(guest));
    assert.equal(await guest.locator('#timer-container').isVisible(), true, 'Game clocks must reach the peer guest');

    await move(host, 0, 0, 1, 0); // Red destination forces the guest's red tower.
    await guest.locator(cell(1, 0) + ' .piece.black.orange').waitFor();
    assert.match(await guest.locator('#turn-indicator').textContent(), /WHITE.*RED/);
    await move(guest, 7, 2, 6, 2); // Yellow destination forces the host's yellow tower.
    await host.locator(cell(6, 2) + ' .piece.white.red').waitFor();
    assert.match(await host.locator('#turn-indicator').textContent(), /BLACK.*YELLOW/);
    await move(host, 0, 4, 1, 4);
    await guest.locator(cell(1, 4) + ' .piece.black.yellow').waitFor();
    await move(guest, 7, 6, 6, 6);
    await host.locator(cell(6, 6) + ' .piece.white.blue').waitFor();
    assert.deepEqual(await boardPosition(host), await boardPosition(guest), 'Both peers must see the same authoritative board after each side moves');

    await guest.locator('#game-symbol-mode').check();
    assert.equal(await guest.locator('#board .square-symbol').count(), 128);
    await guest.screenshot({ path: path.join(screenshots, 'peer-symbol-board.png'), fullPage: true });
    await guest.locator('#game-board-view').selectOption('realistic-3d');
    await guest.locator('#board-3d canvas:visible, #board:visible .realistic-tower').first().waitFor();
    await guest.locator('#game-board-view').selectOption('realistic-2d');
    assert.deepEqual(await boardPosition(host), await boardPosition(guest));
    assert.deepEqual(guestSocketRequests, [], 'All guest game traffic must cross WebRTC; loading the static Socket.IO script is harmless');

    // Keep the guest's existing document alive after the host app stops. A new
    // invitation must clear the previous hostStopped state and join the new
    // host's room, even though the guest's static page came from the old server.
    const previousRoomPath = new URL(host.url()).pathname;
    await guest.evaluate(() => { window.__sameGuestDocument = true; });
    await server.close();
    await guest.waitForFunction(() => document.getElementById('connection-notice').textContent ===
      'The host stopped this game. Ask them for a new invitation.');
    assert.equal(await guest.locator('#turn-indicator').textContent(), 'Game stopped');
    server = await startServer({ port: 0, host: '127.0.0.1' });
    const restartedOrigin = `http://127.0.0.1:${server.port}`;
    await host.goto(restartedOrigin + '/?peer=host');
    await host.locator('#color-mode').selectOption('black');
    await host.locator('#timer').selectOption('600');
    await host.locator('#create-btn').click();
    await host.locator('#game-screen').waitFor();
    const restartedRoomPath = new URL(host.url()).pathname;
    assert.notEqual(restartedRoomPath, previousRoomPath);
    await host.locator('#peer-generate').click();
    await host.waitForFunction(() => document.getElementById('peer-outgoing').value.length > 100);
    const restartedOffer = await host.locator('#peer-outgoing').inputValue();
    await guest.waitForFunction(() => document.getElementById('peer-panel').open
      && !document.getElementById('peer-generate').disabled);
    await guest.locator('#peer-incoming').fill(restartedOffer);
    await guest.locator('#peer-generate').click();
    await guest.waitForFunction(previousAnswer => {
      const value = document.getElementById('peer-outgoing').value;
      return value.length > 100 && value !== previousAnswer;
    }, answer);
    await host.locator('#peer-incoming').fill(await guest.locator('#peer-outgoing').inputValue());
    await host.locator('#peer-connect').click();
    await guest.waitForFunction(roomPath => location.pathname === roomPath
      && document.getElementById('turn-indicator').textContent.includes('Turn: BLACK'), restartedRoomPath);
    assert.equal(await guest.evaluate(() => window.__sameGuestDocument), true, 'Rejoining must work without reloading the guest page');
    assert.equal(new URL(guest.url()).origin, origin, 'The guest document stays on its original local server origin');
    assert.equal(await guest.locator('#connection-notice').isVisible(), false);
    assert.deepEqual(await boardPosition(host), await boardPosition(guest));
    await move(host, 0, 0, 1, 0);
    await guest.locator(cell(1, 0) + ' .piece.black.orange').waitFor();
    await move(guest, 7, 2, 6, 2);
    await host.locator(cell(6, 2) + ' .piece.white.red').waitFor();
    assert.deepEqual(await boardPosition(host), await boardPosition(guest), 'The new peer session must carry moves in both directions');
    assert.deepEqual(guestSocketRequests, [], 'Rejoining a restarted host must still use only the peer transport');

    const positionBeforeDisconnect = await boardPosition(host);
    await guestContext.close();
    try {
      await host.waitForFunction(() => document.getElementById('peer-panel').open
        && /disconnect|closed|lost|new invitation|interrupted|failed|timed out/i.test(document.getElementById('peer-status').textContent));
    } catch (error) {
      console.error('Host disconnect state:', await host.evaluate(() => ({
        open: document.getElementById('peer-panel').open,
        message: document.getElementById('peer-status').textContent,
        connections: window.__peerConnections.map(peer => ({ connection: peer.connectionState, ice: peer.iceConnectionState })),
      })));
      await host.screenshot({ path: path.join(screenshots, 'peer-disconnect-failure.png'), fullPage: true });
      throw error;
    }
    assert.equal(await host.locator('#game-screen').isVisible(), true);
    assert.deepEqual(await boardPosition(host), positionBeforeDisconnect, 'Losing the peer must keep the host board visible for reconnecting');
    await host.setViewportSize({ width: 320, height: 740 });
    assert.equal(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Invitation codes and recovery controls must fit a narrow window');
    await host.screenshot({ path: path.join(screenshots, 'peer-reconnect-mobile.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('P2P browser checks passed: lobby cancellation, real WebRTC offer/reply, malformed-code recovery, guest transport isolation, bidirectional moves, host restart with the same guest page, clocks, both views, symbols, and disconnect guidance.');
  } catch (error) {
    console.error('P2P browser failure before cleanup:', error);
    throw error;
  } finally {
    const closing = server.close();
    await browser?.close();
    await closing;
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
