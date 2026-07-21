// ─── Piece & Board Types ───────────────────────────────────────────

export type PieceColor = 'orange' | 'blue' | 'purple' | 'pink' | 'yellow' | 'red' | 'green' | 'brown';
export type PlayerColor = 'black' | 'white';

export interface Piece {
  color: PieceColor;
  player: PlayerColor;
  sumo: number;
  r: number;
  c: number;
}

export type Board = (Piece | null)[][];

// ─── Move Validation ───────────────────────────────────────────────

export type MoveValidation =
  | { valid: true; isPush?: false }
  | { valid: true; isPush: true; pushEndR: number }
  | { valid: false; reason: string };

// ─── Game State ────────────────────────────────────────────────────

export type RoundState = 'waiting_start' | 'playing' | 'waiting_confirmation' | 'waiting_fill_choice' | 'finished';
export type PositionMode = 'standard' | 'fill' | 'random';
export type FillDirection = 'left' | 'right';

export interface TimerState {
  enabled: boolean;
  initialLimit: number;
  remaining: Record<PlayerColor, number>;
  lastTimestamp: number | null;
}

export interface GameState {
  id: string;
  board: Board;
  turn: PlayerColor;
  requiredColor: PieceColor | null;
  winner: PlayerColor | 'DRAW' | null;
  roundWinner: PlayerColor | null;
  roundState: RoundState;
  round: number;
  scores: Record<PlayerColor, number>;
  finished: boolean;
  confirmations: PlayerColor[];
  timer: TimerState;
  positionMode: PositionMode;
  roundPositionInfo: { blackIndex: number; whiteIndex: number } | null;
  defender: PlayerColor | null;
}

// ─── Game Settings ─────────────────────────────────────────────────

export interface GameSettings {
  matchType?: string;
  timer?: string;
  colorMode?: string;
  positionMode?: PositionMode;
}

// ─── Socket.IO Event Interfaces ────────────────────────────────────

export interface CreateGameData {
  matchType: string;
  timer: string;
  colorMode: string;
  positionMode?: string;
  playerId: string;
}

export interface CreateGameResponse {
  success: boolean;
  message?: string;
  gameId?: string;
  color?: PlayerColor;
  gameState?: GameState;
}

export interface JoinGameData {
  gameId: string;
  playerId: string;
}

export interface JoinGameResponse {
  success: boolean;
  message?: string;
  gameId?: string;
  color?: PlayerColor;
  isSpectator?: boolean;
  gameState?: GameState;
  opponentDisconnected?: boolean;
  timeoutSeconds?: number;
  roundTimerEndTime?: number | null;
}

export interface SessionCheckResponse {
  active: boolean;
  success?: boolean;
  gameId?: string;
  color?: PlayerColor;
  isSpectator?: boolean;
  gameState?: GameState;
  opponentDisconnected?: boolean;
  timeoutSeconds?: number;
  roundTimerEndTime?: number | null;
}

export interface MoveData {
  fromR: number;
  fromC: number;
  toR: number;
  toC: number;
}

export interface ServerToClientEvents {
  gameStateUpdate: (state: GameState) => void;
  gameEnded: (data: { reason: string; winner: PlayerColor | 'DRAW' }) => void;
  playerJoined: (data: { color: PlayerColor }) => void;
  playerDisconnected: (data: { playerId: string; timeoutSeconds: number }) => void;
  playerReconnected: (data: { color: PlayerColor; playerId: string }) => void;
  sessionTakenOver: () => void;
  lobbyExpired: () => void;
  roundTimerStart: (data: { endTime: number }) => void;
  error: (data: { message: string }) => void;
}

export interface ClientToServerEvents {
  createGame: (data: CreateGameData, cb: (res: CreateGameResponse) => void) => void;
  joinGame: (data: JoinGameData, cb: (res: JoinGameResponse) => void) => void;
  cancelGame: (data: { gameId: string }, cb: (res: { success: boolean; message?: string }) => void) => void;
  checkActiveSession: (data: { playerId: string }, cb: (res: SessionCheckResponse) => void) => void;
  makeMove: (data: { gameId: string; move: MoveData }) => void;
  confirmNextRound: (data: { gameId: string }) => void;
  fillChoice: (data: { gameId: string; direction: FillDirection }) => void;
}
