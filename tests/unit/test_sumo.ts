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
    const game = new KamisadoGame('test-sumo', { matchType: '3', timer: '0' });
    game.board = Array(8).fill(null).map(() => Array(8).fill(null));
    game.roundState = 'playing';
    game.finished = false;
    return game;
}

function placePiece(game: KamisadoGame, r: number, c: number, player: PlayerColor, color: PieceColor, sumo = 0): void {
    game.board[r][c] = { player, color, sumo, r, c };
}

console.log('=== Sumo Push Rules Tests ===\n');

// ============= MOVEMENT RANGE TESTS =============
console.log('--- Movement Range Tests ---\n');

test('S1: Sumo (rank 1) max 5 spaces', () => {
    const game = createGame();
    placePiece(game, 1, 0, 'black', 'orange', 1);
    game.turn = 'black';
    game.requiredColor = 'orange';

    // 5 spaces should work
    const r5 = game.isValidMove(1, 0, 6, 0, 'black');
    assert(r5.valid, 'Should allow 5 spaces');

    // 6 spaces should fail
    const r6 = game.isValidMove(1, 0, 7, 0, 'black');
    assert(!r6.valid, 'Should block 6 spaces');
    assert(!r6.valid && r6.reason.includes('max 5'), `Reason should mention max 5, got: ${r6.reason}`);
});

test('DS1: Double Sumo (rank 2) max 3 spaces', () => {
    const game = createGame();
    placePiece(game, 1, 0, 'black', 'orange', 2);
    game.turn = 'black';
    game.requiredColor = 'orange';

    // 3 spaces should work
    const r3 = game.isValidMove(1, 0, 4, 0, 'black');
    assert(r3.valid, 'Should allow 3 spaces');

    // 4 spaces should fail
    const r4 = game.isValidMove(1, 0, 5, 0, 'black');
    assert(!r4.valid, 'Should block 4 spaces');
    assert(!r4.valid && r4.reason.includes('max 3'), `Reason should mention max 3, got: ${r4.reason}`);
});

test('Triple Sumo (rank 3) max 1 space', () => {
    const game = createGame();
    placePiece(game, 3, 3, 'black', 'orange', 3);
    game.turn = 'black';
    game.requiredColor = 'orange';

    // 1 space should work
    const r1 = game.isValidMove(3, 3, 4, 4, 'black');
    assert(r1.valid, 'Should allow 1 space');

    // 2 spaces should fail
    const r2 = game.isValidMove(3, 3, 5, 5, 'black');
    assert(!r2.valid, 'Should block 2 spaces');
});

// ============= PUSH CAPACITY TESTS =============
console.log('\n--- Push Capacity Tests ---\n');

test('S7: Sumo (rank 1) can push 1 piece', () => {
    const game = createGame();
    // Black sumo at (3,0), white normal at (4,0), empty at (5,0)
    placePiece(game, 3, 0, 'black', 'orange', 1);
    placePiece(game, 4, 0, 'white', 'red', 0);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const result = game.isValidMove(3, 0, 4, 0, 'black');
    assert(result.valid && result.isPush === true, 'Should allow pushing 1 piece');
});

test('S7: Sumo (rank 1) cannot push 2 pieces', () => {
    const game = createGame();
    // Black sumo at (3,0), two white normals at (4,0) and (5,0)
    placePiece(game, 3, 0, 'black', 'orange', 1);
    placePiece(game, 4, 0, 'white', 'red', 0);
    placePiece(game, 5, 0, 'white', 'green', 0);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const result = game.isValidMove(3, 0, 4, 0, 'black');
    assert(!result.valid, 'Should not push 2 pieces with rank 1');
});

test('DS7: Double Sumo (rank 2) can push 2 pieces', () => {
    const game = createGame();
    // Black double sumo at (3,0), two white normals at (4,0) and (5,0), empty at (6,0)
    placePiece(game, 3, 0, 'black', 'orange', 2);
    placePiece(game, 4, 0, 'white', 'red', 0);
    placePiece(game, 5, 0, 'white', 'green', 0);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const result = game.isValidMove(3, 0, 4, 0, 'black');
    assert(result.valid && result.isPush === true, 'Should allow pushing 2 pieces with rank 2');
});

// ============= RANK COMPARISON TESTS =============
console.log('\n--- Rank Comparison Tests ---\n');

test('S8: Sumo (rank 1) cannot push another Sumo (rank 1)', () => {
    const game = createGame();
    placePiece(game, 3, 0, 'black', 'orange', 1);
    placePiece(game, 4, 0, 'white', 'red', 1);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const result = game.isValidMove(3, 0, 4, 0, 'black');
    assert(!result.valid, 'Should not push equal rank');
});

test('DS8: Double Sumo (rank 2) CAN push Sumo (rank 1)', () => {
    const game = createGame();
    placePiece(game, 3, 0, 'black', 'orange', 2);
    placePiece(game, 4, 0, 'white', 'red', 1);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const result = game.isValidMove(3, 0, 4, 0, 'black');
    assert(result.valid && result.isPush === true, 'Double Sumo should push single Sumo');
});

test('DS8: Double Sumo (rank 2) cannot push another Double Sumo (rank 2)', () => {
    const game = createGame();
    placePiece(game, 3, 0, 'black', 'orange', 2);
    placePiece(game, 4, 0, 'white', 'red', 2);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const result = game.isValidMove(3, 0, 4, 0, 'black');
    assert(!result.valid, 'Double Sumo should not push equal rank');
});

// ============= HOME ROW PROTECTION TESTS (S6) =============
console.log('\n--- Home Row Protection Tests (S6) ---\n');

test('S6: Cannot push white piece on white home row (row 7)', () => {
    const game = createGame();
    // Black sumo at (6,0), white normal at (7,0) - white's home row
    placePiece(game, 6, 0, 'black', 'orange', 1);
    placePiece(game, 7, 0, 'white', 'brown', 0);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const result = game.isValidMove(6, 0, 7, 0, 'black');
    assert(!result.valid, 'Should not push piece on its home row');
    assert(!result.valid && result.reason.includes('home row'), `Reason should mention home row, got: ${result.reason}`);
});

test('S6: Cannot push black piece on black home row (row 0)', () => {
    const game = createGame();
    // White sumo at (1,0), black normal at (0,0) - black's home row
    placePiece(game, 1, 0, 'white', 'green', 1);
    placePiece(game, 0, 0, 'black', 'orange', 0);
    game.turn = 'white';
    game.requiredColor = 'green';

    const result = game.isValidMove(1, 0, 0, 0, 'white');
    assert(!result.valid, 'Should not push piece on its home row');
});

test('S6: Can push piece that is NOT on its home row', () => {
    const game = createGame();
    // Black sumo at (3,0), white normal at (4,0) - NOT white's home row
    placePiece(game, 3, 0, 'black', 'orange', 1);
    placePiece(game, 4, 0, 'white', 'red', 0);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const result = game.isValidMove(3, 0, 4, 0, 'black');
    assert(result.valid && result.isPush === true, 'Should allow push when piece is not on home row');
});

// ============= EXTRA TURN TESTS (S3) =============
console.log('\n--- Extra Turn After Push Tests (S3) ---\n');

test('S3: After sumo push, turn stays with the same player', () => {
    const game = createGame();
    // Black sumo at (3,0), white normal at (4,0), empty at (5,0)
    placePiece(game, 3, 0, 'black', 'orange', 1);
    placePiece(game, 4, 0, 'white', 'red', 0);
    game.turn = 'black';
    game.requiredColor = 'orange';

    game.makeMove(3, 0, 4, 0, 'black');

    assert(game.turn === 'black', `Turn should stay black, got: ${game.turn}`);
});

test('S3: Normal move switches turn to opponent', () => {
    const game = createGame();
    // Black normal at (3,0), empty ahead
    placePiece(game, 3, 0, 'black', 'orange', 0);
    game.turn = 'black';
    game.requiredColor = 'orange';

    game.makeMove(3, 0, 4, 0, 'black');

    assert(String(game.turn) === 'white', `Turn should switch to white, got: ${game.turn}`);
});

// ============= NEXT COLOR AFTER PUSH TESTS (S5) =============
console.log('\n--- Next Color After Push Tests (S5) ---\n');

test('S5: After push, requiredColor = color of square pushed piece landed on', () => {
    const game = createGame();
    // Black sumo at (3,0), white normal at (4,0), empty at (5,0)
    // BOARD_COLORS[5][0] = the color of the square where pushed piece lands
    placePiece(game, 3, 0, 'black', 'orange', 1);
    placePiece(game, 4, 0, 'white', 'red', 0);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const expectedColor = BOARD_COLORS[5][0]; // Where the pushed piece lands
    game.makeMove(3, 0, 4, 0, 'black');

    assert(game.requiredColor === expectedColor,
        `requiredColor should be ${expectedColor} (landing square), got: ${game.requiredColor}`);
});

test('S5: After normal move, requiredColor = color of destination square', () => {
    const game = createGame();
    placePiece(game, 3, 0, 'black', 'orange', 0);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const expectedColor = BOARD_COLORS[4][0]; // Where piece moves to
    game.makeMove(3, 0, 4, 0, 'black');

    assert(game.requiredColor === expectedColor,
        `requiredColor should be ${expectedColor}, got: ${game.requiredColor}`);
});

test('DS3: Double sumo push 2 pieces, requiredColor = furthest landing square color', () => {
    const game = createGame();
    placePiece(game, 2, 0, 'black', 'orange', 2);
    placePiece(game, 3, 0, 'white', 'red', 0);
    placePiece(game, 4, 0, 'white', 'yellow', 0);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const expectedColor = BOARD_COLORS[5][0]; // furthest landing square
    game.makeMove(2, 0, 3, 0, 'black');

    // Turn should stay with black
    assert(game.turn === 'black', `Turn should stay black after double push, got: ${game.turn}`);
    assert(game.requiredColor === expectedColor,
        `requiredColor should be ${expectedColor}, got: ${game.requiredColor}`);
});

// ============= FULL PUSH + EXTRA TURN SEQUENCE =============
console.log('\n--- Full Push Sequence Tests ---\n');

test('Full sequence: push then move with correct piece', () => {
    const game = createGame();
    // Black sumo at (3,2), white normal at (4,2), empty at (5,2)
    // After push: requiredColor = BOARD_COLORS[5][2] = 'yellow'
    // Then black should move the yellow piece
    placePiece(game, 3, 2, 'black', 'orange', 1);
    placePiece(game, 4, 2, 'white', 'red', 0);

    // Place a black yellow piece somewhere for the follow-up move
    const nextColor = BOARD_COLORS[5][2]; // The landing square color
    placePiece(game, 2, 4, 'black', nextColor, 0);

    game.turn = 'black';
    game.requiredColor = 'orange';

    // Make the push
    game.makeMove(3, 2, 4, 2, 'black');

    // Verify state after push
    assert(game.turn === 'black', 'Turn should stay black');
    assert(game.requiredColor === nextColor, `Required color should be ${nextColor}`);

    // Try to move wrong piece (should fail)
    const wrongResult = game.isValidMove(4, 2, 5, 2, 'black');
    // Black sumo is now at (4,2) with color 'orange', but requiredColor is nextColor
    if (wrongResult.valid === false) {
        // Expected - wrong color piece
    }

    // Move the correct piece (the nextColor piece)
    const correctResult = game.isValidMove(2, 4, 3, 4, 'black');
    // This should be valid only if piece color matches requiredColor
    if (game.board[2][4] && game.board[2][4].color === nextColor) {
        assert(correctResult.valid, 'Should be able to move the correct colored piece');
    }
});

// ============= EDGE CASES =============
console.log('\n--- Edge Cases ---\n');

test('Cannot push own piece', () => {
    const game = createGame();
    placePiece(game, 3, 0, 'black', 'orange', 1);
    placePiece(game, 4, 0, 'black', 'red', 0);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const result = game.isValidMove(3, 0, 4, 0, 'black');
    assert(!result.valid, 'Should not push own piece');
});

test('Cannot push diagonally', () => {
    const game = createGame();
    placePiece(game, 3, 3, 'black', 'orange', 1);
    placePiece(game, 4, 4, 'white', 'red', 0);
    game.turn = 'black';
    game.requiredColor = 'orange';

    const result = game.isValidMove(3, 3, 4, 4, 'black');
    // Should be treated as normal move to occupied square (not a push)
    assert(!result.valid, 'Should not push diagonally - destination occupied');
});

test('Cannot push if no empty square behind', () => {
    const game = createGame();
    // Black sumo at (5,0), white at (6,0), another piece at (7,0)
    placePiece(game, 5, 0, 'black', 'orange', 1);
    placePiece(game, 6, 0, 'white', 'red', 0);
    placePiece(game, 7, 0, 'white', 'brown', 0); // blocking exit
    game.turn = 'black';
    game.requiredColor = 'orange';

    const result = game.isValidMove(5, 0, 6, 0, 'black');
    assert(!result.valid, 'Should not push when blocked behind');
});

// Summary
console.log('\n=== Test Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);

process.exit(failed > 0 ? 1 : 0);
