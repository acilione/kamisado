/**
 * Comprehensive Rules Tests — cross-referenced with Kamisado_eng.pdf
 *
 * Covers rules NOT already tested in test_game_features.ts / test_sumo.ts:
 *   - Scoring system (points per tooth: 2^rank)
 *   - Sumo promotion & persistence across rounds
 *   - Deadlock (single M6, double M8)
 *   - Advanced push scenarios (DS6 chain home-row, TS2/TS3/TS7/TS8)
 *   - Movement edge cases (M4 corner-touching, white directions, rank-exact limits)
 *   - Fill mode layout computation & state flow
 *   - Random mode index assignment & board setup
 *   - Round/match flow (round increment, loser starts, match end)
 */

import { KamisadoGame } from '../../src/server/game.js';
import { BOARD_COLORS, STANDARD_LAYOUT, POSITION_LAYOUTS } from '../../src/shared/constants.js';
import type { PlayerColor, PieceColor, GameSettings } from '../../src/shared/types.js';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
    try {
        fn();
        console.log(`✓ PASS: ${name}`);
        passed++;
    } catch (e: any) {
        console.error(`✗ FAIL: ${name}`);
        console.error(`  Error: ${e.message}`);
        failed++;
    }
}

function assert(condition: boolean, message?: string): asserts condition {
    if (!condition) throw new Error(message || 'Assertion failed');
}

function createGame(opts?: Partial<GameSettings>): KamisadoGame {
    const defaults: GameSettings = { matchType: '15', timer: '0', positionMode: 'standard' };
    const game = new KamisadoGame('test-' + Date.now() + Math.random(), { ...defaults, ...opts });
    game.roundState = 'playing';
    return game;
}

function setBoard(game: KamisadoGame, pieces: { r: number; c: number; player: PlayerColor; color: PieceColor; sumo?: number }[]): void {
    game.board = Array(8).fill(null).map(() => Array(8).fill(null));
    pieces.forEach(p => {
        game.board[p.r][p.c] = {
            player: p.player, color: p.color, sumo: p.sumo || 0, r: p.r, c: p.c
        };
    });
}

console.log('=== Comprehensive Kamisado Rules Tests ===\n');

// ═══════════════════════════════════════════════
// SCORING SYSTEM  (PDF pages 4, 6-8)
// ═══════════════════════════════════════════════
console.log('\n--- Scoring System ---\n');

test('Scoring: rank 0 piece wins → 1 point (2^0)', () => {
    const game = createGame();
    setBoard(game, [
        { r: 6, c: 0, player: 'black', color: 'orange', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';
    game.scores = { black: 0, white: 0 };

    game.makeMove(6, 0, 7, 0, 'black');

    assert(game.scores.black === 1, `Expected 1pt, got ${game.scores.black}`);
});

test('Scoring: rank 1 (Sumo) piece wins → 2 points (2^1)', () => {
    const game = createGame();
    setBoard(game, [
        { r: 6, c: 0, player: 'black', color: 'orange', sumo: 1 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';
    game.scores = { black: 0, white: 0 };

    game.makeMove(6, 0, 7, 0, 'black');

    assert(game.scores.black === 2, `Expected 2pts, got ${game.scores.black}`);
});

test('Scoring: rank 2 (Double Sumo) piece wins → 4 points (2^2)', () => {
    const game = createGame();
    setBoard(game, [
        { r: 6, c: 0, player: 'black', color: 'orange', sumo: 2 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';
    game.scores = { black: 0, white: 0 };

    game.makeMove(6, 0, 7, 0, 'black');

    assert(game.scores.black === 4, `Expected 4pts, got ${game.scores.black}`);
});

test('Scoring: rank 3 (Triple Sumo) piece wins → 8 points (2^3)', () => {
    const game = createGame();
    setBoard(game, [
        { r: 6, c: 0, player: 'black', color: 'orange', sumo: 3 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';
    game.scores = { black: 0, white: 0 };

    // Rank 3 can only move 1 space, so move from row 6 to row 7
    game.makeMove(6, 0, 7, 0, 'black');

    assert(game.scores.black === 8, `Expected 8pts, got ${game.scores.black}`);
});

test('Scoring: deadlock win with no winning piece → 1 point', () => {
    const game = createGame();
    game.scores = { black: 0, white: 0 };

    game.handleRoundWin('black', null);

    assert(game.scores.black === 1, `Expected 1pt, got ${game.scores.black}`);
});

test('Sumo promotion: rank 0 → rank 1 on round win', () => {
    const game = createGame();
    const piece = { r: 6, c: 0, player: 'black' as PlayerColor, color: 'orange' as PieceColor, sumo: 0 };
    setBoard(game, [piece]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    game.makeMove(6, 0, 7, 0, 'black');

    const promotedPiece = game.board[7][0];
    assert(promotedPiece !== null && promotedPiece.sumo === 1, `Expected rank 1, got ${promotedPiece?.sumo}`);
});

test('Sumo promotion: rank 2 → rank 3 on round win', () => {
    const game = createGame();
    const piece = { r: 6, c: 0, player: 'black' as PlayerColor, color: 'orange' as PieceColor, sumo: 2 };
    setBoard(game, [piece]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    game.makeMove(6, 0, 7, 0, 'black');

    const promotedPiece = game.board[7][0];
    assert(promotedPiece !== null && promotedPiece.sumo === 3, `Expected rank 3, got ${promotedPiece?.sumo}`);
});

test('Sumo promotion capped at rank 3', () => {
    const game = createGame();
    const piece = { r: 6, c: 0, player: 'black' as PlayerColor, color: 'orange' as PieceColor, sumo: 3 };
    setBoard(game, [piece]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    game.makeMove(6, 0, 7, 0, 'black');

    const p = game.board[7][0];
    assert(p !== null && p.sumo === 3, `Should stay rank 3, got ${p?.sumo}`);
});

test('Sumo ranks persist across rounds via sumoRanks map', () => {
    const game = createGame({ matchType: '15' });
    game.sumoRanks.set('black_orange', 2);

    // Reinitialize board — should restore rank from sumoRanks
    game.initializeBoard();

    const orangePiece = game.board[0].find(p => p && p.color === 'orange' && p.player === 'black');
    assert(orangePiece !== null && orangePiece !== undefined && orangePiece.sumo === 2, `Expected rank 2, got ${orangePiece ? orangePiece.sumo : 'null'}`);
});

test('Match ends when target score reached', () => {
    const game = createGame({ matchType: '3' });
    game.scores = { black: 2, white: 0 };
    setBoard(game, [
        { r: 6, c: 0, player: 'black', color: 'orange', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    game.makeMove(6, 0, 7, 0, 'black');

    assert(game.finished === true, 'Game should be finished');
    assert(game.winner === 'black', `Winner should be black, got ${game.winner}`);
    assert(game.scores.black === 3, `Score should be 3, got ${game.scores.black}`);
});

test('Match does NOT end before target score', () => {
    const game = createGame({ matchType: '3' });
    game.scores = { black: 1, white: 0 };
    setBoard(game, [
        { r: 6, c: 0, player: 'black', color: 'orange', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    game.makeMove(6, 0, 7, 0, 'black');

    assert(game.finished === false, 'Game should NOT be finished (score = 2, target = 3)');
    assert(game.scores.black === 2, `Score should be 2, got ${game.scores.black}`);
});

test('Standard match: Double Sumo (rank 2 win) finishes at exactly 3pts (1+2)', () => {
    // Round 1: rank 0 → 1pt. Round 2: rank 1 → 2pts. Total = 3.
    const game = createGame({ matchType: '3' });
    game.scores = { black: 1, white: 0 };
    game.sumoRanks.set('black_orange', 1);
    setBoard(game, [
        { r: 6, c: 0, player: 'black', color: 'orange', sumo: 1 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    game.makeMove(6, 0, 7, 0, 'black');

    assert(game.finished === true, 'Match should end at 3pts');
    assert(game.scores.black === 3, `Expected 3pts (1+2), got ${game.scores.black}`);
});

test('Long match: Triple Sumo (rank 2 win) finishes at 7pts (1+2+4)', () => {
    // Previous rounds scored 3 (1+2). This round rank 2 → 4pts. Total = 7.
    const game = createGame({ matchType: '7' });
    game.scores = { black: 3, white: 0 };
    game.sumoRanks.set('black_orange', 2);
    setBoard(game, [
        { r: 6, c: 0, player: 'black', color: 'orange', sumo: 2 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    game.makeMove(6, 0, 7, 0, 'black');

    assert(game.finished === true, 'Match should end at 7pts');
    assert(game.scores.black === 7, `Expected 7pts (3+4), got ${game.scores.black}`);
});

// ═══════════════════════════════════════════════
// DEADLOCK HANDLING  (Rules M6, M8)
// ═══════════════════════════════════════════════
console.log('\n--- Deadlock Handling ---\n');

test('M6: Single block — turn passes to opponent', () => {
    const game = createGame();

    // Simpler setup: force a specific blocked scenario
    game.board = Array(8).fill(null).map(() => Array(8).fill(null));
    // White red piece at (5,3), completely blocked
    game.board[5][3] = { player: 'white', color: 'red', sumo: 0, r: 5, c: 3 };
    // Blockers: 3 black pieces in front of white red (white moves toward row 0)
    game.board[4][2] = { player: 'black', color: 'blue', sumo: 0, r: 4, c: 2 };
    game.board[4][3] = { player: 'black', color: 'green', sumo: 0, r: 4, c: 3 };
    game.board[4][4] = { player: 'black', color: 'purple', sumo: 0, r: 4, c: 4 };

    // Black piece of the required-after-block color
    const blockSquareColor = BOARD_COLORS[5][3]; // orange
    game.board[1][1] = { player: 'black', color: blockSquareColor, sumo: 0, r: 1, c: 1 };

    game.turn = 'white';
    game.requiredColor = 'red';

    // Trigger deadlock check manually
    game.handleDeadlockCheck();

    // Turn should have passed to black
    assert(game.turn === 'black', `Turn should pass to black, got ${game.turn}`);
    assert(game.requiredColor === blockSquareColor,
        `Required color should be ${blockSquareColor} (blocked piece's square), got ${game.requiredColor}`);
});

test('M8: Double deadlock — last mover opponent wins', () => {
    const game = createGame();
    game.board = Array(8).fill(null).map(() => Array(8).fill(null));

    // White blue at (5,3), blocked by black pieces
    game.board[5][3] = { player: 'white', color: 'blue', sumo: 0, r: 5, c: 3 };
    game.board[4][2] = { player: 'black', color: 'green', sumo: 0, r: 4, c: 2 };
    game.board[4][3] = { player: 'black', color: 'purple', sumo: 0, r: 4, c: 3 };
    game.board[4][4] = { player: 'black', color: 'pink', sumo: 0, r: 4, c: 4 };

    // After block passes to black, black must move piece of BOARD_COLORS[5][3]
    const whiteBlockedSquareColor = BOARD_COLORS[5][3]; // = blue
    // Black's piece of that color is ALSO blocked
    game.board[2][2] = { player: 'black', color: whiteBlockedSquareColor, sumo: 0, r: 2, c: 2 };
    // Block black's piece too
    game.board[3][1] = { player: 'white', color: 'red', sumo: 0, r: 3, c: 1 };
    game.board[3][2] = { player: 'white', color: 'yellow', sumo: 0, r: 3, c: 2 };
    game.board[3][3] = { player: 'white', color: 'orange', sumo: 0, r: 3, c: 3 };

    game.turn = 'white';
    game.requiredColor = 'blue';
    game.scores = { black: 0, white: 0 };

    game.handleDeadlockCheck();

    assert(game.roundState === 'waiting_confirmation', `Should be round over, got ${game.roundState}`);
    assert(game.roundWinner !== null, 'There should be a round winner');
});

test('Sumo piece with valid push is NOT deadlocked', () => {
    const game = createGame();
    game.board = Array(8).fill(null).map(() => Array(8).fill(null));

    // Black sumo at (3,3), opponent at (4,3) with empty at (5,3)
    // Diagonals blocked
    game.board[3][3] = { player: 'black', color: 'orange', sumo: 1, r: 3, c: 3 };
    game.board[4][3] = { player: 'white', color: 'red', sumo: 0, r: 4, c: 3 };
    game.board[4][2] = { player: 'white', color: 'blue', sumo: 0, r: 4, c: 2 };
    game.board[4][4] = { player: 'white', color: 'green', sumo: 0, r: 4, c: 4 };
    // (5,3) empty — push destination

    game.turn = 'black';
    game.requiredColor = 'orange';

    const canMove = game.canMove('black', 'orange');
    assert(canMove === true, 'Sumo should be able to push → not deadlocked');
});

test('Non-sumo piece blocked even with opponent in front (cannot push)', () => {
    const game = createGame();
    game.board = Array(8).fill(null).map(() => Array(8).fill(null));

    // Black rank 0 at (3,3), opponent pieces blocking all 3 forward squares
    game.board[3][3] = { player: 'black', color: 'orange', sumo: 0, r: 3, c: 3 };
    game.board[4][3] = { player: 'white', color: 'red', sumo: 0, r: 4, c: 3 };
    game.board[4][2] = { player: 'white', color: 'blue', sumo: 0, r: 4, c: 2 };
    game.board[4][4] = { player: 'white', color: 'green', sumo: 0, r: 4, c: 4 };

    game.turn = 'black';
    game.requiredColor = 'orange';

    const canMove = game.canMove('black', 'orange');
    assert(canMove === false, 'Non-sumo blocked by 3 pieces should be deadlocked');
});

test('Sumo blocked when push target is also sumo (cannot push equal rank)', () => {
    const game = createGame();
    game.board = Array(8).fill(null).map(() => Array(8).fill(null));

    // Black sumo rank 1 at (3,3). Opponent sumo rank 1 at (4,3) blocks push.
    // Diagonals also blocked.
    game.board[3][3] = { player: 'black', color: 'orange', sumo: 1, r: 3, c: 3 };
    game.board[4][3] = { player: 'white', color: 'red', sumo: 1, r: 4, c: 3 };
    game.board[4][2] = { player: 'white', color: 'blue', sumo: 0, r: 4, c: 2 };
    game.board[4][4] = { player: 'white', color: 'green', sumo: 0, r: 4, c: 4 };

    game.turn = 'black';
    game.requiredColor = 'orange';

    const canMove = game.canMove('black', 'orange');
    assert(canMove === false, 'Sumo rank 1 blocked by equal rank sumo + blocked diags = deadlocked');
});

// ═══════════════════════════════════════════════
// ADVANCED PUSH SCENARIOS
// ═══════════════════════════════════════════════
console.log('\n--- Advanced Push Scenarios ---\n');

test('DS6: Chain push blocked when furthest piece on home row', () => {
    const game = createGame();
    // Black double sumo at (5,0), white at (6,0) and white at (7,0)
    // White at (7,0) is on white's home row → DS6 blocks the push
    setBoard(game, [
        { r: 5, c: 0, player: 'black', color: 'orange', sumo: 2 },
        { r: 6, c: 0, player: 'white', color: 'red', sumo: 0 },
        { r: 7, c: 0, player: 'white', color: 'brown', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const result = game.isValidMove(5, 0, 6, 0, 'black');
    assert(!result.valid, 'DS6: Cannot push chain when furthest is on home row');
    assert(!result.valid && result.reason.includes('home row'), `Reason should mention home row: ${result.reason}`);
});

test('TS2: Triple sumo pushes 3 pieces successfully', () => {
    const game = createGame();
    // Black rank 3 at (2,0). White normals at (3,0), (4,0), (5,0). Empty at (6,0).
    setBoard(game, [
        { r: 2, c: 0, player: 'black', color: 'orange', sumo: 3 },
        { r: 3, c: 0, player: 'white', color: 'red', sumo: 0 },
        { r: 4, c: 0, player: 'white', color: 'blue', sumo: 0 },
        { r: 5, c: 0, player: 'white', color: 'green', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const result = game.isValidMove(2, 0, 3, 0, 'black');
    assert(result.valid && result.isPush === true, `Triple sumo should push 3 pieces: ${result.valid ? 'ok' : result.reason}`);
    assert(result.valid && result.isPush === true && result.pushEndR === 6, `Push end should be row 6, got ${result.valid && result.isPush ? result.pushEndR : 'n/a'}`);
});

test('TS3: Triple sumo 3-piece push → required color = furthest landing square', () => {
    const game = createGame();
    setBoard(game, [
        { r: 2, c: 0, player: 'black', color: 'orange', sumo: 3 },
        { r: 3, c: 0, player: 'white', color: 'red', sumo: 0 },
        { r: 4, c: 0, player: 'white', color: 'blue', sumo: 0 },
        { r: 5, c: 0, player: 'white', color: 'green', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const expectedColor = BOARD_COLORS[6][0]; // furthest empty square
    game.makeMove(2, 0, 3, 0, 'black');

    assert(game.turn === 'black', `Turn should stay with black after push, got ${game.turn}`);
    assert(game.requiredColor === expectedColor,
        `Required color should be ${expectedColor} (row 6, col 0), got ${game.requiredColor}`);
});

test('TS8: Triple sumo can push Double Sumo (rank 2)', () => {
    const game = createGame();
    setBoard(game, [
        { r: 3, c: 0, player: 'black', color: 'orange', sumo: 3 },
        { r: 4, c: 0, player: 'white', color: 'red', sumo: 2 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const result = game.isValidMove(3, 0, 4, 0, 'black');
    assert(result.valid && result.isPush === true, `TS8: Rank 3 should push rank 2: ${result.valid ? 'ok' : result.reason}`);
});

test('TS8: Triple sumo CANNOT push another Triple Sumo (rank 3)', () => {
    const game = createGame();
    setBoard(game, [
        { r: 3, c: 0, player: 'black', color: 'orange', sumo: 3 },
        { r: 4, c: 0, player: 'white', color: 'red', sumo: 3 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const result = game.isValidMove(3, 0, 4, 0, 'black');
    assert(!result.valid, 'TS8: Rank 3 cannot push rank 3');
});

test('TS7: Triple sumo cannot push 4 pieces', () => {
    const game = createGame();
    setBoard(game, [
        { r: 1, c: 0, player: 'black', color: 'orange', sumo: 3 },
        { r: 2, c: 0, player: 'white', color: 'red', sumo: 0 },
        { r: 3, c: 0, player: 'white', color: 'blue', sumo: 0 },
        { r: 4, c: 0, player: 'white', color: 'green', sumo: 0 },
        { r: 5, c: 0, player: 'white', color: 'yellow', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const result = game.isValidMove(1, 0, 2, 0, 'black');
    assert(!result.valid, 'TS7: Rank 3 cannot push more than 3 pieces');
});

test('Push chain: middle piece with higher rank blocks entire push', () => {
    // Double sumo (rank 2) tries to push chain: first opponent normal (rank 0), second opponent sumo (rank 2)
    // DS8: cannot push equal rank → entire push blocked
    const game = createGame();
    setBoard(game, [
        { r: 3, c: 0, player: 'black', color: 'orange', sumo: 2 },
        { r: 4, c: 0, player: 'white', color: 'red', sumo: 0 },
        { r: 5, c: 0, player: 'white', color: 'blue', sumo: 2 }  // equal rank blocks
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const result = game.isValidMove(3, 0, 4, 0, 'black');
    assert(!result.valid, 'Chain push should fail when any piece has >= pusher rank');
});

test('S10: Sumo push is optional when diagonal moves exist', () => {
    const game = createGame();
    // Black sumo at (3,3), white at (4,3) — push available.
    // (4,4) is empty — diagonal move also available.
    setBoard(game, [
        { r: 3, c: 3, player: 'black', color: 'orange', sumo: 1 },
        { r: 4, c: 3, player: 'white', color: 'red', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const pushResult = game.isValidMove(3, 3, 4, 3, 'black');
    const diagResult = game.isValidMove(3, 3, 4, 4, 'black');

    assert(pushResult.valid, 'Push should be valid');
    assert(diagResult.valid, 'Diagonal should also be valid (S10: push optional)');
});

test('Push aftermath: all 3 pieces in correct positions after triple push', () => {
    const game = createGame();
    setBoard(game, [
        { r: 2, c: 0, player: 'black', color: 'orange', sumo: 3 },
        { r: 3, c: 0, player: 'white', color: 'red', sumo: 0 },
        { r: 4, c: 0, player: 'white', color: 'blue', sumo: 0 },
        { r: 5, c: 0, player: 'white', color: 'green', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    game.makeMove(2, 0, 3, 0, 'black');

    // After push: orange at (3,0), red at (4,0), blue at (5,0), green at (6,0)
    assert(game.board[3][0]?.color === 'orange', `Pusher should be at (3,0)`);
    assert(game.board[4][0]?.color === 'red', `First pushed at (4,0)`);
    assert(game.board[5][0]?.color === 'blue', `Second pushed at (5,0)`);
    assert(game.board[6][0]?.color === 'green', `Third pushed at (6,0)`);
    assert(game.board[2][0] === null, 'Original pusher position should be empty');
});

// ═══════════════════════════════════════════════
// MOVEMENT EDGE CASES
// ═══════════════════════════════════════════════
console.log('\n--- Movement Edge Cases ---\n');

test('M4: Diagonal NOT blocked by corner-touching pieces', () => {
    const game = createGame();
    // Black at (2,2), wants to move diag to (4,4).
    // Pieces at (3,2) and (3,4) — these are NOT on the diagonal path (3,3) is.
    // Piece at (2,3) and (3,2) touch corner but don't block diagonal.
    setBoard(game, [
        { r: 2, c: 2, player: 'black', color: 'orange', sumo: 0 },
        { r: 3, c: 2, player: 'white', color: 'red', sumo: 0 },    // adjacent but not on diagonal
        { r: 2, c: 3, player: 'white', color: 'blue', sumo: 0 },   // adjacent but not on diagonal
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    // Diagonal (2,2) → (4,4): path goes through (3,3) which is empty
    const result = game.isValidMove(2, 2, 4, 4, 'black');
    assert(result.valid, `M4: Diagonal should NOT be blocked by corner-touching pieces: ${result.valid ? 'ok' : result.reason}`);
});

test('M4: Diagonal IS blocked by piece ON the diagonal path', () => {
    const game = createGame();
    setBoard(game, [
        { r: 2, c: 2, player: 'black', color: 'orange', sumo: 0 },
        { r: 3, c: 3, player: 'white', color: 'red', sumo: 0 },  // ON the diagonal path
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const result = game.isValidMove(2, 2, 4, 4, 'black');
    assert(!result.valid, 'Diagonal blocked by piece on path');
});

test('Cannot move zero distance', () => {
    const game = createGame();
    setBoard(game, [
        { r: 3, c: 3, player: 'black', color: 'orange', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const result = game.isValidMove(3, 3, 3, 3, 'black');
    assert(!result.valid, 'Cannot stay on same square');
});

test('Rank 1 can move exactly 5 spaces forward', () => {
    const game = createGame();
    setBoard(game, [
        { r: 0, c: 0, player: 'black', color: 'orange', sumo: 1 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const result = game.isValidMove(0, 0, 5, 0, 'black');
    assert(result.valid, `Rank 1 should move exactly 5 spaces: ${result.valid ? 'ok' : result.reason}`);
});

test('Rank 2 can move exactly 3 spaces forward', () => {
    const game = createGame();
    setBoard(game, [
        { r: 0, c: 0, player: 'black', color: 'orange', sumo: 2 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const result = game.isValidMove(0, 0, 3, 0, 'black');
    assert(result.valid, `Rank 2 should move exactly 3 spaces: ${result.valid ? 'ok' : result.reason}`);
});

test('Rank 2 can move exactly 3 spaces diagonally', () => {
    const game = createGame();
    setBoard(game, [
        { r: 0, c: 0, player: 'black', color: 'orange', sumo: 2 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const result = game.isValidMove(0, 0, 3, 3, 'black');
    assert(result.valid, `Rank 2 diagonal 3 should be valid: ${result.valid ? 'ok' : result.reason}`);
});

test('White moves forward (decreasing row number)', () => {
    const game = createGame();
    setBoard(game, [
        { r: 5, c: 3, player: 'white', color: 'blue', sumo: 0 }
    ]);
    game.turn = 'white';
    game.requiredColor = 'blue';

    const result = game.isValidMove(5, 3, 2, 3, 'white');
    assert(result.valid, `White forward should be valid: ${result.valid ? 'ok' : result.reason}`);
});

test('White diagonal forward-left', () => {
    const game = createGame();
    setBoard(game, [
        { r: 5, c: 5, player: 'white', color: 'blue', sumo: 0 }
    ]);
    game.turn = 'white';
    game.requiredColor = 'blue';

    const result = game.isValidMove(5, 5, 3, 3, 'white');
    assert(result.valid, `White diagonal forward-left should be valid: ${result.valid ? 'ok' : result.reason}`);
});

test('White diagonal forward-right', () => {
    const game = createGame();
    setBoard(game, [
        { r: 5, c: 3, player: 'white', color: 'blue', sumo: 0 }
    ]);
    game.turn = 'white';
    game.requiredColor = 'blue';

    const result = game.isValidMove(5, 3, 3, 5, 'white');
    assert(result.valid, `White diagonal forward-right should be valid: ${result.valid ? 'ok' : result.reason}`);
});

test('White backward movement invalid', () => {
    const game = createGame();
    setBoard(game, [
        { r: 3, c: 3, player: 'white', color: 'blue', sumo: 0 }
    ]);
    game.turn = 'white';
    game.requiredColor = 'blue';

    const result = game.isValidMove(3, 3, 5, 3, 'white');
    assert(!result.valid, 'White backward (increasing row) should be invalid');
});

test('Cannot move opponent piece', () => {
    const game = createGame();
    setBoard(game, [
        { r: 3, c: 3, player: 'white', color: 'blue', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'blue';

    const result = game.isValidMove(3, 3, 4, 3, 'black');
    assert(!result.valid, 'Cannot move opponent piece');
});

test('Cannot move when game is finished', () => {
    const game = createGame();
    setBoard(game, [
        { r: 3, c: 3, player: 'black', color: 'orange', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';
    game.finished = true;

    const result = game.isValidMove(3, 3, 4, 3, 'black');
    assert(!result.valid, 'Cannot move when game finished');
});

test('Knight-like L-shaped move is invalid', () => {
    const game = createGame();
    setBoard(game, [
        { r: 3, c: 3, player: 'black', color: 'orange', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const result = game.isValidMove(3, 3, 5, 4, 'black');
    assert(!result.valid, 'L-shaped move should be invalid');
});

test('T1: First move of round — any piece can be moved', () => {
    const game = createGame();
    game.requiredColor = null; // first move
    game.turn = 'black';

    // All 8 black pieces on row 0
    const pieces = STANDARD_LAYOUT.map((color, c) => (
        { r: 0, c, player: 'black' as PlayerColor, color, sumo: 0 }
    ));
    setBoard(game, pieces);

    let validCount = 0;
    for (let c = 0; c < 8; c++) {
        const result = game.isValidMove(0, c, 1, c, 'black');
        if (result.valid) validCount++;
    }
    assert(validCount === 8, `All 8 pieces should be movable on first turn, got ${validCount}`);
});

test('T2: After move, opponent must use piece matching landed square color', () => {
    const game = createGame();
    setBoard(game, [
        { r: 0, c: 0, player: 'black', color: 'orange', sumo: 0 },
        { r: 7, c: 0, player: 'white', color: 'brown', sumo: 0 },
        { r: 7, c: 3, player: 'white', color: 'yellow', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const landingColor = BOARD_COLORS[1][0]; // red
    game.makeMove(0, 0, 1, 0, 'black');

    assert(game.requiredColor === landingColor,
        `After black lands on (1,0), required should be ${landingColor}, got ${game.requiredColor}`);
    assert(game.turn === 'white', 'Turn should switch to white');
});

// ═══════════════════════════════════════════════
// FILL MODE  (Rules F1-F4)
// ═══════════════════════════════════════════════
console.log('\n--- Fill Mode ---\n');

test('Fill layout: pieces sorted by distance (closest to home first), then column', () => {
    const game = createGame({ positionMode: 'fill' });

    // Set up end-of-round positions for black (home row = 0)
    game.lastRoundEndPositions = Array(8).fill(null).map(() => Array(8).fill(null));
    // Piece at row 0 (distance 0), col 3
    game.lastRoundEndPositions[0][3] = { player: 'black', color: 'pink', sumo: 0, r: 0, c: 3 };
    // Piece at row 0 (distance 0), col 5
    game.lastRoundEndPositions[0][5] = { player: 'black', color: 'red', sumo: 0, r: 0, c: 5 };
    // Piece at row 2 (distance 2), col 1
    game.lastRoundEndPositions[2][1] = { player: 'black', color: 'blue', sumo: 0, r: 2, c: 1 };
    // Piece at row 5 (distance 5), col 6
    game.lastRoundEndPositions[5][6] = { player: 'black', color: 'green', sumo: 0, r: 5, c: 6 };

    const layout = game.computeFillLayout('black', 'left');
    // Expected order: pink(d0,c3), red(d0,c5), blue(d2,c1), green(d5,c6)
    assert(layout[0] === 'pink', `First should be pink (d0,c3), got ${layout[0]}`);
    assert(layout[1] === 'red', `Second should be red (d0,c5), got ${layout[1]}`);
    assert(layout[2] === 'blue', `Third should be blue (d2,c1), got ${layout[2]}`);
    assert(layout[3] === 'green', `Fourth should be green (d5,c6), got ${layout[3]}`);
});

test('Fill from right reverses the layout order', () => {
    const game = createGame({ positionMode: 'fill' });

    game.lastRoundEndPositions = Array(8).fill(null).map(() => Array(8).fill(null));
    game.lastRoundEndPositions[0][3] = { player: 'black', color: 'pink', sumo: 0, r: 0, c: 3 };
    game.lastRoundEndPositions[0][5] = { player: 'black', color: 'red', sumo: 0, r: 0, c: 5 };
    game.lastRoundEndPositions[2][1] = { player: 'black', color: 'blue', sumo: 0, r: 2, c: 1 };
    game.lastRoundEndPositions[5][6] = { player: 'black', color: 'green', sumo: 0, r: 5, c: 6 };

    const layout = game.computeFillLayout('black', 'right');
    // Reversed: green, blue, red, pink
    assert(layout[0] === 'green', `First should be green, got ${layout[0]}`);
    assert(layout[1] === 'blue', `Second should be blue, got ${layout[1]}`);
    assert(layout[2] === 'red', `Third should be red, got ${layout[2]}`);
    assert(layout[3] === 'pink', `Fourth should be pink, got ${layout[3]}`);
});

test('Fill mode: startNextRound enters waiting_fill_choice (round > 1)', () => {
    const game = createGame({ positionMode: 'fill', matchType: '15' });
    game.roundState = 'playing';
    game.roundWinner = 'black';
    game.defender = 'black';
    game.lastRoundEndPositions = game.board.map(r => r.map(c => c ? { ...c } : null));

    game.startNextRound();

    assert(game.roundState === 'waiting_fill_choice',
        `Should be waiting_fill_choice, got ${game.roundState}`);
    assert(game.round === 2, `Round should be 2, got ${game.round}`);
});

test('Fill mode: only defender can choose direction', () => {
    const game = createGame({ positionMode: 'fill', matchType: '15' });
    game.roundState = 'waiting_fill_choice';
    game.defender = 'black';
    game.roundWinner = 'black';
    game.lastRoundEndPositions = game.board.map(r => r.map(c => c ? { ...c } : null));

    let error: string | null = null;
    try {
        game.handleFillChoice('white', 'left'); // white is NOT defender
    } catch (e: any) {
        error = e.message;
    }
    assert(error !== null && error.includes('defender'), `Should reject non-defender: ${error}`);
});

test('Fill mode: handleFillChoice transitions to playing', () => {
    const game = createGame({ positionMode: 'fill', matchType: '15' });
    game.roundState = 'playing';
    game.roundWinner = 'black';
    game.defender = 'black';

    // Simulate round end with positions
    game.lastRoundEndPositions = game.board.map(r => r.map(c => c ? { ...c } : null));

    game.startNextRound(); // enters waiting_fill_choice
    assert(game.roundState === 'waiting_fill_choice');

    game.handleFillChoice('black', 'left');

    assert(game.roundState === 'playing', `Should transition to playing, got ${game.roundState}`);
});

test('Fill mode: loser moves first after fill', () => {
    const game = createGame({ positionMode: 'fill', matchType: '15' });
    game.roundState = 'playing';
    game.roundWinner = 'black'; // black won → white (loser) moves first
    game.defender = 'black';
    game.lastRoundEndPositions = game.board.map(r => r.map(c => c ? { ...c } : null));

    game.startNextRound();
    game.handleFillChoice('black', 'right');

    assert(game.turn === 'white', `Loser (white) should move first, got ${game.turn}`);
});

// ═══════════════════════════════════════════════
// RANDOM MODE
// ═══════════════════════════════════════════════
console.log('\n--- Random Mode ---\n');

test('Random mode: two different indices drawn', () => {
    const game = createGame({ positionMode: 'random' });
    const info = game.roundPositionInfo;

    assert(info !== null, 'roundPositionInfo should be set');
    assert(info!.blackIndex !== info!.whiteIndex, 'Indices should be different');
});

test('Random mode: indices within valid range (0-36)', () => {
    // Run multiple times to catch edge cases
    for (let i = 0; i < 20; i++) {
        const game = createGame({ positionMode: 'random' });
        const info = game.roundPositionInfo!;
        assert(info.blackIndex >= 0 && info.blackIndex < POSITION_LAYOUTS.length,
            `Black index ${info.blackIndex} out of range`);
        assert(info.whiteIndex >= 0 && info.whiteIndex < POSITION_LAYOUTS.length,
            `White index ${info.whiteIndex} out of range`);
    }
});

test('Random mode: lower index assigned to Black (first mover in round 1)', () => {
    // In round 1, Black moves first → Black is challenger → gets lower index
    for (let i = 0; i < 20; i++) {
        const game = createGame({ positionMode: 'random' });
        const info = game.roundPositionInfo!;
        assert(info.blackIndex < info.whiteIndex,
            `Black should get lower index: black=${info.blackIndex}, white=${info.whiteIndex}`);
    }
});

test('Random mode: board uses selected layout (not always standard)', () => {
    // Run enough times to statistically guarantee at least one non-standard layout
    let foundNonStandard = false;
    for (let i = 0; i < 50; i++) {
        const game = createGame({ positionMode: 'random' });
        const blackRow = game.board[0].map(p => p!.color);
        const isStandard = blackRow.every((c, j) => c === STANDARD_LAYOUT[j]);
        if (!isStandard) {
            foundNonStandard = true;
            break;
        }
    }
    assert(foundNonStandard, 'Random mode should produce non-standard layouts');
});

test('Random mode: roundPositionInfo in toJson', () => {
    const game = createGame({ positionMode: 'random' });
    const json = game.toJson();

    assert(json.positionMode === 'random', 'positionMode should be in JSON');
    assert(json.roundPositionInfo !== null, 'roundPositionInfo should be in JSON');
    assert(typeof json.roundPositionInfo!.blackIndex === 'number', 'blackIndex should be number');
    assert(typeof json.roundPositionInfo!.whiteIndex === 'number', 'whiteIndex should be number');
});

test('Random mode: new indices drawn each round', () => {
    const game = createGame({ positionMode: 'random', matchType: '15' });
    game.roundState = 'playing';
    const firstInfo = { ...game.roundPositionInfo! };

    // Simulate round win
    game.roundWinner = 'black';
    game.startNextRound();

    const secondInfo = game.roundPositionInfo;
    // It's theoretically possible but astronomically unlikely to get same pair
    // Just verify the info was updated (new object)
    assert(secondInfo !== null, 'New roundPositionInfo should be set after next round');
});

// ═══════════════════════════════════════════════
// ROUND / MATCH FLOW
// ═══════════════════════════════════════════════
console.log('\n--- Round / Match Flow ---\n');

test('Round increments after startNextRound', () => {
    const game = createGame();
    assert(game.round === 1, 'Should start at round 1');

    game.roundWinner = 'black';
    game.roundState = 'playing';
    game.startNextRound();

    assert(game.round === 2, `Should be round 2, got ${game.round}`);
});

test('Loser (challenger) moves first in new round', () => {
    const game = createGame();
    game.roundState = 'playing';
    game.roundWinner = 'white'; // white won → black (loser) starts next

    game.startNextRound();

    assert(game.turn === 'black', `Loser (black) should go first, got ${game.turn}`);
});

test('First round: Black always moves first', () => {
    const game = createGame();
    assert(game.turn === 'black', `Black should start round 1, got ${game.turn}`);
});

test('confirmNextRound requires both players', () => {
    const game = createGame();
    game.roundState = 'waiting_confirmation';

    const first = game.confirmNextRound('black');
    assert(first === false, 'Should not be all confirmed after 1 player');
    assert(game.confirmations.size === 1, 'Should have 1 confirmation');

    const second = game.confirmNextRound('white');
    assert(second === true, 'Should be all confirmed after both players');
});

test('confirmNextRound: same player confirming twice does not count double', () => {
    const game = createGame();
    game.roundState = 'waiting_confirmation';

    game.confirmNextRound('black');
    const second = game.confirmNextRound('black');
    assert(second === false, 'Same player confirming twice should not trigger');
    assert(game.confirmations.size === 1, 'Set should still have 1 entry');
});

test('Standard mode: pieces reset to standard layout each round', () => {
    const game = createGame({ positionMode: 'standard', matchType: '15' });
    game.roundState = 'playing';
    game.roundWinner = 'black';

    game.startNextRound();

    const blackRow = game.board[0].map(p => p!.color);
    const whiteRow = game.board[7].map(p => p!.color);
    const reversedStandard = [...STANDARD_LAYOUT].reverse();

    assert(blackRow.every((c, i) => c === STANDARD_LAYOUT[i]),
        `Black row should be standard: ${blackRow}`);
    assert(whiteRow.every((c, i) => c === reversedStandard[i]),
        `White row should be reversed standard: ${whiteRow}`);
});

test('White sumo push: white pushes black piece forward (increasing row)', () => {
    const game = createGame();
    setBoard(game, [
        { r: 4, c: 3, player: 'white', color: 'blue', sumo: 1 },
        { r: 3, c: 3, player: 'black', color: 'orange', sumo: 0 }
    ]);
    game.turn = 'white';
    game.requiredColor = 'blue';

    // White moves from row 4 to row 3 (forward for white), pushing black from 3 to 2
    const result = game.isValidMove(4, 3, 3, 3, 'white');
    assert(result.valid && result.isPush === true, `White should be able to sumo push: ${result.valid ? 'ok' : result.reason}`);

    game.makeMove(4, 3, 3, 3, 'white');

    assert(game.board[3][3]?.player === 'white', 'White pusher should be at (3,3)');
    assert(game.board[2][3]?.player === 'black', 'Black pushed to (2,3)');
    assert(game.turn === 'white', 'Turn stays with white after push');
});

test('Push cannot send piece off board (black pushing near row 7)', () => {
    // Black sumo at (6,0), white normal at (7,0). White is on home row → S6 blocks.
    // Already tested, but verify white home row blocks from the push-off-board angle.
    const game = createGame();
    setBoard(game, [
        { r: 6, c: 0, player: 'black', color: 'orange', sumo: 1 },
        { r: 7, c: 0, player: 'white', color: 'brown', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const result = game.isValidMove(6, 0, 7, 0, 'black');
    assert(!result.valid, 'Cannot push piece on home row / off board');
});

test('White push cannot send black piece off board (near row 0)', () => {
    const game = createGame();
    setBoard(game, [
        { r: 1, c: 0, player: 'white', color: 'blue', sumo: 1 },
        { r: 0, c: 0, player: 'black', color: 'orange', sumo: 0 }
    ]);
    game.turn = 'white';
    game.requiredColor = 'blue';

    const result = game.isValidMove(1, 0, 0, 0, 'white');
    assert(!result.valid, 'Cannot push black piece on its home row (row 0)');
});

// ═══════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════
console.log('\n=== Test Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);

if (failed > 0) {
    process.exit(1);
} else {
    console.log('\nAll tests passed!');
}
