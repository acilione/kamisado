/**
 * Link System, Game Flow & Cancel Integration Tests
 *
 * Tests cover:
 * 1. Direct link joining (URL-based game join)
 * 2. Game start flow
 * 3. Move update delivery
 * 4. Cancel game behavior
 *
 * Converted from: test_link_system.js (with spectator/session tests moved to
 * test_spectator.ts and test_reconnection.ts)
 */

import {
    createClient, createGame, joinGame, checkSession, cancelGame,
    test, assert, delay, makeMove, exitWithStatus
} from './helpers.js';

console.log('=== Link System, Game Flow & Cancel Tests ===\n');

async function runTests(): Promise<void> {

    // --- Link System ---

    console.log('\n--- Link System ---\n');

    await test('Direct link join: new player joins game via gameId', async () => {
        const p1Id = 'link-p1-' + Date.now();
        const p2Id = 'link-p2-' + Date.now();

        const client1 = createClient();
        const client2 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            const gameId = createRes.gameId;

            const joinRes = await joinGame(client2, gameId, p2Id);

            assert(joinRes.success, 'Join should succeed');
            assert(joinRes.gameId === gameId, 'Should join correct game');
            assert(joinRes.color === 'white', 'P2 should be white');
            assert(!joinRes.isSpectator, 'P2 should be player, not spectator');
        } finally {
            client1.close();
            client2.close();
        }
    });

    // --- Game Flow ---

    console.log('\n--- Game Flow ---\n');

    await test('Game starts when both players join', async () => {
        const p1Id = 'flow-start-p1-' + Date.now();
        const p2Id = 'flow-start-p2-' + Date.now();

        const client1 = createClient();
        const client2 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            const gameId = createRes.gameId;

            assert(createRes.gameState.roundState === 'waiting_start', 'Should wait for opponent');

            const stateUpdatePromise = new Promise<any>((resolve) => {
                client1.on('gameStateUpdate', resolve);
            });

            await joinGame(client2, gameId, p2Id);

            const state = await stateUpdatePromise;
            assert(state.roundState === 'playing', 'Game should start playing');
            assert(state.turn === 'black', 'Black should move first');
        } finally {
            client1.close();
            client2.close();
        }
    });

    await test('Player receives gameStateUpdate on move', async () => {
        const p1Id = 'move-update-p1-' + Date.now();
        const p2Id = 'move-update-p2-' + Date.now();

        const client1 = createClient();
        const client2 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            const gameId = createRes.gameId;

            // Wait for game start
            const gameStartPromise = new Promise<void>((resolve) => {
                client1.on('gameStateUpdate', (state: any) => {
                    if (state.roundState === 'playing') resolve();
                });
            });

            await joinGame(client2, gameId, p2Id);
            await gameStartPromise;

            // P2 should receive update when P1 moves
            const p2UpdatePromise = new Promise<any>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Timeout')), 2000);
                client2.on('gameStateUpdate', (state: any) => {
                    clearTimeout(timeout);
                    resolve(state);
                });
            });

            await makeMove(client1, gameId, { fromR: 0, fromC: 0, toR: 3, toC: 0 });

            const updateState = await p2UpdatePromise;
            assert(updateState, 'P2 should receive state update');
        } finally {
            client1.close();
            client2.close();
        }
    });

    // --- Cancel Game ---

    console.log('\n--- Cancel Game ---\n');

    await test('Creator can cancel game in lobby', async () => {
        const p1Id = 'cancel-lobby-' + Date.now();

        const client1 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            const gameId = createRes.gameId;

            const cancelRes = await cancelGame(client1, gameId);
            assert(cancelRes.success, 'Cancel should succeed');

            // Verify game is gone
            const session = await checkSession(client1, p1Id);
            assert(!session.active, 'Session should no longer be active');
        } finally {
            client1.close();
        }
    });

    await test('Cannot cancel game after it starts', async () => {
        const p1Id = 'cancel-started-p1-' + Date.now();
        const p2Id = 'cancel-started-p2-' + Date.now();

        const client1 = createClient();
        const client2 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            const gameId = createRes.gameId;

            await joinGame(client2, gameId, p2Id);
            await delay(100);

            const cancelRes = await cancelGame(client1, gameId);
            assert(!cancelRes.success, 'Cancel should fail after game starts');
        } finally {
            client1.close();
            client2.close();
        }
    });

    exitWithStatus();
}

runTests().catch(e => {
    console.error('Test runner error:', e);
    process.exit(1);
});
