/**
 * Basic Game Flow Integration Tests
 *
 * Covers: game creation, joining, move exchange, cancel, and timer response.
 * Consolidated from: test_server.js, test_client_flow.js, test_timer_integration.js, test_cancel.js
 */

import {
    createClient, createGame, joinGame, checkSession,
    test, assert, delay, makeMove, exitWithStatus, TestSocket
} from './helpers.js';

console.log('=== Basic Game Flow Tests ===\n');

async function runTests(): Promise<void> {

    // --- From test_server.js ---

    await test('Create game, join, and exchange moves', async () => {
        const p1Id = 'basic-p1-' + Date.now();
        const p2Id = 'basic-p2-' + Date.now();

        const client1 = createClient();
        const client2 = createClient();

        try {
            const createRes = await createGame(client1, p1Id, { matchType: '3', timer: '0', colorMode: 'black' });
            const gameId = createRes.gameId;
            assert(!!gameId, 'Should receive a gameId');

            // Set up listener BEFORE join to avoid race condition
            const statePromise = new Promise<any>((resolve) => {
                client1.on('gameStateUpdate', (state: any) => {
                    if (state.roundState === 'playing') resolve(state);
                });
            });

            const joinRes = await joinGame(client2, gameId, p2Id);
            assert(joinRes.success, 'P2 should join successfully');

            const startState = await statePromise;
            assert(startState.turn === 'black', 'Black should move first');

            // P1 (black) makes a move
            const p2Update = new Promise<any>((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Timeout')), 3000);
                client2.on('gameStateUpdate', (state: any) => {
                    clearTimeout(timeout);
                    resolve(state);
                });
            });

            client1.emit('makeMove', { gameId, move: { fromR: 0, fromC: 0, toR: 1, toC: 1 } });
            const state2 = await p2Update;
            assert(state2.turn === 'white', 'After black moves, it should be white turn');
            assert(state2.requiredColor !== null, 'Required color should be set');
        } finally {
            client1.close();
            client2.close();
        }
    });

    // --- From test_client_flow.js ---

    await test('Create game with timer: response has correct shape', async () => {
        const playerId = 'client-flow-' + Date.now();
        const client = createClient();

        try {
            const res = await createGame(client, playerId, { matchType: '3', timer: '60', colorMode: 'random' });
            const state = res.gameState;

            assert(state.roundState === 'waiting_start', 'Should be in waiting_start state');
            assert(state.timer && state.timer.enabled, 'Timer should be enabled');
            assert(state.timer.remaining.black === 60000, 'Timer duration should be 60000ms');
            assert(state.timer.remaining.white === 60000, 'White timer should also be 60000ms');
        } finally {
            client.close();
        }
    });

    // --- From test_timer_integration.js ---

    await test('Timer is present and enabled in createGame response', async () => {
        const playerId = 'timer-int-' + Date.now();
        const client = createClient();

        try {
            const res = await createGame(client, playerId, { matchType: '3', timer: '60', colorMode: 'black' });
            const state = res.gameState;

            assert(state.timer !== undefined, 'Timer should be in state');
            assert(state.timer.enabled === true, 'Timer should be enabled');
            assert(state.timer.remaining.black > 0, 'Black remaining should be positive');
        } finally {
            client.close();
        }
    });

    // --- From test_cancel.js ---

    await test('Cancel game in lobby: success and lobbyExpired event', async () => {
        const playerId = 'cancel-basic-' + Date.now();
        const client = createClient();

        try {
            const createRes = await createGame(client, playerId, { matchType: '3', timer: '60', colorMode: 'black' });
            const gameId = createRes.gameId;

            assert(createRes.gameState.roundState === 'waiting_start', 'Should be in waiting state');

            const lobbyExpiredPromise = new Promise<boolean>((resolve) => {
                const timeout = setTimeout(() => resolve(false), 3000);
                client.on('lobbyExpired', () => {
                    clearTimeout(timeout);
                    resolve(true);
                });
            });

            const cancelRes = await new Promise<any>((resolve) => {
                client.emit('cancelGame', { gameId }, resolve);
            });
            assert(cancelRes.success, 'Cancel should succeed');

            const received = await lobbyExpiredPromise;
            assert(received, 'Should receive lobbyExpired event');
        } finally {
            client.close();
        }
    });

    await test('Game state: finished flag is false on creation', async () => {
        const playerId = 'finished-check-' + Date.now();
        const client = createClient();

        try {
            const res = await createGame(client, playerId);
            assert(res.gameState.finished === false, 'Game should not be finished initially');
            assert(res.gameState.roundState === 'waiting_start', 'Should be waiting for opponent');
        } finally {
            client.close();
        }
    });

    await test('Invalid gameId returns error on join', async () => {
        const playerId = 'invalid-id-' + Date.now();
        const client = createClient();

        try {
            let errorReceived = false;
            try {
                await joinGame(client, 'nonexistent123', playerId);
            } catch (e: any) {
                errorReceived = true;
                assert(e.message.includes('not found'), 'Should say game not found');
            }
            assert(errorReceived, 'Should receive error for invalid gameId');
        } finally {
            client.close();
        }
    });

    exitWithStatus();
}

runTests().catch(e => {
    console.error('Test runner error:', e);
    process.exit(1);
});
