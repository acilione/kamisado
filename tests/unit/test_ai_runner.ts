import assert from 'assert/strict';
import { KamisadoGame } from '../../src/server/game.js';
import { requestComputerMove, stopComputerWorkers } from '../../src/server/ai/runner.js';

async function main(): Promise<void> {
    const game = new KamisadoGame('worker-test', {});
    game.startGame();
    const request = { state: game.toJson(), settings: game.settings, level: 1, maxTimeMs: 50 };
    try {
        const move = await requestComputerMove(request).result;
        assert(move && game.isValidMove(move.fromR, move.fromC, move.toR, move.toC, game.turn).valid);

        await assert.rejects(requestComputerMove({ ...request, level: 11 }).result);
        assert(await requestComputerMove(request).result, 'A failed worker must release its slot');
        await stopComputerWorkers();

        // Submissions are synchronous, so none can complete while filling the
        // two active slots and sixteen queue positions.
        const tasks = Array.from({ length: 19 }, () => requestComputerMove({ ...request, level: 10, maxTimeMs: 2000 }));
        const results = tasks.map(task => task.result.catch(error => error as Error));
        for (const task of tasks.slice(0, 18)) task.cancel();
        const values = await Promise.all(results);
        assert(values.slice(0, 18).every(value => value === null), 'Both active and queued jobs must cancel');
        assert(values[18] instanceof Error && /queue is full/.test(values[18].message), 'Queue size must be bounded');

        const stopped = [requestComputerMove(request), requestComputerMove(request), requestComputerMove(request)];
        await stopComputerWorkers();
        assert.deepEqual(await Promise.all(stopped.map(task => task.result)), [null, null, null]);
        assert(await requestComputerMove(request).result, 'Workers must work again after a host restart');
        console.log('Computer worker tests passed: legal result, worker failure, bounded queue, cancellation and restart.');
    } finally {
        await stopComputerWorkers();
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
