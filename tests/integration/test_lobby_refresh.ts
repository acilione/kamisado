/**
 * Lobby Refresh & Connection Integration Tests
 *
 * Tests cover scenarios where the game creator refreshes/disconnects
 * BEFORE an opponent joins (waiting_start state):
 *
 * 1. Session restore returns waiting_start state with gameId
 * 2. Share link data is available after restore
 * 3. Board intact after restore
 * 4. Cancel still works after creator refresh
 * 5. lobbyExpired event after cancel
 * 6. Opponent can join via link after creator refresh
 * 7. Creator receives gameStateUpdate after refresh + join
 * 8. Creator receives playerJoined after refresh + join
 * 9. Multiple refreshes - session persists
 * 10. Multiple refreshes then opponent joins
 * 11. No playerDisconnected in lobby
 * 12. No game end timeout in lobby
 * 13. No disconnect entry in map for lobby
 * 14. Join-based restore in lobby
 * 15. Join-based restore then opponent joins
 * 16. Color mode preservation (white/random)
 * 17. Session takeover in lobby
 * 18. Rapid reconnect
 * 19. Timer/matchType preservation
 *
 * Converted from: test_lobby_refresh.js + test_cancel.js cancel-in-lobby overlap
 */

import {
    createClient, createGame, joinGame, checkSession, cancelGame,
    test, assert, delay, exitWithStatus
} from './helpers.js';

console.log('=== Lobby Refresh & Connection Tests ===\n');

async function runTests(): Promise<void> {

    // --- Session Restore in Lobby ---

    console.log('\n--- Session Restore in Lobby ---\n');

    await test('Creator refresh: checkActiveSession returns waiting_start with gameId', async () => {
        const p1Id = 'lobby-restore-' + Date.now();
        const client1 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            const gameId = createRes.gameId;

            assert(createRes.gameState.roundState === 'waiting_start', 'Should be waiting_start after create');

            client1.close();
            await delay(300);

            const client1b = createClient();
            try {
                const session = await checkSession(client1b, p1Id);

                assert(session.active === true, 'Session should be active after refresh');
                assert(session.success === true, 'Should succeed');
                assert(session.gameId === gameId, 'Should restore to same gameId');
                assert(session.color === 'black', 'Should restore as black');
                assert(session.gameState.roundState === 'waiting_start',
                    'roundState should still be waiting_start, got: ' + session.gameState.roundState);
            } finally {
                client1b.close();
            }
        } finally {
            client1.close();
        }
    });

    await test('Creator refresh: restored session shows waiting_start for share link display', async () => {
        const p1Id = 'lobby-sharelink-' + Date.now();
        const client1 = createClient();

        try {
            await createGame(client1, p1Id);

            client1.close();
            await delay(300);

            const client1b = createClient();
            try {
                const session = await checkSession(client1b, p1Id);

                assert(session.active === true, 'Session should be active');
                assert(session.gameState.roundState === 'waiting_start',
                    'roundState must be waiting_start for share link to display');

                const wouldShowShareLink = !(session.active && session.gameState.roundState !== 'waiting_start');
                assert(wouldShowShareLink, 'Client should show share link for restored lobby');
            } finally {
                client1b.close();
            }
        } finally {
            client1.close();
        }
    });

    await test('Creator refresh: gameState board is intact', async () => {
        const p1Id = 'lobby-board-' + Date.now();
        const client1 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            assert(createRes.gameState.board.length === 8, 'Board should be 8 rows');

            client1.close();
            await delay(300);

            const client1b = createClient();
            try {
                const session = await checkSession(client1b, p1Id);

                assert(session.gameState.board, 'Should have board after restore');
                assert(session.gameState.board.length === 8, 'Board should still be 8 rows');
                assert(session.gameState.finished === false, 'Game should not be finished');
            } finally {
                client1b.close();
            }
        } finally {
            client1.close();
        }
    });

    // --- Cancel After Refresh ---

    console.log('\n--- Cancel After Refresh ---\n');

    await test('Creator can cancel game after refreshing in lobby', async () => {
        const p1Id = 'lobby-cancel-refresh-' + Date.now();
        const client1 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            const gameId = createRes.gameId;

            client1.close();
            await delay(300);

            const client1b = createClient();
            try {
                const session = await checkSession(client1b, p1Id);
                assert(session.active === true, 'Session should be active');

                const cancelRes = await cancelGame(client1b, gameId);
                assert(cancelRes.success === true, 'Cancel should succeed after refresh');

                const sessionAfter = await checkSession(client1b, p1Id);
                assert(!sessionAfter.active, 'Session should not be active after cancel');
            } finally {
                client1b.close();
            }
        } finally {
            client1.close();
        }
    });

    await test('Creator receives lobbyExpired event when cancelling after refresh', async () => {
        const p1Id = 'lobby-cancel-event-' + Date.now();
        const client1 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            const gameId = createRes.gameId;

            client1.close();
            await delay(300);

            const client1b = createClient();
            try {
                await checkSession(client1b, p1Id);

                const lobbyExpiredPromise = new Promise<boolean>((resolve) => {
                    const timeout = setTimeout(() => resolve(false), 2000);
                    client1b.on('lobbyExpired', () => {
                        clearTimeout(timeout);
                        resolve(true);
                    });
                });

                await cancelGame(client1b, gameId);

                const received = await lobbyExpiredPromise;
                assert(received, 'Should receive lobbyExpired event after cancel');
            } finally {
                client1b.close();
            }
        } finally {
            client1.close();
        }
    });

    // --- Opponent Join After Refresh ---

    console.log('\n--- Opponent Join After Creator Refresh ---\n');

    await test('Opponent can join via link after creator refreshes', async () => {
        const p1Id = 'lobby-join-p1-' + Date.now();
        const p2Id = 'lobby-join-p2-' + Date.now();
        const client1 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            const gameId = createRes.gameId;

            client1.close();
            await delay(300);

            const client1b = createClient();
            try {
                const session = await checkSession(client1b, p1Id);
                assert(session.active, 'Creator session should restore');

                const client2 = createClient();
                try {
                    const joinRes = await joinGame(client2, gameId, p2Id);

                    assert(joinRes.success, 'Opponent join should succeed');
                    assert(joinRes.color === 'white', 'Opponent should be white');
                    assert(!joinRes.isSpectator, 'Should not be spectator');
                    assert(joinRes.gameState.roundState === 'playing',
                        'Game should start playing after join, got: ' + joinRes.gameState.roundState);
                } finally {
                    client2.close();
                }
            } finally {
                client1b.close();
            }
        } finally {
            client1.close();
        }
    });

    await test('Creator receives gameStateUpdate when opponent joins after refresh', async () => {
        const p1Id = 'lobby-update-p1-' + Date.now();
        const p2Id = 'lobby-update-p2-' + Date.now();
        const client1 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            const gameId = createRes.gameId;

            client1.close();
            await delay(300);

            const client1b = createClient();
            try {
                await checkSession(client1b, p1Id);

                const stateUpdatePromise = new Promise<any>((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Timeout waiting for gameStateUpdate')), 3000);
                    client1b.on('gameStateUpdate', (state: any) => {
                        clearTimeout(timeout);
                        resolve(state);
                    });
                });

                const client2 = createClient();
                try {
                    await joinGame(client2, gameId, p2Id);

                    const state = await stateUpdatePromise;
                    assert(state.roundState === 'playing', 'Should be playing after opponent joins');
                    assert(state.turn === 'black', 'Black should move first');
                } finally {
                    client2.close();
                }
            } finally {
                client1b.close();
            }
        } finally {
            client1.close();
        }
    });

    await test('Creator receives playerJoined event after refresh when opponent joins', async () => {
        const p1Id = 'lobby-pjoined-p1-' + Date.now();
        const p2Id = 'lobby-pjoined-p2-' + Date.now();
        const client1 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            const gameId = createRes.gameId;

            client1.close();
            await delay(300);

            const client1b = createClient();
            try {
                await checkSession(client1b, p1Id);

                const playerJoinedPromise = new Promise<any>((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Timeout waiting for playerJoined')), 3000);
                    client1b.on('playerJoined', (data: any) => {
                        clearTimeout(timeout);
                        resolve(data);
                    });
                });

                const client2 = createClient();
                try {
                    await joinGame(client2, gameId, p2Id);

                    const data = await playerJoinedPromise;
                    assert(data.color === 'white', 'playerJoined should report white');
                } finally {
                    client2.close();
                }
            } finally {
                client1b.close();
            }
        } finally {
            client1.close();
        }
    });

    // --- Multiple Refreshes ---

    console.log('\n--- Multiple Refreshes ---\n');

    await test('Creator refreshes 3 times in lobby - session persists', async () => {
        const p1Id = 'lobby-multi-refresh-' + Date.now();
        let client = createClient();

        try {
            const createRes = await createGame(client, p1Id);
            const gameId = createRes.gameId;

            for (let i = 1; i <= 3; i++) {
                client.close();
                await delay(300);

                client = createClient();
                const session = await checkSession(client, p1Id);

                assert(session.active === true, `Refresh #${i}: session should be active`);
                assert(session.gameId === gameId, `Refresh #${i}: same gameId`);
                assert(session.color === 'black', `Refresh #${i}: same color`);
                assert(session.gameState.roundState === 'waiting_start',
                    `Refresh #${i}: should still be waiting_start`);
            }
        } finally {
            client.close();
        }
    });

    await test('Creator refreshes 3 times then opponent joins - game starts', async () => {
        const p1Id = 'lobby-multi-then-join-p1-' + Date.now();
        const p2Id = 'lobby-multi-then-join-p2-' + Date.now();
        let client1 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            const gameId = createRes.gameId;

            for (let i = 0; i < 3; i++) {
                client1.close();
                await delay(300);
                client1 = createClient();
                await checkSession(client1, p1Id);
            }

            const client2 = createClient();
            try {
                const joinRes = await joinGame(client2, gameId, p2Id);
                assert(joinRes.success, 'Join should succeed after multiple creator refreshes');
                assert(joinRes.gameState.roundState === 'playing', 'Game should start playing');
            } finally {
                client2.close();
            }
        } finally {
            client1.close();
        }
    });

    // --- Disconnect Behavior in Lobby ---

    console.log('\n--- Disconnect Behavior in Lobby ---\n');

    await test('Creator disconnect in lobby does NOT emit playerDisconnected', async () => {
        const p1Id = 'lobby-no-disconnect-' + Date.now();
        const client1 = createClient();

        try {
            await createGame(client1, p1Id);

            client1.close();
            await delay(300);

            const client1b = createClient();
            try {
                const session = await checkSession(client1b, p1Id);
                assert(session.active === true, 'Session should still be active');
                assert(session.gameState.roundState === 'waiting_start', 'Should still be in lobby');
                assert(!session.opponentDisconnected, 'No opponent to be disconnected');
            } finally {
                client1b.close();
            }
        } finally {
            client1.close();
        }
    });

    await test('Creator disconnect in lobby does NOT cause game end after wait', async () => {
        const p1Id = 'lobby-no-timeout-' + Date.now();
        const client1 = createClient();

        try {
            await createGame(client1, p1Id);

            client1.close();
            await delay(2000);

            const client1b = createClient();
            try {
                const session = await checkSession(client1b, p1Id);
                assert(session.active === true, 'Session should still be active after disconnect wait');
                assert(session.gameState.finished === false, 'Game should NOT be finished');
                assert(session.gameState.roundState === 'waiting_start', 'Should still be waiting_start');
            } finally {
                client1b.close();
            }
        } finally {
            client1.close();
        }
    });

    await test('No disconnect entry in map for lobby disconnect', async () => {
        const p1Id = 'lobby-no-dc-entry-' + Date.now();
        const client1 = createClient();

        try {
            await createGame(client1, p1Id);

            client1.close();
            await delay(300);

            const client1b = createClient();
            try {
                const session = await checkSession(client1b, p1Id);
                assert(session.active === true, 'Session should be active');
                assert(session.opponentDisconnected === false, 'opponentDisconnected should be false');
                assert(session.timeoutSeconds === 0, 'timeoutSeconds should be 0');
            } finally {
                client1b.close();
            }
        } finally {
            client1.close();
        }
    });

    // --- Join-Based Restore ---

    console.log('\n--- Join-Based Restore (URL Reconnect) ---\n');

    await test('Creator restores via joinGame instead of checkActiveSession', async () => {
        const p1Id = 'lobby-join-restore-' + Date.now();
        const client1 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            const gameId = createRes.gameId;

            client1.close();
            await delay(300);

            const client1b = createClient();
            try {
                const joinRes = await joinGame(client1b, gameId, p1Id);

                assert(joinRes.success, 'joinGame restore should succeed');
                assert(joinRes.gameId === gameId, 'Should be same gameId');
                assert(joinRes.color === 'black', 'Should restore as black');
                assert(joinRes.gameState.roundState === 'waiting_start', 'Should still be in lobby');
            } finally {
                client1b.close();
            }
        } finally {
            client1.close();
        }
    });

    await test('Creator restores via joinGame then opponent joins normally', async () => {
        const p1Id = 'lobby-join-then-join-p1-' + Date.now();
        const p2Id = 'lobby-join-then-join-p2-' + Date.now();
        const client1 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            const gameId = createRes.gameId;

            client1.close();
            await delay(300);

            const client1b = createClient();
            try {
                await joinGame(client1b, gameId, p1Id);

                const client2 = createClient();
                try {
                    const joinRes = await joinGame(client2, gameId, p2Id);
                    assert(joinRes.success, 'Opponent join should succeed');
                    assert(joinRes.gameState.roundState === 'playing', 'Game should start');
                } finally {
                    client2.close();
                }
            } finally {
                client1b.close();
            }
        } finally {
            client1.close();
        }
    });

    // --- Color Mode Variants ---

    console.log('\n--- Color Mode Lobby Refresh ---\n');

    await test('Creator with white color refreshes - restores as white', async () => {
        const p1Id = 'lobby-white-refresh-' + Date.now();
        const client1 = createClient();

        try {
            const createRes = await createGame(client1, p1Id, { colorMode: 'white' });
            assert(createRes.color === 'white', 'Should be assigned white');

            client1.close();
            await delay(300);

            const client1b = createClient();
            try {
                const session = await checkSession(client1b, p1Id);
                assert(session.active === true, 'Session should be active');
                assert(session.color === 'white', 'Should restore as white');
                assert(session.gameState.roundState === 'waiting_start', 'Should still be in lobby');
            } finally {
                client1b.close();
            }
        } finally {
            client1.close();
        }
    });

    await test('Creator with random color refreshes - color preserved', async () => {
        const p1Id = 'lobby-random-refresh-' + Date.now();
        const client1 = createClient();

        try {
            const createRes = await createGame(client1, p1Id, { colorMode: 'random' });
            const assignedColor = createRes.color;
            assert(assignedColor === 'black' || assignedColor === 'white', 'Should be a valid color');

            client1.close();
            await delay(300);

            const client1b = createClient();
            try {
                const session = await checkSession(client1b, p1Id);
                assert(session.color === assignedColor,
                    `Color should be preserved: expected ${assignedColor}, got ${session.color}`);
            } finally {
                client1b.close();
            }
        } finally {
            client1.close();
        }
    });

    // --- Session Takeover in Lobby ---

    console.log('\n--- Session Takeover in Lobby ---\n');

    await test('Opening second tab in lobby sends sessionTakenOver to first', async () => {
        const p1Id = 'lobby-takeover-' + Date.now();
        const client1 = createClient();

        try {
            await createGame(client1, p1Id);

            const takeoverPromise = new Promise<boolean>((resolve) => {
                const timeout = setTimeout(() => resolve(false), 2000);
                client1.on('sessionTakenOver', () => {
                    clearTimeout(timeout);
                    resolve(true);
                });
            });

            const client1b = createClient();
            try {
                await checkSession(client1b, p1Id);

                const takenOver = await takeoverPromise;
                assert(takenOver, 'First tab should receive sessionTakenOver');
            } finally {
                client1b.close();
            }
        } finally {
            client1.close();
        }
    });

    await test('Second tab in lobby can still cancel the game', async () => {
        const p1Id = 'lobby-takeover-cancel-' + Date.now();
        const client1 = createClient();

        try {
            const createRes = await createGame(client1, p1Id);
            const gameId = createRes.gameId;

            const client1b = createClient();
            try {
                await checkSession(client1b, p1Id);

                const cancelRes = await cancelGame(client1b, gameId);
                assert(cancelRes.success, 'Cancel from second tab should succeed');

                const session = await checkSession(client1b, p1Id);
                assert(!session.active, 'Game should be gone after cancel');
            } finally {
                client1b.close();
            }
        } finally {
            client1.close();
        }
    });

    // --- Edge Cases ---

    console.log('\n--- Edge Cases ---\n');

    await test('Rapid disconnect/reconnect in lobby preserves session', async () => {
        const p1Id = 'lobby-rapid-' + Date.now();
        let client = createClient();

        try {
            const createRes = await createGame(client, p1Id);
            const gameId = createRes.gameId;

            client.close();
            await delay(50); // Very short delay

            client = createClient();
            const session = await checkSession(client, p1Id);

            assert(session.active === true, 'Session should survive rapid reconnect');
            assert(session.gameId === gameId, 'Same gameId after rapid reconnect');
        } finally {
            client.close();
        }
    });

    await test('Timer setting preserved through lobby refresh', async () => {
        const p1Id = 'lobby-timer-setting-' + Date.now();
        const client1 = createClient();

        try {
            await createGame(client1, p1Id, { timer: '300' });

            client1.close();
            await delay(300);

            const client1b = createClient();
            try {
                const session = await checkSession(client1b, p1Id);
                assert(session.active, 'Session should be active');
                assert(session.gameState.timer, 'Timer state should exist');
            } finally {
                client1b.close();
            }
        } finally {
            client1.close();
        }
    });

    await test('Match type preserved through lobby refresh', async () => {
        const p1Id = 'lobby-matchtype-' + Date.now();
        const client1 = createClient();

        try {
            await createGame(client1, p1Id, { matchType: '7' });

            client1.close();
            await delay(300);

            const client1b = createClient();
            try {
                const session = await checkSession(client1b, p1Id);
                assert(session.active, 'Session should be active');
                assert(session.gameState, 'Should have game state');
                assert(session.gameState.scores.black === 0, 'Black score should be 0');
                assert(session.gameState.scores.white === 0, 'White score should be 0');
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
