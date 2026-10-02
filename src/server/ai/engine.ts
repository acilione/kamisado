import { performance } from 'node:perf_hooks';
import { AI_LEVELS, isAiLevel } from '../../shared/ai-levels.js';
import type { FillDirection, GameSettings, GameState, MoveData, PlayerColor } from '../../shared/types.js';
import type { KamisadoGame } from '../game.js';
import { afterMove, copyPosition, createPosition, legalMoves, positionKey } from './position.js';

const ROUND_WIN = 1_000_000;
const MATCH_WIN = 10_000_000;
const TERMINAL_THRESHOLD = ROUND_WIN / 2;
const SEARCH_INTERRUPTED = Symbol('search interrupted');

export interface SearchOptions {
  maxTimeMs?: number;
  maxNodes?: number;
  maxDepth?: number;
  useTranspositionTable?: boolean;
}

export interface SearchResult {
  move: MoveData | null;
  score: number;
  /** Last fully completed iteration, zero when returning the legal fallback. */
  depth: number;
  nodes: number;
  elapsedMs: number;
  completed: boolean;
}

interface Entry {
  depth: number;
  score: number;
  bound: 'exact' | 'lower' | 'upper';
  move: MoveData | null;
}

function moveKey(move: MoveData): number {
  return ((move.fromR * 8 + move.fromC) * 8 + move.toR) * 8 + move.toC;
}

function terminalScore(position: KamisadoGame, player: PlayerColor): number | null {
  if (position.winner === 'DRAW') return 0;
  const winner = position.winner || position.roundWinner;
  if (!winner) return null;
  const value = position.finished ? MATCH_WIN : ROUND_WIN;
  const points = position.scores.black - position.scores.white;
  return (winner === player ? value : -value) + (player === 'black' ? points : -points) * 100;
}

/** Handwritten, symmetric evaluation. No training data or neural inference. */
export function evaluatePosition(position: KamisadoGame, player: PlayerColor): number {
  const terminal = terminalScore(position, player);
  if (terminal !== null) return terminal;
  let score = (position.scores.black - position.scores.white) * 100;
  const originalTurn = position.turn;
  const originalRequired = position.requiredColor;
  try {
    for (const side of ['black', 'white'] as const) {
      const sign = side === 'black' ? 1 : -1;
      position.turn = side;
      position.requiredColor = null;
      const moves = legalMoves(position);
      const goalRow = side === 'black' ? 7 : 0;
      const winningColors = new Set<string>();
      let forcedMobility = 0;
      let forcedWinning = false;
      for (const move of moves) {
        const piece = position.board[move.fromR][move.fromC]!;
        if (move.toR === goalRow) winningColors.add(piece.color);
        if (!originalRequired || piece.color === originalRequired) {
          forcedMobility++;
          if (move.toR === goalRow) forcedWinning = true;
        }
      }
      let progress = 0;
      let promotion = 0;
      for (const piece of position.getPlayerPieces(side)) {
        const advanced = side === 'black' ? piece.r : 7 - piece.r;
        progress += advanced * advanced * 2 + advanced * 5;
        promotion += piece.sumo * 12;
      }
      // Threats dominate progress; several safe choices are better than a narrow route.
      score += sign * (progress + promotion + moves.length * 2 + winningColors.size * 110);
      if (side === originalTurn) {
        score += sign * (forcedMobility * 3 + (forcedWinning ? 1_200 : 0));
      }
    }
  } finally {
    position.turn = originalTurn;
    position.requiredColor = originalRequired;
  }
  return player === 'black' ? score : -score;
}

function orderedMoves(position: KamisadoGame, preferred?: MoveData | null): MoveData[] {
  const preferredKey = preferred ? moveKey(preferred) : -1;
  const goalRow = position.turn === 'black' ? 7 : 0;
  const priority = (move: MoveData): number => {
    if (move.toR === goalRow) return 1_000_000;
    if (moveKey(move) === preferredKey) return 100_000;
    const push = position.board[move.toR][move.toC] !== null;
    return (push ? 10_000 : 0) + Math.abs(move.toR - move.fromR) * 10;
  };
  return legalMoves(position).sort((a, b) => priority(b) - priority(a) || moveKey(a) - moveKey(b));
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16_777_619);
  return hash >>> 0;
}

/** Fixed-root minimax: sumo pushes and forced passes can leave the same side to move. */
export function chooseMove(state: GameState, settings: GameSettings, level: number, options: SearchOptions = {}): SearchResult {
  if (!isAiLevel(level)) throw new RangeError('AI level must be an integer from 1 to 10');
  const config = AI_LEVELS[level - 1];
  const started = performance.now();
  const maxTime = Math.max(0, options.maxTimeMs ?? config.maxTimeMs);
  const maxNodes = Math.max(0, Math.floor(options.maxNodes ?? config.maxNodes));
  const maxDepth = Math.max(0, Math.floor(options.maxDepth ?? config.maxDepth));
  const deadline = started + maxTime;
  const position = createPosition(state, settings);
  const rootPlayer = position.turn;
  const moves = orderedMoves(position);
  const table = new Map<string, Entry>();
  const tableEnabled = options.useTranspositionTable !== false;
  let nodes = 0;
  let reachedDepth = 0;
  let resultMove = moves[0] ?? null;
  let resultScore = evaluatePosition(position, rootPlayer);
  let completed = moves.length === 0;

  const checkBudget = (): void => {
    if (nodes >= maxNodes || performance.now() >= deadline) throw SEARCH_INTERRUPTED;
  };

  const search = (node: KamisadoGame, depth: number, alpha: number, beta: number): number => {
    checkBudget();
    nodes++;
    const terminal = terminalScore(node, rootPlayer);
    if (terminal !== null) return terminal;
    if (depth === 0) return evaluatePosition(node, rootPlayer);
    const key = tableEnabled ? positionKey(node) : '';
    const entry = tableEnabled ? table.get(key) : undefined;
    const originalAlpha = alpha;
    const originalBeta = beta;
    if (entry && entry.depth >= depth) {
      if (entry.bound === 'exact') return entry.score;
      if (entry.bound === 'lower') alpha = Math.max(alpha, entry.score);
      else beta = Math.min(beta, entry.score);
      if (alpha >= beta) return entry.score;
    }
    const maximizing = node.turn === rootPlayer;
    const children = orderedMoves(node, entry?.move);
    if (!children.length) return evaluatePosition(node, rootPlayer);
    let best = maximizing ? -Infinity : Infinity;
    let bestMove: MoveData | null = null;
    for (const move of children) {
      const score = search(afterMove(node, move), depth - 1, alpha, beta);
      if (maximizing ? score > best : score < best) {
        best = score;
        bestMove = move;
      }
      if (maximizing) alpha = Math.max(alpha, best);
      else beta = Math.min(beta, best);
      if (alpha >= beta) break;
    }
    if (tableEnabled) {
      const bound = best <= originalAlpha ? 'upper' : best >= originalBeta ? 'lower' : 'exact';
      // Bounded per-request memory; an interrupted iteration never changes its returned move.
      if (table.size < 50_000 || table.has(key)) table.set(key, { depth, score: best, bound, move: bestMove });
    }
    return best;
  };

  try {
    for (let depth = 1; moves.length && depth <= maxDepth; depth++) {
      const candidates: { move: MoveData; score: number }[] = [];
      let rootAlpha = -Infinity;
      for (const move of orderedMoves(position, resultMove)) {
        // Beginners need exact candidate scores for controlled variation. Stronger
        // levels also prune at the root, keeping the first move when a bound ties.
        const score = search(afterMove(position, move), depth - 1,
          config.accuracy < 100 ? -Infinity : rootAlpha, Infinity);
        candidates.push({ move, score });
        rootAlpha = Math.max(rootAlpha, score);
      }
      candidates.sort((a, b) => b.score - a.score || (config.accuracy < 100 ? moveKey(a.move) - moveKey(b.move) : 0));
      let selected = candidates[0];
      if (config.accuracy < 100 && Math.abs(selected.score) < TERMINAL_THRESHOLD) {
        const window = (100 - config.accuracy) * 2;
        const alternatives = candidates.filter(candidate =>
          Math.abs(candidate.score) < TERMINAL_THRESHOLD && candidate.score >= selected.score - window);
        selected = alternatives[stableHash(`${positionKey(position)}/${level}`) % alternatives.length];
      }
      resultMove = selected.move;
      resultScore = selected.score;
      reachedDepth = depth;
      completed = depth === maxDepth || Math.abs(candidates[0].score) >= TERMINAL_THRESHOLD;
      if (completed) break;
    }
  } catch (error) {
    if (error !== SEARCH_INTERRUPTED) throw error;
  }
  return { move: resultMove, score: resultScore, depth: reachedDepth, nodes, elapsedMs: performance.now() - started, completed };
}

/** Both fill directions use canonical layout/promotion rules; ties consistently choose left. */
export function chooseFillDirection(state: GameState, settings: GameSettings, _level = 1): FillDirection {
  if (state.roundState !== 'waiting_fill_choice' || !state.defender) return 'left';
  const position = createPosition(state, settings);
  let best: FillDirection = 'left';
  let bestScore = -Infinity;
  for (const direction of ['left', 'right'] as const) {
    const candidate = copyPosition(position);
    candidate.handleFillChoice(state.defender, direction);
    const score = evaluatePosition(candidate, state.defender);
    if (score > bestScore) {
      best = direction;
      bestScore = score;
    }
  }
  return best;
}
