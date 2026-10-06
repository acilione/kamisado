import { chooseMove } from '../server/ai/engine.js';
import type { SearchRequest } from '../shared/computer-task.js';

self.onmessage = (event: MessageEvent<SearchRequest>) => {
    const { state, settings, level, maxTimeMs } = event.data;
    try { self.postMessage({ move: chooseMove(state, settings, level, { maxTimeMs }).move }); }
    catch (error) { self.postMessage({ move: null, error: error instanceof Error ? error.message : String(error) }); }
};
