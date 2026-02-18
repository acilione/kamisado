import { BOARD_COLORS, STANDARD_LAYOUT, POSITION_LAYOUTS } from '../shared/constants.js';
import type {
  Board, Piece, PieceColor, PlayerColor, MoveValidation,
  GameState, GameSettings, TimerState, RoundState, PositionMode, FillDirection,
} from '../shared/types.js';

export class KamisadoGame {
  id: string;
  settings: GameSettings;
  board: Board;
  turn: PlayerColor;
  requiredColor: PieceColor | null;
  winner: PlayerColor | 'DRAW' | null;
  roundWinner: PlayerColor | null;
  round: number;
  scores: Record<PlayerColor, number>;
  finished: boolean;
  roundState: RoundState;
  confirmations: Set<PlayerColor>;
  roundTimeout: ReturnType<typeof setTimeout> | null;
  timerState: TimerState;
  sumoRanks: Map<string, number>;
  positionMode: PositionMode;
  lastRoundEndPositions: Board | null;
  roundPositionInfo: { blackIndex: number; whiteIndex: number } | null;
  defender: PlayerColor | null;

  constructor(id: string, settings: GameSettings) {
    this.id = id;
    this.settings = settings;
    this.board = [];
    this.turn = 'black';
    this.requiredColor = null;
    this.winner = null;
    this.roundWinner = null;
    this.round = 1;
    this.scores = { black: 0, white: 0 };
    this.finished = false;

    this.roundState = 'waiting_start';
    this.confirmations = new Set();
    this.roundTimeout = null;

    const timeLimitSec = parseInt(settings.timer || '0');
    this.timerState = {
      enabled: timeLimitSec > 0,
      initialLimit: timeLimitSec * 1000,
      remaining: {
        black: timeLimitSec * 1000,
        white: timeLimitSec * 1000,
      },
      lastTimestamp: null,
    };

    this.sumoRanks = new Map();

    this.positionMode = (settings.positionMode as PositionMode) || 'standard';
    this.lastRoundEndPositions = null;
    this.roundPositionInfo = null;
    this.defender = null;

    if (this.positionMode === 'random') {
      const indices = this._drawTwoRandomIndices();
      this.roundPositionInfo = { blackIndex: indices[0], whiteIndex: indices[1] };
      this.initializeBoard(
        POSITION_LAYOUTS[indices[0]] as PieceColor[],
        [...POSITION_LAYOUTS[indices[1]]].reverse(),
      );
    } else {
      this.initializeBoard();
    }
  }

  startGame(): void {
    this.roundState = 'playing';
    if (this.timerState.enabled) {
      this.timerState.lastTimestamp = Date.now();
    }
  }

  updateTimer(): { timeout: boolean; player?: PlayerColor } | undefined {
    if (!this.timerState.enabled || this.roundState !== 'playing') return;

    const now = Date.now();
    const elapsed = now - this.timerState.lastTimestamp!;

    this.timerState.remaining[this.turn] -= elapsed;
    this.timerState.lastTimestamp = now;

    if (this.timerState.remaining[this.turn] <= 0) {
      this.timerState.remaining[this.turn] = 0;
      return { timeout: true, player: this.turn };
    }
    return { timeout: false };
  }

  initializeBoard(blackLayout?: readonly PieceColor[], whiteLayout?: readonly PieceColor[]): void {
    const bLayout = blackLayout || STANDARD_LAYOUT;
    const wLayout = whiteLayout || [...STANDARD_LAYOUT].reverse();

    this.board = Array(8).fill(null).map(() => Array(8).fill(null));

    bLayout.forEach((color, colIndex) => {
      const rank = this.sumoRanks.get(`black_${color}`) || 0;
      this.board[0][colIndex] = { color, player: 'black', sumo: rank, r: 0, c: colIndex };
    });

    wLayout.forEach((color, colIndex) => {
      const rank = this.sumoRanks.get(`white_${color}`) || 0;
      this.board[7][colIndex] = { color, player: 'white', sumo: rank, r: 7, c: colIndex };
    });

    if (this.round === 1) {
      this.turn = 'black';
    } else {
      if (this.roundWinner) {
        this.turn = this.roundWinner === 'black' ? 'white' : 'black';
      }
    }

    this.requiredColor = null;
    this.roundWinner = null;
    this.defender = null;
    this.confirmations.clear();
    if (this.timerState && this.timerState.enabled) {
      this.timerState.lastTimestamp = Date.now();
    }
  }

  getPiece(r: number, c: number): Piece | null {
    if (r < 0 || r > 7 || c < 0 || c > 7) return null;
    return this.board[r][c];
  }

  getPlayerPieces(playerColor: PlayerColor): Piece[] {
    const pieces: Piece[] = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.board[r][c];
        if (p && p.player === playerColor) {
          pieces.push(p);
        }
      }
    }
    return pieces;
  }

  isValidMove(fromR: number, fromC: number, toR: number, toC: number, player: PlayerColor): MoveValidation {
    if (this.finished) return { valid: false, reason: 'Game finished' };
    if (this.roundState !== 'playing') return { valid: false, reason: 'Round finished' };
    if (player !== this.turn) return { valid: false, reason: 'Not your turn' };

    const piece = this.getPiece(fromR, fromC);
    if (!piece) return { valid: false, reason: 'No piece at source' };
    if (piece.player !== player) return { valid: false, reason: 'Not your piece' };

    if (this.requiredColor && piece.color !== this.requiredColor) {
      return { valid: false, reason: `Must move ${this.requiredColor} piece` };
    }

    const rDiff = toR - fromR;
    const cDiff = toC - fromC;
    const direction = player === 'black' ? 1 : -1;

    if (Math.sign(rDiff) !== direction) return { valid: false, reason: 'Must move forward' };

    const isStraight = fromC === toC;
    const isDiagonal = Math.abs(rDiff) === Math.abs(cDiff);

    if (!isStraight && !isDiagonal) return { valid: false, reason: 'Move must be straight or diagonal' };

    const dist = Math.max(Math.abs(rDiff), Math.abs(cDiff));
    if (piece.sumo > 0) {
      let limit = 7;
      if (piece.sumo === 1) limit = 5;
      else if (piece.sumo === 2) limit = 3;
      else if (piece.sumo >= 3) limit = 1;

      if (dist > limit) {
        return { valid: false, reason: `Sumo rank ${piece.sumo} moves max ${limit} spaces` };
      }
    }

    const pathBlocked = this.isPathBlocked(fromR, fromC, toR, toC);
    const targetOccupied = this.getPiece(toR, toC) !== null;

    if (targetOccupied) {
      if (isStraight && piece.sumo > 0) {
        return this.isValidSumoPush(piece, fromR, fromC, toR, toC, direction);
      }
      return { valid: false, reason: 'Destination occupied' };
    }

    if (pathBlocked) return { valid: false, reason: 'Path blocked' };

    return { valid: true };
  }

  isPathBlocked(r1: number, c1: number, r2: number, c2: number): boolean {
    const rStep = Math.sign(r2 - r1);
    const cStep = Math.sign(c2 - c1);
    let currR = r1 + rStep;
    let currC = c1 + cStep;

    while (currR !== r2 || currC !== c2) {
      if (this.getPiece(currR, currC)) return true;
      currR += rStep;
      currC += cStep;
    }
    return false;
  }

  isValidSumoPush(pusher: Piece, r1: number, c1: number, r2: number, c2: number, direction: number): MoveValidation {
    if (Math.abs(r2 - r1) !== 1 || c1 !== c2) return { valid: false, reason: 'Sumo push must be against adjacent piece' };

    let pushCount = 0;
    let currR = r2;

    while (true) {
      const p = this.getPiece(currR, c1);
      if (!p) break;

      if (p.player === pusher.player) return { valid: false, reason: 'Cannot push own pieces' };

      const pieceHomeRow = p.player === 'black' ? 0 : 7;
      if (currR === pieceHomeRow) {
        return { valid: false, reason: 'Cannot push piece on its home row' };
      }

      if (p.sumo >= pusher.sumo) {
        return { valid: false, reason: `Rank ${pusher.sumo} cannot push Rank ${p.sumo}` };
      }

      pushCount++;
      currR += direction;
      if (currR < 0 || currR > 7) return { valid: false, reason: 'Cannot push off board' };
    }

    if (pushCount > pusher.sumo) return { valid: false, reason: `Sumo rank ${pusher.sumo} can push max ${pusher.sumo} pieces` };

    if (currR < 0 || currR > 7) return { valid: false, reason: 'Cannot push off board' };
    if (this.getPiece(currR, c1)) return { valid: false, reason: 'Blocked by piece' };

    return { valid: true, isPush: true, pushEndR: currR };
  }

  makeMove(fromR: number, fromC: number, toR: number, toC: number, player: PlayerColor): void {
    const validation = this.isValidMove(fromR, fromC, toR, toC, player);
    if (!validation.valid) throw new Error(validation.reason);

    const piece = this.board[fromR][fromC]!;
    const nextColor = BOARD_COLORS[toR][toC];

    if (validation.isPush) {
      const direction = player === 'black' ? 1 : -1;
      let currR = validation.pushEndR;
      while (currR !== toR) {
        const prevR = currR - direction;
        this.movePieceInternal(prevR, fromC, currR, fromC);
        currR = prevR;
      }
      this.movePieceInternal(fromR, fromC, toR, toC);

      this.requiredColor = BOARD_COLORS[validation.pushEndR][fromC];
      this.handleDeadlockCheck();
      return;
    } else {
      this.movePieceInternal(fromR, fromC, toR, toC);
    }

    if (piece.player === 'black' && toR === 7) {
      this.handleRoundWin(player, piece);
      return;
    }
    if (piece.player === 'white' && toR === 0) {
      this.handleRoundWin(player, piece);
      return;
    }

    this.turn = player === 'black' ? 'white' : 'black';
    this.requiredColor = nextColor;
    this.handleDeadlockCheck();
  }

  movePieceInternal(r1: number, c1: number, r2: number, c2: number): void {
    const p = this.board[r1][c1];
    this.board[r2][c2] = p;
    this.board[r1][c1] = null;
    if (p) { p.r = r2; p.c = c2; }
  }

  handleDeadlockCheck(): void {
    if (!this.canMove(this.turn, this.requiredColor!)) {
      const blockedPiece = this.findPiece(this.turn, this.requiredColor!);
      if (!blockedPiece) return;

      const blockedSquareColor = BOARD_COLORS[blockedPiece.r][blockedPiece.c];

      console.log(`Player ${this.turn} blocked on color ${this.requiredColor}. Passing turn.`);

      this.turn = this.turn === 'black' ? 'white' : 'black';
      this.requiredColor = blockedSquareColor;

      if (!this.canMove(this.turn, this.requiredColor)) {
        const winner: PlayerColor = this.turn === 'black' ? 'white' : 'black';
        this.handleRoundWin(winner, null);
      }
    }
  }

  canMove(player: PlayerColor, color: PieceColor): boolean {
    const piece = this.findPiece(player, color);
    if (!piece) return false;

    const validDirs: [number, number][] = player === 'black'
      ? [[1, 0], [1, 1], [1, -1]]
      : [[-1, 0], [-1, 1], [-1, -1]];

    for (const [dr, dc] of validDirs) {
      const r = piece.r + dr;
      const c = piece.c + dc;
      if (r >= 0 && r <= 7 && c >= 0 && c <= 7) {
        const check = this.isValidMove(piece.r, piece.c, r, c, player);
        if (check.valid) return true;
      }
    }
    return false;
  }

  findPiece(player: PlayerColor, color: PieceColor): Piece | undefined {
    return this.getPlayerPieces(player).find(p => p.color === color);
  }

  handleRoundWin(player: PlayerColor, winningPiece: Piece | null): void {
    if (this.positionMode === 'fill') {
      this.lastRoundEndPositions = this.board.map(row => row.map(cell => cell ? { ...cell } : null));
    }

    this.roundWinner = player;
    this.defender = player;
    this.roundState = 'waiting_confirmation';

    const points = winningPiece ? Math.pow(2, winningPiece.sumo) : 1;
    this.scores[player] += points;

    if (winningPiece) {
      if (winningPiece.sumo < 3) {
        winningPiece.sumo += 1;
        this.sumoRanks.set(`${player}_${winningPiece.color}`, winningPiece.sumo);
      }
    }

    const targetScore = parseInt(this.settings.matchType || '3');
    if (this.scores[player] >= targetScore) {
      this.finished = true;
      this.winner = player;
    }
  }

  confirmNextRound(player: PlayerColor): boolean {
    if (this.roundState !== 'waiting_confirmation') return false;
    this.confirmations.add(player);
    return this.confirmations.size === 2;
  }

  startNextRound(): void {
    this.round += 1;

    if (this.positionMode === 'fill' && this.round > 1) {
      this.roundState = 'waiting_fill_choice';
      return;
    }

    if (this.positionMode === 'random') {
      const indices = this._drawTwoRandomIndices();
      const challenger: PlayerColor = this.roundWinner === 'black' ? 'white' : 'black';
      const challengerIndex = indices[0];
      const defenderIndex = indices[1];

      if (challenger === 'black') {
        this.roundPositionInfo = { blackIndex: challengerIndex, whiteIndex: defenderIndex };
        this.initializeBoard(
          POSITION_LAYOUTS[challengerIndex] as PieceColor[],
          [...POSITION_LAYOUTS[defenderIndex]].reverse(),
        );
      } else {
        this.roundPositionInfo = { blackIndex: defenderIndex, whiteIndex: challengerIndex };
        this.initializeBoard(
          POSITION_LAYOUTS[defenderIndex] as PieceColor[],
          [...POSITION_LAYOUTS[challengerIndex]].reverse(),
        );
      }
    } else {
      this.initializeBoard();
    }

    this.roundState = 'playing';
  }

  _drawTwoRandomIndices(): [number, number] {
    const a = Math.floor(Math.random() * POSITION_LAYOUTS.length);
    let b = Math.floor(Math.random() * POSITION_LAYOUTS.length);
    while (b === a) {
      b = Math.floor(Math.random() * POSITION_LAYOUTS.length);
    }
    return a < b ? [a, b] : [b, a];
  }

  computeFillLayout(playerColor: PlayerColor, direction: FillDirection): PieceColor[] {
    if (!this.lastRoundEndPositions) return [...STANDARD_LAYOUT];

    const pieces: { color: PieceColor; dist: number; col: number }[] = [];
    const homeRow = playerColor === 'black' ? 0 : 7;

    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = this.lastRoundEndPositions[r][c];
        if (p && p.player === playerColor) {
          const dist = Math.abs(r - homeRow);
          pieces.push({ color: p.color, dist, col: c });
        }
      }
    }

    pieces.sort((a, b) => a.dist - b.dist || a.col - b.col);

    const colors = pieces.map(p => p.color);
    if (direction === 'right') {
      colors.reverse();
    }
    return colors;
  }

  handleFillChoice(player: PlayerColor, direction: FillDirection): void {
    if (this.roundState !== 'waiting_fill_choice') {
      throw new Error('Not in fill choice state');
    }
    if (player !== this.defender) {
      throw new Error('Only the defender can choose fill direction');
    }
    if (direction !== 'left' && direction !== 'right') {
      throw new Error('Invalid direction');
    }

    const blackLayout = this.computeFillLayout('black', direction);
    const whiteLayout = this.computeFillLayout('white', direction);

    this.initializeBoard(blackLayout, whiteLayout);
    this.roundState = 'playing';
  }

  toJson(): GameState {
    return {
      id: this.id,
      board: this.board,
      turn: this.turn,
      requiredColor: this.requiredColor,
      winner: this.winner,
      roundWinner: this.roundWinner,
      roundState: this.roundState,
      round: this.round,
      scores: this.scores,
      finished: this.finished,
      confirmations: Array.from(this.confirmations),
      timer: this.timerState,
      positionMode: this.positionMode,
      roundPositionInfo: this.roundPositionInfo,
      defender: this.defender,
    };
  }
}
