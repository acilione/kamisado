import type { GameSettings, GameState, MoveData } from './types.js';

export interface SearchRequest {
    state: GameState;
    settings: GameSettings;
    level: number;
    maxTimeMs: number;
}
export interface ComputerTask {
    result: Promise<MoveData | null>;
    cancel(): void;
}
