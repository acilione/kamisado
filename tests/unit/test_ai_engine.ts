import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { KamisadoGame } from '../../src/server/game.js';
import { chooseFillDirection, chooseMove, evaluatePosition } from '../../src/server/ai/engine.js';
import { afterMove, createPosition, legalMoves, positionKey } from '../../src/server/ai/position.js';
import { AI_LEVELS, isAiLevel } from '../../src/shared/ai-levels.js';
import { BOARD_COLORS } from '../../src/shared/constants.js';
import type { MoveData, PieceColor, PlayerColor } from '../../src/shared/types.js';

function test(name: string, fn: () => void): void {
  fn();
  console.log(`PASS: ${name}`);
}

function game(empty = false): KamisadoGame {
  const result = new KamisadoGame('ai-test', { matchType: '15', timer: '0', positionMode: 'standard' });
  result.startGame();
  if (empty) result.board = Array.from({ length: 8 }, () => Array(8).fill(null));
  return result;
}

function piece(position: KamisadoGame, player: PlayerColor, color: PieceColor, r: number, c: number, sumo = 0): void {
  position.board[r][c] = { player, color, r, c, sumo };
}

function valid(position: KamisadoGame, move: MoveData | null): void {
  assert(move, 'search must return a move');
  assert(position.isValidMove(move.fromR, move.fromC, move.toR, move.toC, position.turn).valid);
}

const complete = { maxTimeMs: 30_000, maxNodes: 1_000_000 };

test('Exactly ten increasing resource profiles and strict integer validation', () => {
  assert.equal(AI_LEVELS.length, 10);
  for (const [index, profile] of AI_LEVELS.entries()) {
    assert.equal(profile.level, index + 1);
    assert(isAiLevel(profile.level));
    if (index) {
      assert(profile.maxDepth >= AI_LEVELS[index - 1].maxDepth);
      assert(profile.maxNodes > AI_LEVELS[index - 1].maxNodes);
      assert(profile.maxTimeMs > AI_LEVELS[index - 1].maxTimeMs);
      assert(profile.accuracy >= AI_LEVELS[index - 1].accuracy);
    }
  }
  for (const value of [0, 11, 1.5, '5', NaN, Infinity, null]) assert(!isAiLevel(value));
  const position = game();
  assert.throws(() => chooseMove(position.toJson(), position.settings, 0), /1 to 10/);
});

test('Every level returns legal forced-color moves without changing the snapshot or clocks', () => {
  const position = game();
  position.requiredColor = 'orange';
  position.timerState.enabled = true;
  position.timerState.lastTimestamp = 1234;
  const state = position.toJson();
  const before = JSON.stringify(state);
  for (let level = 1; level <= 10; level++) {
    const result = chooseMove(state, position.settings, level, { ...complete, maxNodes: 300 });
    valid(position, result.move);
    assert.equal(position.board[result.move!.fromR][result.move!.fromC]!.color, 'orange');
    assert(result.nodes <= 300);
  }
  assert.equal(JSON.stringify(state), before);
});

test('Ray move generation agrees with exhaustive authoritative validation across a playout', () => {
  const position = game();
  const key = (move: MoveData): string => `${move.fromR}${move.fromC}${move.toR}${move.toC}`;
  for (let ply = 0; ply < 18; ply++) {
    const moves = legalMoves(position);
    const expected: string[] = [];
    for (const ownPiece of position.getPlayerPieces(position.turn)) {
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          if (position.isValidMove(ownPiece.r, ownPiece.c, r, c, position.turn).valid) {
            expected.push(key({ fromR: ownPiece.r, fromC: ownPiece.c, toR: r, toC: c }));
          }
        }
      }
    }
    assert.deepEqual(moves.map(key).sort(), expected.sort());
    if (!moves.length) break;
    const move = moves[(ply * 7 + 3) % moves.length];
    position.makeMove(move.fromR, move.fromC, move.toR, move.toC, position.turn);
    if (position.finished) break;
    if (position.roundState === 'waiting_confirmation') position.startNextRound();
  }
});

test('Every level takes an immediate round win for either side', () => {
  for (const side of ['black', 'white'] as const) {
    const position = game(true);
    position.turn = side;
    position.requiredColor = 'orange';
    piece(position, side, 'orange', side === 'black' ? 6 : 1, 3);
    for (let level = 1; level <= 10; level++) {
      const result = chooseMove(position.toJson(), position.settings, level, complete);
      valid(position, result.move);
      const child = afterMove(position, result.move!);
      assert.equal(child.roundWinner, side);
      assert.equal(child.finished, false, 'a round win is not treated as an entire match');
      assert(result.score >= 1_000_000 && result.score < 10_000_000);
    }
  }
});

test('A match-winning promotion is scored above an ordinary round win', () => {
  const position = game(true);
  position.requiredColor = 'orange';
  piece(position, 'black', 'orange', 6, 3, 1);
  position.scores.black = 13;
  const result = chooseMove(position.toJson(), position.settings, 10, complete);
  const child = afterMove(position, result.move!);
  assert.equal(child.finished, true);
  assert.equal(child.scores.black, 15);
  assert.equal(child.board[result.move!.toR][result.move!.toC]!.sumo, 2);
  assert(result.score >= 10_000_000);
});

test('Search recognizes a winning continuation after a sumo push retains the turn', () => {
  for (const side of ['black', 'white'] as const) {
    const position = game(true);
    const opponent = side === 'black' ? 'white' : 'black';
    const r = side === 'black' ? 3 : 4;
    const c = side === 'black' ? 3 : 4;
    const dr = side === 'black' ? 1 : -1;
    position.turn = side;
    position.requiredColor = 'orange';
    piece(position, side, 'orange', r, c, 3);
    piece(position, opponent, 'red', r + dr, c);
    const nextColor = BOARD_COLORS[r + dr * 2][c];
    piece(position, side, nextColor, side === 'black' ? 5 : 2, side === 'black' ? 0 : 7);
    const push = { fromR: r, fromC: c, toR: r + dr, toC: c };
    const pushed = afterMove(position, push);
    assert.equal(pushed.turn, side);
    assert.equal(pushed.requiredColor, nextColor);
    const result = chooseMove(position.toJson(), position.settings, 10, { ...complete, maxDepth: 2 });
    assert.deepEqual(result.move, push);
    assert(result.score >= 1_000_000);
  }
});

test('Canonical forced passes are preserved when they return the turn to the mover', () => {
  const position = game(true);
  position.requiredColor = 'orange';
  piece(position, 'black', 'orange', 1, 0);
  const destination = { fromR: 1, fromC: 0, toR: 2, toC: 0 };
  const blockedColor = BOARD_COLORS[2][0];
  piece(position, 'white', blockedColor, 1, 7);
  piece(position, 'black', 'red', 0, 6);
  piece(position, 'black', 'blue', 0, 7);
  const repeatColor = BOARD_COLORS[1][7];
  piece(position, 'black', repeatColor, 5, 2);
  const child = afterMove(position, destination);
  assert.equal(child.turn, 'black');
  assert.equal(child.requiredColor, repeatColor);
  assert.equal(child.roundWinner, null);
  const result = chooseMove(child.toJson(), child.settings, 10, { ...complete, maxDepth: 1 });
  assert(result.score >= 1_000_000);
  assert.equal(afterMove(child, result.move!).roundWinner, 'black');
});

test('Zero time or node budget returns a legal fallback promptly', () => {
  const position = game();
  for (const options of [{ maxTimeMs: 0 }, { maxNodes: 0 }]) {
    const started = performance.now();
    const result = chooseMove(position.toJson(), position.settings, 10, options);
    valid(position, result.move);
    assert.equal(result.depth, 0);
    assert.equal(result.nodes, 0);
    assert.equal(result.completed, false);
    assert(performance.now() - started < 500);
  }
});

test('Fixed node budgets produce reproducible choices and preserve the last completed iteration', () => {
  const position = game();
  position.requiredColor = 'blue';
  const options = { ...complete, maxNodes: 350, maxDepth: 8 };
  const a = chooseMove(position.toJson(), position.settings, 10, options);
  const b = chooseMove(position.toJson(), position.settings, 10, options);
  assert.deepEqual(a.move, b.move);
  assert.equal(a.score, b.score);
  assert.equal(a.depth, b.depth);
  assert.equal(a.nodes, b.nodes);
  assert.equal(a.nodes, 350);
  assert(a.depth > 0 && a.depth < 8);
  const completedIteration = chooseMove(position.toJson(), position.settings, 10, { ...complete, maxDepth: a.depth });
  assert.deepEqual(a.move, completedIteration.move);
  assert.equal(a.score, completedIteration.score);
});

function minimax(position: KamisadoGame, root: PlayerColor, depth: number): number {
  if (!depth || position.finished || position.roundWinner) return evaluatePosition(position, root);
  const moves = legalMoves(position);
  if (!moves.length) return evaluatePosition(position, root);
  const scores = moves.map(move => minimax(afterMove(position, move), root, depth - 1));
  return position.turn === root ? Math.max(...scores) : Math.min(...scores);
}

test('Alpha-beta and TT bounds match exhaustive minimax at a fixed depth', () => {
  const position = game();
  position.requiredColor = 'orange';
  const snapshot = createPosition(position.toJson(), position.settings);
  const expected = minimax(snapshot, snapshot.turn, 3);
  for (const useTranspositionTable of [false, true]) {
    const result = chooseMove(position.toJson(), position.settings, 10, { ...complete, maxDepth: 3, useTranspositionTable });
    assert.equal(result.depth, 3);
    assert.equal(result.score, expected);
    assert.equal(minimax(afterMove(snapshot, result.move!), snapshot.turn, 2), expected);
  }
  const key = positionKey(snapshot);
  snapshot.requiredColor = 'blue';
  assert.notEqual(positionKey(snapshot), key, 'forced color participates in the TT identity');
});

test('Cached and uncached searches agree through a deterministic multi-round playout', () => {
  const position = game();
  let searched = 0;
  for (let ply = 0; ply < 16; ply++) {
    const options = { ...complete, maxDepth: 4 };
    const cached = chooseMove(position.toJson(), position.settings, 10, options);
    const uncached = chooseMove(position.toJson(), position.settings, 10, { ...options, useTranspositionTable: false });
    assert.equal(cached.score, uncached.score, `TT score differs at ply ${ply}`);
    assert.equal(cached.depth, uncached.depth);
    searched++;
    const moves = legalMoves(position);
    if (!moves.length) break;
    const move = moves[(ply * 13 + 7) % moves.length];
    position.makeMove(move.fromR, move.fromC, move.toR, move.toC, position.turn);
    if (position.finished) break;
    if (position.roundState === 'waiting_confirmation') position.startNextRound();
  }
  assert.equal(searched, 16);
  assert(position.round > 1, 'fixture must exercise promotions after a round');
});

test('Game-over and between-round snapshots return no move', () => {
  const position = game();
  position.roundState = 'waiting_confirmation';
  position.roundWinner = 'black';
  assert.equal(chooseMove(position.toJson(), position.settings, 10).move, null);
  position.finished = true;
  position.winner = 'white';
  assert.equal(chooseMove(position.toJson(), position.settings, 10).move, null);
});

test('Fill selection is legal, deterministic, and leaves the original round untouched', () => {
  const position = game();
  position.positionMode = 'fill';
  position.roundState = 'waiting_fill_choice';
  position.roundWinner = 'black';
  position.defender = 'black';
  const state = position.toJson();
  const before = JSON.stringify(state);
  const direction = chooseFillDirection(state, position.settings, 10);
  assert(['left', 'right'].includes(direction));
  assert.equal(chooseFillDirection(state, position.settings, 10), direction);
  assert.equal(JSON.stringify(state), before);
  const simulation = createPosition(state, position.settings);
  simulation.handleFillChoice('black', direction);
  assert.equal(simulation.roundState, 'playing');
});
