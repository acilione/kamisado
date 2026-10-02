import { KamisadoGame } from '../game.js';
import { STANDARD_LAYOUT } from '../../shared/constants.js';
import type { GameSettings, GameState, MoveData } from '../../shared/types.js';

/** A private snapshot using the authoritative rules, without starting clocks or drawing layouts. */
export function createPosition(state: GameState, settings: GameSettings): KamisadoGame {
  const position = Object.create(KamisadoGame.prototype) as KamisadoGame;
  Object.assign(position, {
    id: state.id,
    settings: { ...settings },
    board: state.board.map(row => row.map(piece => piece ? { ...piece } : null)),
    turn: state.turn,
    requiredColor: state.requiredColor,
    winner: state.winner,
    roundWinner: state.roundWinner,
    round: state.round,
    scores: { ...state.scores },
    finished: state.finished,
    roundState: state.roundState,
    confirmations: new Set(state.confirmations),
    roundTimeout: null,
    timerState: { ...state.timer, enabled: false, remaining: { ...state.timer.remaining }, lastTimestamp: null },
    sumoRanks: new Map(state.board.flat().filter(piece => piece !== null)
      .map(piece => [`${piece.player}_${piece.color}`, piece.sumo])),
    positionMode: state.positionMode,
    lastRoundEndPositions: state.roundState === 'waiting_fill_choice'
      ? state.board.map(row => row.map(piece => piece ? { ...piece } : null)) : null,
    roundPositionInfo: state.roundPositionInfo ? { ...state.roundPositionInfo } : null,
    defender: state.defender,
  });
  return position;
}

export function copyPosition(position: KamisadoGame): KamisadoGame {
  return Object.assign(Object.create(KamisadoGame.prototype) as KamisadoGame, position, {
    board: position.board.map(row => row.map(piece => piece ? { ...piece } : null)),
    scores: { ...position.scores },
    sumoRanks: new Map(position.sumoRanks),
    confirmations: new Set(position.confirmations),
  });
}

export function legalMoves(position: KamisadoGame): MoveData[] {
  if (position.finished || position.roundState !== 'playing') return [];
  const result: MoveData[] = [];
  const direction = position.turn === 'black' ? 1 : -1;
  for (const piece of position.getPlayerPieces(position.turn)) {
    if (position.requiredColor && piece.color !== position.requiredColor) continue;
    for (const dc of [0, -1, 1]) {
      for (let distance = 1; distance <= 7; distance++) {
        const toR = piece.r + direction * distance;
        const toC = piece.c + dc * distance;
        if (toR < 0 || toR > 7 || toC < 0 || toC > 7) break;
        if (position.isValidMove(piece.r, piece.c, toR, toC, position.turn).valid) {
          result.push({ fromR: piece.r, fromC: piece.c, toR, toC });
        }
        if (position.board[toR][toC]) break;
      }
    }
  }
  return result;
}

export function afterMove(position: KamisadoGame, move: MoveData): KamisadoGame {
  const child = copyPosition(position);
  child.makeMove(move.fromR, move.fromC, move.toR, move.toC, child.turn);
  return child;
}

/** Collision-free within a search; clocks and match settings are constant or irrelevant. */
export function positionKey(position: KamisadoGame): string {
  let key = `${position.turn}/${position.requiredColor}/${position.roundState}/${position.winner}/${position.roundWinner}/${position.scores.black}/${position.scores.white}/`;
  for (const row of position.board) {
    for (const piece of row) {
      key += piece ? `${piece.player[0]}${STANDARD_LAYOUT.indexOf(piece.color)}${piece.sumo}` : '.';
    }
  }
  return key;
}
