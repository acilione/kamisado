/**
 * Spectator Mode Integration Tests
 *
 * Tests:
 * 1. Third player joins as spectator
 * 2. Spectator receives game state updates
 * 3. Spectator cannot make moves
 * 4. Spectator reconnection works
 * 5. Spectator persists if player disconnects
 * 6. Spectator joins full game via direct link
 * 7. Spectator session restoration works
 *
 * Consolidated from: test_spectator.js + spectator tests from test_link_system.js
 */

import {
    createClient, createGame, joinGame, checkSession,
    test, assert, delay, exitWithStatus
} from './helpers.js';

console.log('=== Spectator Mode Tests ===\n');

async function runTests(): Promise<void> {

    await test('Third player joins as spectator', async () => {
        const p1Id = 'spec-p1-' + Date.now();
        const p2Id = 'spec-p2-' + Date.now();
        const p3Id = 'spec-p3-' + Date.now();

        const client1 = createClient();
        const client2 = createClient();
        const client3 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            const gameId = createRes.gameId;

            const joinRes2 = await joinGame(client2, gameId, p2Id);
            assert(!joinRes2.isSpectator, 'P2 should be a player, not spectator');

            const joinRes3 = await joinGame(client3, gameId, p3Id);
            assert(joinRes3.isSpectator === true, 'P3 should be a spectator');
            assert(joinRes3.gameState, 'P3 should receive gameState');
        } finally {
            client1.close();
            client2.close();
            client3.close();
        }
    });

    await test('Spectator receives game state updates', async () => {
        const p1Id = 'spec-upd-p1-' + Date.now();
        const p2Id = 'spec-upd-p2-' + Date.now();
        const p3Id = 'spec-upd-p3-' + Date.now();

        const client1 = createClient();
        const client2 = createClient();
        const client3 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            const gameId = createRes.gameId;

            await joinGame(client2, gameId, p2Id);
            const joinRes3 = await joinGame(client3, gameId, p3Id);
            assert(joinRes3.isSpectator === true, 'P3 should be a spectator');

            const updatePromise = new Promise<any>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Timeout waiting for update')), 3000);
                client3.on('gameStateUpdate', (state: any) => {
                    clearTimeout(timeout);
                    resolve(state);
                });
            });

            // P1 (black) makes a move
            client1.emit('makeMove', {
                gameId,
                move: { fromR: 0, fromC: 0, toR: 3, toC: 0 }
            });

            const state = await updatePromise;
            assert(state, 'Spectator should receive state update');
        } finally {
            client1.close();
            client2.close();
            client3.close();
        }
    });

    await test('Spectator cannot make moves', async () => {
        const p1Id = 'spec-mov-p1-' + Date.now();
        const p2Id = 'spec-mov-p2-' + Date.now();
        const p3Id = 'spec-mov-p3-' + Date.now();

        const client1 = createClient();
        const client2 = createClient();
        const client3 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            const gameId = createRes.gameId;

            await joinGame(client2, gameId, p2Id);
            await joinGame(client3, gameId, p3Id);

            let receivedUpdate = false;
            client3.on('gameStateUpdate', () => { receivedUpdate = true; });

            // Spectator tries to make a move (should be ignored)
            client3.emit('makeMove', {
                gameId,
                move: { fromR: 0, fromC: 0, toR: 3, toC: 0 }
            });

            await delay(500);

            // Board should be unchanged - spectator's move was ignored
            const session = await checkSession(client1, p1Id);
            assert(session.gameState.turn === 'black', 'Turn should still be black (spectator move ignored)');
        } finally {
            client1.close();
            client2.close();
            client3.close();
        }
    });

    await test('Spectator reconnection works', async () => {
        const p1Id = 'spec-rec-p1-' + Date.now();
        const p2Id = 'spec-rec-p2-' + Date.now();
        const p3Id = 'spec-rec-p3-' + Date.now();

        const client1 = createClient();
        const client2 = createClient();
        let client3 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            const gameId = createRes.gameId;

            await joinGame(client2, gameId, p2Id);
            await joinGame(client3, gameId, p3Id);

            // Disconnect spectator
            client3.close();
            await delay(200);

            // Reconnect spectator
            client3 = createClient();
            const session = await checkSession(client3, p3Id);

            assert(session.active === true, 'Spectator session should be active');
            assert(session.isSpectator === true, 'Should reconnect as spectator');
            assert(session.gameId === gameId, 'Should reconnect to same game');
        } finally {
            client1.close();
            client2.close();
            client3.close();
        }
    });

    await test('Spectator stays spectator if player disconnects', async () => {
        const p1Id = 'spec-pdis-p1-' + Date.now();
        const p2Id = 'spec-pdis-p2-' + Date.now();
        const p3Id = 'spec-pdis-p3-' + Date.now();

        const client1 = createClient();
        const client2 = createClient();
        const client3 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            const gameId = createRes.gameId;

            await joinGame(client2, gameId, p2Id);
            const joinRes3 = await joinGame(client3, gameId, p3Id);
            assert(joinRes3.isSpectator === true, 'P3 should be a spectator');

            // Player 2 disconnects
            client2.close();
            await delay(200);

            // Check spectator is still a spectator
            const session = await checkSession(client3, p3Id);
            assert(session.isSpectator === true, 'P3 should still be a spectator after P2 disconnects');
        } finally {
            client1.close();
            client2.close();
            client3.close();
        }
    });

    await test('Spectator joins full game via direct link', async () => {
        const p1Id = 'spec-link-p1-' + Date.now();
        const p2Id = 'spec-link-p2-' + Date.now();
        const p3Id = 'spec-link-p3-' + Date.now();

        const client1 = createClient();
        const client2 = createClient();
        const client3 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            const gameId = createRes.gameId;

            await joinGame(client2, gameId, p2Id);

            // P3 joins via direct link — should become spectator
            const joinRes3 = await joinGame(client3, gameId, p3Id);

            assert(joinRes3.success, 'Spectator join should succeed');
            assert(joinRes3.isSpectator === true, 'P3 should be spectator');
            assert(joinRes3.gameState, 'Spectator should receive game state');
        } finally {
            client1.close();
            client2.close();
            client3.close();
        }
    });

    await test('Spectator session restoration works', async () => {
        const p1Id = 'spec-restore-p1-' + Date.now();
        const p2Id = 'spec-restore-p2-' + Date.now();
        const p3Id = 'spec-restore-p3-' + Date.now();

        const client1 = createClient();
        const client2 = createClient();
        let client3 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            const gameId = createRes.gameId;

            await joinGame(client2, gameId, p2Id);
            await joinGame(client3, gameId, p3Id);

            // Reconnect spectator
            client3.close();
            await delay(200);

            client3 = createClient();
            const session = await checkSession(client3, p3Id);

            assert(session.active === true, 'Spectator session should be active');
            assert(session.isSpectator === true, 'Should restore as spectator');
            assert(session.gameId === gameId, 'Should restore to same game');
        } finally {
            client1.close();
            client2.close();
            client3.close();
        }
    });

    exitWithStatus();
}

runTests().catch(e => {
    console.error('Test runner error:', e);
    process.exit(1);
});
