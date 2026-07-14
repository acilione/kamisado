/**
 * Adversarial WebSocket tests for authorization, malformed input, and
 * connection lifecycle races that are easy to miss in browser-only testing.
 */

import {
    createClient, createGame, joinGame, checkSession, makeMove,
    test, assert, delay, exitWithStatus,
} from './helpers.js';

console.log('=== WebSocket Resilience Tests ===\n');

async function runTests(): Promise<void> {
    await test('Spectator cannot move the White pieces on White turn', async () => {
        const stamp = Date.now();
        const black = createClient();
        const white = createClient();
        const spectator = createClient();

        try {
            const created = await createGame(black, `spec-white-b-${stamp}`);
            await joinGame(white, created.gameId, `spec-white-w-${stamp}`);
            await joinGame(spectator, created.gameId, `spec-white-s-${stamp}`);

            await makeMove(black, created.gameId, { fromR: 0, fromC: 0, toR: 1, toC: 0 });
            spectator.emit('makeMove', {
                gameId: created.gameId,
                move: { fromR: 7, fromC: 2, toR: 6, toC: 2 },
            });
            await delay(150);

            const state = (await checkSession(black, `spec-white-b-${stamp}`)).gameState;
            assert(state.turn === 'white', 'Spectator move must not advance the turn');
            assert(state.board[7][2]?.player === 'white', 'White piece must remain at its source');
            assert(state.board[6][2] === null, 'Spectator must not mutate the board');
        } finally {
            black.close();
            white.close();
            spectator.close();
        }
    });

    await test('Spectator disconnect does not trigger a player countdown', async () => {
        const stamp = Date.now();
        const black = createClient();
        const white = createClient();
        const spectator = createClient();

        try {
            const created = await createGame(black, `spec-disc-b-${stamp}`);
            await joinGame(white, created.gameId, `spec-disc-w-${stamp}`);
            await joinGame(spectator, created.gameId, `spec-disc-s-${stamp}`);

            let disconnectEvents = 0;
            black.on('playerDisconnected', () => { disconnectEvents += 1; });
            spectator.close();
            await delay(300);

            assert(disconnectEvents === 0, 'Spectator disconnect must not look like a player disconnect');
            const state = await checkSession(black, `spec-disc-b-${stamp}`);
            assert(state.active === true, 'Game should remain active');
            assert(state.opponentDisconnected === false, 'Opponent should still be connected');
        } finally {
            black.close();
            white.close();
            spectator.close();
        }
    });

    await test('A taken-over socket can no longer mutate the game', async () => {
        const stamp = Date.now();
        const playerId = `takeover-b-${stamp}`;
        const oldBlack = createClient();
        const white = createClient();
        const newBlack = createClient();

        try {
            const created = await createGame(oldBlack, playerId);
            await joinGame(white, created.gameId, `takeover-w-${stamp}`);
            const restored = await checkSession(newBlack, playerId);
            assert(restored.active === true, 'Replacement socket should restore the session');

            oldBlack.emit('makeMove', {
                gameId: created.gameId,
                move: { fromR: 0, fromC: 0, toR: 1, toC: 0 },
            });
            await delay(150);

            const state = (await checkSession(newBlack, playerId)).gameState;
            assert(state.turn === 'black', 'Stale socket move must be ignored');
            assert(state.board[0][0]?.player === 'black', 'Board must remain unchanged');
        } finally {
            oldBlack.close();
            white.close();
            newBlack.close();
        }
    });

    await test('Malformed and out-of-range moves do not destabilize the socket server', async () => {
        const stamp = Date.now();
        const black = createClient();
        const white = createClient();

        try {
            const playerId = `malformed-b-${stamp}`;
            const created = await createGame(black, playerId);
            await joinGame(white, created.gameId, `malformed-w-${stamp}`);

            (black as any).emit('makeMove', null);
            black.emit('makeMove', {
                gameId: created.gameId,
                move: { fromR: 0, fromC: 0, toR: 99, toC: 0 },
            });
            await delay(100);

            await makeMove(black, created.gameId, { fromR: 0, fromC: 0, toR: 1, toC: 0 });
            const state = (await checkSession(black, playerId)).gameState;
            assert(state.turn === 'white', 'A valid move should still work after malformed input');
        } finally {
            black.close();
            white.close();
        }
    });

    await test('Game starting while creator is offline enters reconnect grace period', async () => {
        const stamp = Date.now();
        const creatorId = `offline-host-${stamp}`;
        const joinerId = `offline-join-${stamp}`;
        const creator = createClient();
        const joiner = createClient();
        let restoredCreator = createClient();

        try {
            const created = await createGame(creator, creatorId);
            creator.close();
            await delay(150);

            const disconnectEvent = new Promise<boolean>((resolve) => {
                const timeout = setTimeout(() => resolve(false), 2000);
                joiner.once('playerDisconnected', () => {
                    clearTimeout(timeout);
                    resolve(true);
                });
            });
            const joined = await joinGame(joiner, created.gameId, joinerId);

            assert(joined.gameState.roundState === 'playing', 'Game should start when both seats are assigned');
            assert(joined.opponentDisconnected === true, 'Join response should report offline creator');
            assert(await disconnectEvent, 'Joiner should receive the reconnect countdown event');

            const reconnected = new Promise<boolean>((resolve) => {
                const timeout = setTimeout(() => resolve(false), 2000);
                joiner.once('playerReconnected', () => {
                    clearTimeout(timeout);
                    resolve(true);
                });
            });
            const restored = await checkSession(restoredCreator, creatorId);
            assert(restored.active === true, 'Creator should restore the active game');
            assert(await reconnected, 'Joiner should be told that the creator retuned');
        } finally {
            creator.close();
            joiner.close();
            restoredCreator.close();
        }
    });

    await test('A completed match is finalized once and cannot be resumed', async () => {
        const stamp = Date.now();
        const blackId = `complete-b-${stamp}`;
        const black = createClient();
        const white = createClient();
        const lateVisitor = createClient();
        const sequence = [
            { fromR: 0, fromC: 5, toR: 4, toC: 5 },
            { fromR: 7, fromC: 6, toR: 1, toC: 6 },
            { fromR: 0, fromC: 7, toR: 6, toC: 7 },
            { fromR: 7, fromC: 2, toR: 6, toC: 3 },
            { fromR: 0, fromC: 1, toR: 3, toC: 1 },
            { fromR: 7, fromC: 5, toR: 6, toC: 6 },
            { fromR: 0, fromC: 0, toR: 3, toC: 0 },
            { fromR: 7, fromC: 4, toR: 4, toC: 7 },
            { fromR: 0, fromC: 3, toR: 1, toC: 2 },
            { fromR: 4, fromC: 7, toR: 3, toC: 7 },
            { fromR: 0, fromC: 4, toR: 2, toC: 4 },
            { fromR: 6, fromC: 6, toR: 2, toC: 2 },
            { fromR: 3, fromC: 0, toR: 5, toC: 0 },
            { fromR: 1, fromC: 6, toR: 0, toC: 5 },
        ];

        try {
            const created = await createGame(black, blackId, { matchType: '1' });
            await joinGame(white, created.gameId, `complete-w-${stamp}`);

            const ended = new Promise<{ reason: string; winner: string }>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Timed out waiting for match completion')), 5000);
                black.once('gameEnded', data => {
                    clearTimeout(timeout);
                    resolve(data);
                });
            });

            for (let index = 0; index < sequence.length; index += 1) {
                const client = index % 2 === 0 ? black : white;
                await makeMove(client, created.gameId, sequence[index]);
            }

            const result = await ended;
            assert(result.reason === 'match_complete', `Unexpected end reason: ${result.reason}`);
            assert(result.winner === 'white', `Expected White winner, got ${result.winner}`);
            assert((await checkSession(black, blackId)).active === false, 'Finished session must not restore');

            let rejected = false;
            try {
                await joinGame(lateVisitor, created.gameId, `complete-late-${stamp}`);
            } catch (error: any) {
                rejected = error.message.includes('ended');
            }
            assert(rejected, 'Finished game must reject later joins');
        } finally {
            black.close();
            white.close();
            lateVisitor.close();
        }
    });

    exitWithStatus();
}

runTests().catch((error) => {
    console.error('Test runner error:', error);
    process.exit(1);
});
