import type { ComputerTask, SearchRequest } from '../shared/computer-task.js';
import type { MoveData } from '../shared/types.js';

// Embedded by the mobile build so workers also work on iOS's capacitor:// origin.
declare const KAMISADO_AI_WORKER_SOURCE: string;

/** One mobile match at a time; termination also cancels an unfinished search. */
export function requestComputerMove(request: SearchRequest): ComputerTask {
    let worker: Worker | undefined;
    let workerUrl: string | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let settle: (move: MoveData | null) => void;
    let done = false;
    const result = new Promise<MoveData | null>(resolve => { settle = resolve; });
    const finish = (move: MoveData | null): void => {
        if (done) return;
        done = true;
        clearTimeout(deadline);
        worker?.terminate();
        if (workerUrl) URL.revokeObjectURL(workerUrl);
        settle(move);
    };
    try {
        workerUrl = URL.createObjectURL(new Blob([KAMISADO_AI_WORKER_SOURCE], { type: 'application/javascript' }));
        worker = new Worker(workerUrl);
        worker.onmessage = event => finish(event.data?.move ?? null);
        worker.onerror = () => finish(null);
        worker.onmessageerror = () => finish(null);
        // Mobile WebViews can take several seconds to start a worker on a busy device.
        // This watchdog bounds startup; the engine separately enforces its search budget.
        deadline = setTimeout(() => finish(null), request.maxTimeMs + 5000);
        worker.postMessage(request);
    } catch { finish(null); }
    return { result, cancel: () => finish(null) };
}
