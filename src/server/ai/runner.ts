import path from 'path';
import { Worker } from 'worker_threads';
import type { GameSettings, GameState, MoveData } from '../../shared/types.js';

interface SearchRequest {
    state: GameState;
    settings: GameSettings;
    level: number;
    maxTimeMs: number;
}

export interface ComputerTask {
    result: Promise<MoveData | null>;
    cancel(): void;
}

interface Job {
    request: SearchRequest;
    requestId: number;
    resolve(move: MoveData | null): void;
    reject(error: Error): void;
    worker?: Worker;
    timer?: ReturnType<typeof setTimeout>;
    termination?: Promise<number>;
    done: boolean;
}

// Bound both CPU use and memory if several browser clients start games at once.
const MAX_WORKERS = 2;
const MAX_QUEUED = 16;
const queued: Job[] = [];
const running = new Set<Job>();
let sequence = 0;

function finish(job: Job, move: MoveData | null, error?: Error): void {
    if (job.done) return;
    job.done = true;
    if (job.timer) clearTimeout(job.timer);
    const queueIndex = queued.indexOf(job);
    if (queueIndex >= 0) queued.splice(queueIndex, 1);
    error ? job.reject(error) : job.resolve(move);
    if (job.worker) {
        // Keep the slot occupied until termination completes, including cancellation.
        job.termination = job.worker.terminate().finally(() => {
            running.delete(job);
            drain();
        });
    } else {
        running.delete(job);
        drain();
    }
}

function drain(): void {
    while (running.size < MAX_WORKERS && queued.length) {
        const job = queued.shift()!;
        if (job.done) continue;
        running.add(job);
        try {
            const worker = __filename.endsWith('.ts')
                ? new Worker(`require('tsx/cjs'); require(${JSON.stringify(path.join(__dirname, 'worker.ts'))});`, { eval: true })
                : new Worker(path.join(__dirname, 'worker.js'));
            job.worker = worker;
            worker.on('message', (message: { requestId?: number; error?: string; result?: { move: MoveData | null } }) => {
                if (message.requestId !== job.requestId) return;
                if (message.error || !message.result) {
                    finish(job, null, new Error(message.error || 'Computer returned no search result'));
                } else {
                    finish(job, message.result.move);
                }
            });
            worker.once('error', error => finish(job, null, error instanceof Error ? error : new Error(String(error))));
            worker.once('exit', () => {
                if (!job.done) finish(job, null, new Error('Computer worker exited before returning a move'));
            });
            // Search has its own deadline; this also catches worker startup failures
            // or a search that stops checking its budget.
            job.timer = setTimeout(() => finish(job, null, new Error('Computer search timed out')),
                job.request.maxTimeMs + 1500);
            worker.postMessage({ requestId: job.requestId, ...job.request });
        } catch (error) {
            finish(job, null, error instanceof Error ? error : new Error(String(error)));
        }
    }
}

export function requestComputerMove(request: SearchRequest): ComputerTask {
    let job: Job;
    const result = new Promise<MoveData | null>((resolve, reject) => {
        job = { request, requestId: ++sequence, resolve, reject, done: false };
        if (queued.length >= MAX_QUEUED) {
            reject(new Error('Computer search queue is full'));
            job.done = true;
            return;
        }
        queued.push(job);
        drain();
    });
    return { result, cancel: () => finish(job!, null) };
}

export async function stopComputerWorkers(): Promise<void> {
    // Clear waiting jobs first so cancellation cannot start another queued job.
    const jobs = [...queued.splice(0), ...running];
    for (const job of jobs) finish(job, null);
    await Promise.all(jobs.map(job => job.termination));
}
