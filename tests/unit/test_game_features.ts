/**
 * Comprehensive Game Feature Tests
 *
 * Tests for Kamisado game logic including:
 * - Sumo push corner cases
 * - Movement validation
 * - Round win conditions
 * - Deadlock handling
 * - Turn/color rules
 */

import { KamisadoGame } from '../../src/server/game.js';
import { BOARD_COLORS } from '../../src/shared/constants.js';
import type { PlayerColor, PieceColor } from '../../src/shared/types.js';

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

function createGame(): KamisadoGame {
    const game = new KamisadoGame('test-' + Date.now(), { matchType: '3', timer: '0' });
    game.roundState = 'playing'; // Important: set to playing for tests
    return game;
}

// Helper to set up board with specific pieces
function setBoard(game: KamisadoGame, pieces: { r: number; c: number; player: PlayerColor; color: PieceColor; sumo?: number }[]): void {
    game.board = Array(8).fill(null).map(() => Array(8).fill(null));
    pieces.forEach(p => {
        game.board[p.r][p.c] = {
            player: p.player,
            color: p.color,
            sumo: p.sumo || 0,
            r: p.r,
            c: p.c
        };
    });
}

console.log('=== Kamisado Game Feature Tests ===\n');

// ==========================================
// SUMO PUSH CORNER CASES
// ==========================================
console.log('\n--- Sumo Push Corner Cases ---\n');

test('Sumo push blocked by own piece behind opponent', () => {
    const game = createGame();
    setBoard(game, [
        { r: 0, c: 0, player: 'black', color: 'blue', sumo: 1 },
        { r: 1, c: 0, player: 'white', color: 'red', sumo: 0 },
        { r: 2, c: 0, player: 'black', color: 'orange', sumo: 0 } // Own piece blocks push destination
    ]);
    game.turn = 'black';
    game.requiredColor = 'blue';

    const result = game.isValidMove(0, 0, 1, 0, 'black');
    assert(!result.valid, 'Should be invalid');
    // The push would try to move white to 2,0 but black piece is there
    assert(result.reason.includes('own') || result.reason.includes('Blocked'),
        'Reason: ' + result.reason);
});

test('Sumo push blocked by piece at edge of board (S6 home row)', () => {
    const game = createGame();
    setBoard(game, [
        { r: 6, c: 0, player: 'black', color: 'blue', sumo: 1 },
        { r: 7, c: 0, player: 'white', color: 'red', sumo: 0 } // White's home row - S6 blocks
    ]);
    game.turn = 'black';
    game.requiredColor = 'blue';

    const result = game.isValidMove(6, 0, 7, 0, 'black');
    assert(!result.valid, 'Should be invalid - piece on home row');
    assert(result.reason.includes('home row'), 'Reason should mention home row: ' + result.reason);
});

test('Sumo push: color after push is pushed-piece landing square color (S5)', () => {
    const game = createGame();
    setBoard(game, [
        { r: 0, c: 4, player: 'black', color: 'pink', sumo: 1 },
        { r: 1, c: 4, player: 'white', color: 'red', sumo: 0 },
    ]);
    game.turn = 'black';
    game.requiredColor = 'pink';

    // S5: After push, next color = square the PUSHED piece landed on (r:2, c:4)
    const pushedLandingColor = BOARD_COLORS[2][4];

    game.makeMove(0, 4, 1, 4, 'black');

    assert(game.requiredColor === pushedLandingColor,
        `Next color should be ${pushedLandingColor}, got ${game.requiredColor}`);
    // S3: Turn stays with pusher (extra turn)
    assert(game.turn === 'black', 'Turn should stay with black (extra turn after push)');
});

test('Sumo Rank 2 pushes 2 pieces (success)', () => {
    const game = createGame();
    setBoard(game, [
        { r: 0, c: 0, player: 'black', color: 'blue', sumo: 2 },
        { r: 1, c: 0, player: 'white', color: 'red', sumo: 0 },
        { r: 2, c: 0, player: 'white', color: 'green', sumo: 0 }
        // r:3,c:0 is empty - push destination
    ]);
    game.turn = 'black';
    game.requiredColor = 'blue';

    const result = game.isValidMove(0, 0, 1, 0, 'black');
    assert(result.valid, 'Rank 2 should push 2 pieces: ' + (result.valid ? '' : result.reason));
    assert(result.isPush === true, 'Should be a push move');
});

test('Sumo Rank 2 pushes 3 pieces (fail)', () => {
    const game = createGame();
    setBoard(game, [
        { r: 0, c: 0, player: 'black', color: 'blue', sumo: 2 },
        { r: 1, c: 0, player: 'white', color: 'red', sumo: 0 },
        { r: 2, c: 0, player: 'white', color: 'green', sumo: 0 },
        { r: 3, c: 0, player: 'white', color: 'yellow', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'blue';

    const result = game.isValidMove(0, 0, 1, 0, 'black');
    assert(!result.valid, 'Rank 2 cannot push 3 pieces');
});

test('Sumo Rank 2 cannot push Rank 2', () => {
    const game = createGame();
    setBoard(game, [
        { r: 0, c: 0, player: 'black', color: 'blue', sumo: 2 },
        { r: 1, c: 0, player: 'white', color: 'red', sumo: 2 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'blue';

    const result = game.isValidMove(0, 0, 1, 0, 'black');
    assert(!result.valid, 'Cannot push equal rank');
});

test('Sumo Rank 3 pushes Rank 2 (success)', () => {
    const game = createGame();
    setBoard(game, [
        { r: 0, c: 0, player: 'black', color: 'blue', sumo: 3 },
        { r: 1, c: 0, player: 'white', color: 'red', sumo: 2 }
        // r:2,c:0 is empty - push destination
    ]);
    game.turn = 'black';
    game.requiredColor = 'blue';

    // Rank 3 moves max 1 space, so moving from 0,0 to 1,0 is valid
    const result = game.isValidMove(0, 0, 1, 0, 'black');
    assert(result.valid, 'Rank 3 should push Rank 2: ' + (result.valid ? '' : result.reason));
});

// ==========================================
// MOVEMENT VALIDATION
// ==========================================
console.log('\n--- Movement Validation ---\n');

test('Diagonal movement valid', () => {
    const game = createGame();
    setBoard(game, [
        { r: 3, c: 3, player: 'black', color: 'blue', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'blue';

    const result = game.isValidMove(3, 3, 6, 6, 'black');
    assert(result.valid, 'Diagonal forward movement should be valid: ' + (result.valid ? '' : result.reason));
});

test('Backward movement invalid', () => {
    const game = createGame();
    setBoard(game, [
        { r: 5, c: 3, player: 'black', color: 'blue', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'blue';

    const result = game.isValidMove(5, 3, 3, 3, 'black');
    assert(!result.valid, 'Backward movement should be invalid');
});

test('Path blocked by piece', () => {
    const game = createGame();
    setBoard(game, [
        { r: 0, c: 0, player: 'black', color: 'blue', sumo: 0 },
        { r: 3, c: 0, player: 'white', color: 'red', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'blue';

    const result = game.isValidMove(0, 0, 5, 0, 'black');
    assert(!result.valid, 'Should not jump over pieces');
});

test('Cannot move wrong color piece', () => {
    const game = createGame();
    setBoard(game, [
        { r: 0, c: 0, player: 'black', color: 'blue', sumo: 0 },
        { r: 0, c: 1, player: 'black', color: 'red', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'blue';

    const result = game.isValidMove(0, 1, 3, 1, 'black'); // Moving red, need blue
    assert(!result.valid, 'Cannot move piece of wrong color');
});

test('Lateral movement invalid', () => {
    const game = createGame();
    setBoard(game, [
        { r: 3, c: 3, player: 'black', color: 'blue', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'blue';

    const result = game.isValidMove(3, 3, 3, 5, 'black'); // Sideways
    assert(!result.valid, 'Sideways movement should be invalid');
});

// ==========================================
// ROUND WIN CONDITIONS
// ==========================================
console.log('\n--- Round Win Conditions ---\n');

test('Black wins by reaching row 7', () => {
    const game = createGame();
    setBoard(game, [
        { r: 6, c: 3, player: 'black', color: 'blue', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'blue';

    game.makeMove(6, 3, 7, 3, 'black');

    assert(game.roundState === 'waiting_confirmation', 'Round should be waiting confirmation');
    assert(game.roundWinner === 'black', 'Black should win the round');
});

test('White wins by reaching row 0', () => {
    const game = createGame();
    setBoard(game, [
        { r: 1, c: 3, player: 'white', color: 'blue', sumo: 0 }
    ]);
    game.turn = 'white';
    game.requiredColor = 'blue';

    game.makeMove(1, 3, 0, 3, 'white');

    assert(game.roundState === 'waiting_confirmation', 'Round should be waiting confirmation');
    assert(game.roundWinner === 'white', 'White should win the round');
});

test('Sumo push does not win if pusher not on home row', () => {
    const game = createGame();
    // Black pushes from 5,3 to 6,3. White at 6,3 gets pushed to 7,3.
    // Black lands at 6,3 (not winning row for black which is 7).
    const landingColor = BOARD_COLORS[6][3];
    setBoard(game, [
        { r: 5, c: 3, player: 'black', color: 'blue', sumo: 1 },
        { r: 6, c: 3, player: 'white', color: 'red', sumo: 0 },
        // White needs a piece of the landing color that can move forward
        { r: 4, c: 4, player: 'white', color: landingColor, sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'blue';

    game.makeMove(5, 3, 6, 3, 'black');

    // After push, black is at row 6 (not winning row 7)
    // Key assertion: round is still playing (black didn't win)
    assert(game.roundState === 'playing',
        `Round should continue. State: ${game.roundState}, Winner: ${game.roundWinner}`);
});

test('Push that would go off board is invalid', () => {
    const game = createGame();
    setBoard(game, [
        { r: 6, c: 3, player: 'black', color: 'blue', sumo: 1 },
        { r: 7, c: 3, player: 'white', color: 'red', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'blue';

    const result = game.isValidMove(6, 3, 7, 3, 'black');
    assert(!result.valid, 'Cannot push off board');
});

// ==========================================
// SUMO RANK MOVEMENT LIMITS
// ==========================================
console.log('\n--- Sumo Rank Movement Limits ---\n');

test('Rank 0 (non-Sumo) unlimited movement', () => {
    const game = createGame();
    setBoard(game, [
        { r: 0, c: 0, player: 'black', color: 'blue', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'blue';

    const result = game.isValidMove(0, 0, 7, 0, 'black');
    assert(result.valid, 'Non-Sumo should move 7 spaces: ' + (result.valid ? '' : result.reason));
});

test('Rank 3 limited to 1 space', () => {
    const game = createGame();
    setBoard(game, [
        { r: 0, c: 0, player: 'black', color: 'blue', sumo: 3 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'blue';

    const result = game.isValidMove(0, 0, 2, 0, 'black');
    assert(!result.valid, 'Rank 3 should be limited to 1 space');
    assert(!result.valid && result.reason.includes('max 1'), 'Should mention max 1: ' + result.reason);
});

test('Rank 3 can move 1 space', () => {
    const game = createGame();
    setBoard(game, [
        { r: 0, c: 0, player: 'black', color: 'blue', sumo: 3 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'blue';

    const result = game.isValidMove(0, 0, 1, 0, 'black');
    assert(result.valid, 'Rank 3 should move 1 space: ' + (result.valid ? '' : result.reason));
});

test('Rank 1 limited to 5 spaces', () => {
    const game = createGame();
    setBoard(game, [
        { r: 0, c: 0, player: 'black', color: 'blue', sumo: 1 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'blue';

    const result = game.isValidMove(0, 0, 6, 0, 'black');
    assert(!result.valid, 'Rank 1 should be limited to 5 spaces');
});

test('Rank 2 limited to 3 spaces', () => {
    const game = createGame();
    setBoard(game, [
        { r: 0, c: 0, player: 'black', color: 'blue', sumo: 2 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'blue';

    const result = game.isValidMove(0, 0, 4, 0, 'black');
    assert(!result.valid, 'Rank 2 should be limited to 3 spaces');
});

// ==========================================
// PUSH CHAIN AND AFTERMATH
// ==========================================
console.log('\n--- Push Mechanics ---\n');

test('Pushed pieces move correctly', () => {
    const game = createGame();
    setBoard(game, [
        { r: 0, c: 0, player: 'black', color: 'blue', sumo: 2 },
        { r: 1, c: 0, player: 'white', color: 'red', sumo: 0 },
        { r: 2, c: 0, player: 'white', color: 'green', sumo: 0 },
        { r: 7, c: 7, player: 'white', color: 'orange', sumo: 0 } // For turn
    ]);
    game.turn = 'black';
    game.requiredColor = 'blue';

    game.makeMove(0, 0, 1, 0, 'black');

    // After push: Blue at 1,0. Red at 2,0. Green at 3,0
    const pusher = game.board[1][0];
    const pushed1 = game.board[2][0];
    const pushed2 = game.board[3][0];

    assert(pusher !== null && pusher.color === 'blue', 'Pusher should be at 1,0');
    assert(pushed1 !== null && pushed1.color === 'red', 'First pushed at 2,0');
    assert(pushed2 !== null && pushed2.color === 'green', 'Second pushed at 3,0');
});

// ==========================================
// TURN LOGIC
// ==========================================
console.log('\n--- Turn Logic ---\n');

test('Cannot move on opponent turn', () => {
    const game = createGame();
    setBoard(game, [
        { r: 0, c: 0, player: 'black', color: 'blue', sumo: 0 }
    ]);
    game.turn = 'white'; // White's turn
    game.requiredColor = 'red';

    const result = game.isValidMove(0, 0, 3, 0, 'black');
    assert(!result.valid, 'Cannot move on opponent turn');
});

test('First move can be any piece', () => {
    const game = createGame();
    setBoard(game, [
        { r: 0, c: 0, player: 'black', color: 'blue', sumo: 0 },
        { r: 0, c: 1, player: 'black', color: 'red', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = null; // First move - no required color

    const result1 = game.isValidMove(0, 0, 3, 0, 'black');
    const result2 = game.isValidMove(0, 1, 3, 1, 'black');
    assert(result1.valid, 'Should move blue piece');
    assert(result2.valid, 'Should move red piece');
});

// ==========================================
// DIAGONAL PUSH (NOT ALLOWED)
// ==========================================
console.log('\n--- Diagonal Push ---\n');

test('Diagonal push is not allowed', () => {
    const game = createGame();
    setBoard(game, [
        { r: 3, c: 3, player: 'black', color: 'blue', sumo: 1 },
        { r: 4, c: 4, player: 'white', color: 'red', sumo: 0 }
    ]);
    game.turn = 'black';
    game.requiredColor = 'blue';

    const result = game.isValidMove(3, 3, 4, 4, 'black');
    // Sumo push only works on straight moves
    assert(!result.valid, 'Diagonal push should fail');
    assert(!result.valid && (result.reason.includes('occupied') || result.reason.includes('Destination')),
        'Should mention destination occupied: ' + result.reason);
});

// ==========================================
// SUMMARY
// ==========================================
console.log('\n=== Test Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);

if (failed > 0) {
    process.exit(1);
} else {
    console.log('\nAll tests passed!');
}
