/**
 * Session Management & Reconnection Integration Tests
 *
 * Covers: session takeover (dual tab), disconnect/reconnect flow,
 * timer persistence across reconnection, clock stop on disconnect,
 * and round confirmation timer.
 * Consolidated from: test_dual_tab.js, test_real_refresh.js,
 * test_timer_refresh.js, test_clock_stop.js, test_round_timer.js
 */

import {
    createClient, createGame, joinGame, checkSession,
    test, assert, delay, exitWithStatus
} from './helpers.js';

console.log('=== Session Management & Reconnection Tests ===\n');

async function runTests(): Promise<void> {

    // --- From test_dual_tab.js ---

    console.log('\n--- Session Takeover ---\n');

    await test('Second tab triggers sessionTakenOver on first tab', async () => {
        const playerId = 'dual-tab-' + Date.now();
        const client1 = createClient();

        try {
            await createGame(client1, playerId, { matchType: '3', timer: '60', colorMode: 'black' });

            const takeoverPromise = new Promise<boolean>((resolve) => {
                const timeout = setTimeout(() => resolve(false), 3000);
                client1.on('sessionTakenOver', () => {
                    clearTimeout(timeout);
                    resolve(true);
                });
            });

            // Open second tab (same playerId, without closing first)
            const client2 = createClient();
            try {
                await checkSession(client2, playerId);

                const takenOver = await takeoverPromise;
                assert(takenOver, 'First tab should receive sessionTakenOver');
            } finally {
                client2.close();
            }
        } finally {
            client1.close();
        }
    });

    // --- From test_real_refresh.js ---

    console.log('\n--- Disconnect & Reconnect ---\n');

    await test('Both players disconnect, P1 reconnects and sees opponent disconnected', async () => {
        const p1Id = 'refresh-p1-' + Date.now();
        const p2Id = 'refresh-p2-' + Date.now();

        const client1 = createClient();

        try {
            const createRes = await createGame(client1, p1Id, { matchType: '3', timer: '60', colorMode: 'black' });
            const gameId = createRes.gameId;

            const client2 = createClient();
            await joinGame(client2, gameId, p2Id);

            // Disconnect P2
            client2.close();
            await delay(1000);

            // Disconnect P1 (simulate refresh start)
            client1.close();
            await delay(1000);

            // Reconnect P1 (simulate refresh end)
            const client1New = createClient();
            try {
                const res = await checkSession(client1New, p1Id);

                assert(res.opponentDisconnected === true, 'Should report opponent disconnected');
                assert(res.timeoutSeconds > 0, 'Should have remaining timeout seconds');
            } finally {
                client1New.close();
            }
        } finally {
            client1.close();
        }
    });

    // --- From test_timer_refresh.js ---

    console.log('\n--- Timer Persistence ---\n');

    await test('Timer decreases correctly across page refresh', async () => {
        const p1Id = 'timer-refresh-p1-' + Date.now();
        const p2Id = 'timer-refresh-p2-' + Date.now();

        const client1 = createClient();

        try {
            const createRes = await createGame(client1, p1Id, { matchType: '3', timer: '60', colorMode: 'black' });
            const gameId = createRes.gameId;

            const client2 = createClient();
            try {
                await joinGame(client2, gameId, p2Id);

                // Wait 3 seconds for timer to elapse
                await delay(3000);

                // Simulate page refresh for P1
                const res = await checkSession(client1, p1Id);

                assert(res.active === true, 'Session should be active');
                const newBlack = res.gameState.timer.remaining.black;
                assert(newBlack < 58000, `Timer should have decreased by ~3s. Got: ${newBlack}`);
            } finally {
                client2.close();
            }
        } finally {
            client1.close();
        }
    });

    // --- From test_clock_stop.js ---

    console.log('\n--- Disconnect Timeout ---\n');

    await test('Player disconnect triggers playerDisconnected event', async () => {
        const p1Id = 'clock-stop-p1-' + Date.now();
        const p2Id = 'clock-stop-p2-' + Date.now();

        const client1 = createClient();

        try {
            const createRes = await createGame(client1, p1Id, { matchType: '3', timer: '60', colorMode: 'black' });
            const gameId = createRes.gameId;

            const client2 = createClient();
            try {
                const joinRes = await joinGame(client2, gameId, p2Id);
                assert(joinRes.gameState.timer.enabled, 'Timer should be enabled');

                const disconnectPromise = new Promise<any>((resolve) => {
                    const timeout = setTimeout(() => resolve(null), 3000);
                    client1.on('playerDisconnected', (data: any) => {
                        clearTimeout(timeout);
                        resolve(data);
                    });
                });

                // Disconnect P2
                client2.close();

                const data = await disconnectPromise;
                assert(data !== null, 'Should receive playerDisconnected event');
                assert(data.timeoutSeconds > 0, 'Should have timeout seconds');
            } finally {
                client2.close();
            }
        } finally {
            client1.close();
        }
    });

    // --- From test_round_timer.js ---

    console.log('\n--- Round Confirmation Timer ---\n');

    await test('Round timer: roundTimerEndTime is null initially', async () => {
        const playerId = 'round-timer-' + Date.now();
        const client = createClient();

        try {
            await createGame(client, playerId, { matchType: '3', timer: '0', colorMode: 'black' });

            const session = await checkSession(client, playerId);
            assert(
                session.roundTimerEndTime === null || session.roundTimerEndTime === undefined,
                'roundTimerEndTime should be null initially'
            );
        } finally {
            client.close();
        }
    });

    // --- Session restoration field validation (from test_link_system.js) ---

    console.log('\n--- Session Restoration ---\n');

    await test('Session restoration includes all required fields', async () => {
        const p1Id = 'restore-fields-' + Date.now();
        const p2Id = 'restore-fields-p2-' + Date.now();

        const client1 = createClient();
        const client2 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            const gameId = createRes.gameId;

            await joinGame(client2, gameId, p2Id);

            // Reconnect P1
            client1.close();
            await delay(200);

            const client1b = createClient();
            try {
                const session = await checkSession(client1b, p1Id);

                assert(session.active === true, 'Should have active flag');
                assert(session.success === true, 'Should have success flag');
                assert(!!session.gameId, 'Should have gameId');
                assert(!!session.color, 'Should have color');
                assert(!!session.gameState, 'Should have gameState');
                assert('opponentDisconnected' in session, 'Should have opponentDisconnected');
                assert('timeoutSeconds' in session, 'Should have timeoutSeconds');
                assert('roundTimerEndTime' in session, 'Should have roundTimerEndTime');
            } finally {
                client1b.close();
            }
        } finally {
            client1.close();
            client2.close();
        }
    });

    await test('Same player reconnects via checkActiveSession', async () => {
        const p1Id = 'recon-check-' + Date.now();

        const client1 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            const gameId = createRes.gameId;

            client1.close();
            await delay(200);

            const client1b = createClient();
            try {
                const session = await checkSession(client1b, p1Id);

                assert(session.active, 'Session should be active');
                assert(session.gameId === gameId, 'Should restore to same game');
                assert(session.color === 'black', 'Should restore as black');
            } finally {
                client1b.close();
            }
        } finally {
            client1.close();
        }
    });

    exitWithStatus();
}

runTests().catch(e => {
    console.error('Test runner error:', e);
    process.exit(1);
});
