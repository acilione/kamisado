import assert from 'assert';
import { createServer } from 'net';
import { io, type Socket } from 'socket.io-client';

import { setPublicOrigin, startServer, type RunningServer } from '../../src/server/index.js';
import type { ClientToServerEvents, ServerToClientEvents } from '../../src/shared/types.js';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

async function connect(port: number, transports = ['polling', 'websocket']): Promise<{ socket: GameSocket; config: { publicOrigin: string | null } }> {
    const socket: GameSocket = io(`http://127.0.0.1:${port}`, {
        autoConnect: false, reconnection: false, timeout: 3000, transports,
    });
    const config = await new Promise<{ publicOrigin: string | null }>((resolve, reject) => {
        socket.once('runtimeConfig', resolve);
        socket.once('connect_error', reject);
        socket.connect();
    });
    return { socket, config };
}

async function main(): Promise<void> {
    const occupied = createServer();
    await new Promise<void>(resolve => occupied.listen(0, '127.0.0.1', resolve));
    const occupiedPort = (occupied.address() as import('net').AddressInfo).port;
    await assert.rejects(() => startServer({ port: occupiedPort, host: '127.0.0.1' }), { code: 'EADDRINUSE' });
    await new Promise<void>(resolve => occupied.close(() => resolve()));

    setPublicOrigin('https://invite.example.test/path-is-discarded');
    let server: RunningServer | null = await startServer({ port: 0, host: '127.0.0.1' });
    const sockets: GameSocket[] = [];
    try {
        const baseUrl = `http://127.0.0.1:${server.port}`;
        const health = await fetch(`${baseUrl}/health`);
        assert.equal(health.status, 200);
        assert.deepEqual(await health.json(), { status: 'ok' });
        const config = await fetch(`${baseUrl}/runtime-config.js`);
        assert.equal(config.headers.get('cache-control'), 'no-store');
        assert.match(await config.text(), /https:\/\/invite\.example\.test/);

        const first = await connect(server.port);
        sockets.push(first.socket);
        assert.equal(first.config.publicOrigin, 'https://invite.example.test');
        const created = await first.socket.emitWithAck('createGame', {
            matchType: '1', timer: '60', colorMode: 'black', playerId: 'host-player',
        });
        assert.equal(created.success, true);
        const second = await connect(server.port, ['polling']);
        sockets.push(second.socket);
        const joined = await second.socket.emitWithAck('joinGame', { gameId: created.gameId!, playerId: 'guest-player' });
        assert.equal(joined.success, true);
        assert.equal(joined.gameState?.roundState, 'playing');

        const changed = new Promise<{ publicOrigin: string | null }>(resolve => first.socket.once('runtimeConfig', resolve));
        setPublicOrigin('https://new-invite.example.test');
        assert.deepEqual(await changed, { publicOrigin: 'https://new-invite.example.test' });
        assert.equal((await first.socket.emitWithAck('checkActiveSession', { playerId: 'host-player' })).active, true,
            'changing the invitation origin must preserve the running game');

        const computerPlayer = await connect(server.port);
        sockets.push(computerPlayer.socket);
        const computerMoved = new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Source-mode computer worker did not move')), 6000);
            computerPlayer.socket.on('gameStateUpdate', state => {
                if (state.turn === 'white' && state.requiredColor) {
                    clearTimeout(timeout);
                    resolve();
                }
            });
        });
        const solo = await computerPlayer.socket.emitWithAck('createGame', {
            matchType: '1', timer: '0', colorMode: 'white', playerId: 'computer-player', opponent: 'computer', aiLevel: 1,
        });
        assert.equal(solo.success, true);
        await computerMoved;
        await computerPlayer.socket.emitWithAck('leaveComputerGame', { gameId: solo.gameId! });
        const pendingSolo = await computerPlayer.socket.emitWithAck('createGame', {
            matchType: '1', timer: '0', colorMode: 'white', playerId: 'computer-player', opponent: 'computer', aiLevel: 10,
        });
        assert(pendingSolo.gameState?.computer?.thinking, 'Close is exercised while a worker is searching');

        const oldPort = server.port;
        const shutdownEvents: string[][] = [[], []];
        const disconnected = [first.socket, second.socket].map((socket, index) => {
            socket.on('hostStopped', () => shutdownEvents[index].push('hostStopped'));
            return new Promise<void>(resolve => socket.once('disconnect', () => {
                shutdownEvents[index].push('disconnect');
                resolve();
            }));
        });
        await Promise.all([server.close(), server.close(), ...disconnected]);
        assert.deepEqual(shutdownEvents, [
            ['hostStopped', 'disconnect'], ['hostStopped', 'disconnect'],
        ], 'Both normal and polling-only guests must learn hosting ended before disconnecting, exactly once');
        server = null;
        await assert.rejects(() => fetch(`${baseUrl}/health`), 'Stop must close the HTTP listener');
        assert.equal(second.socket.connected, false, 'Stop must disconnect guests');

        // The same port and the socket protocol must work again, with no old matches.
        server = await startServer({ port: oldPort, host: '127.0.0.1' });
        const restarted = await connect(server.port);
        sockets.push(restarted.socket);
        assert.deepEqual(restarted.config, { publicOrigin: null });
        assert.equal((await restarted.socket.emitWithAck('checkActiveSession', { playerId: 'host-player' })).active, false);
        assert.equal((await restarted.socket.emitWithAck('checkActiveSession', { playerId: 'computer-player' })).active, false);
        assert.equal((await restarted.socket.emitWithAck('joinGame', { gameId: created.gameId!, playerId: 'guest-player' })).success, false);
        assert.equal((await restarted.socket.emitWithAck('createGame', {
            matchType: '1', timer: '0', colorMode: 'black', playerId: 'host-player',
        })).success, true);
    } finally {
        // Closing while a lobby exists also exercises cleanup of its ten-minute timer.
        await server?.close();
        for (const socket of sockets) socket.close();
    }
    console.log('Server lifecycle tests passed: occupied port, live origins, disconnect, clean restart.');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
