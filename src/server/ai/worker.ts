import { parentPort } from 'node:worker_threads';
import type { GameSettings, GameState } from '../../shared/types.js';
import { chooseMove } from './engine.js';

interface SearchRequest {
  requestId: string | number;
  state: GameState;
  settings: GameSettings;
  level: number;
  maxTimeMs?: number;
}

parentPort?.on('message', (request: SearchRequest) => {
  try {
    const result = chooseMove(request.state, request.settings, request.level, { maxTimeMs: request.maxTimeMs });
    parentPort!.postMessage({ requestId: request.requestId, result });
  } catch (error) {
    parentPort!.postMessage({ requestId: request.requestId, error: error instanceof Error ? error.message : 'Search failed' });
  }
});
