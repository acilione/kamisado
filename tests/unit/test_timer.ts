import { KamisadoGame } from '../../src/server/game.js';

console.log('Testing Chess Clock Logic...');

let passed = 0;
let failed = 0;

function pass(msg: string): void {
    console.log(`✓ PASS: ${msg}`);
    passed++;
}

function fail(msg: string, detail?: unknown): void {
    console.error(`✗ FAIL: ${msg}`, detail ?? '');
    failed++;
}

// 1. Init with Timer
const game = new KamisadoGame('test-timer', { matchType: '3', timer: '60' }); // 60 seconds
if (game.timerState.enabled && game.timerState.remaining.black === 60000) {
    pass('Timer initialized correctly (60s).');
} else {
    fail('Timer init failed.', game.timerState);
}

// 2. Start Game
game.startGame();
if (game.timerState.lastTimestamp !== null && game.timerState.lastTimestamp > 0) {
    pass('Game start sets timestamp.');
} else {
    fail('Game start missing timestamp.');
}

// 3. Simulate elapsed time
// Artificially age the timestamp by 5 seconds
game.timerState.lastTimestamp! -= 5000;

// 4. Update Timer (Black's turn)
game.updateTimer();
const remaining = game.timerState.remaining.black;
if (remaining <= 55100 && remaining >= 54900) { // Tolerate small execution time diffs
    pass(`Timer deducted approx 5s. Remaining: ${remaining}`);
} else {
    fail(`Timer deduction incorrect. Remaining: ${remaining}`);
}

// 5. Test Timeout
game.timerState.remaining.black = 10; // 10ms left
game.timerState.lastTimestamp = Date.now() - 20; // 20ms elapsed
const result = game.updateTimer();

if (result && result.timeout && result.player === 'black') {
    pass('Timeout detected correctly.');
} else {
    fail('Timeout detection failed.', result);
}

console.log('\n=== Test Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);

if (failed > 0) {
    process.exit(1);
} else {
    console.log('\nAll tests passed!');
}
