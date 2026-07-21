import type { PieceColor } from './types.js';

export const BOARD_COLORS: readonly (readonly PieceColor[])[] = [
  ['orange', 'blue', 'purple', 'pink', 'yellow', 'red', 'green', 'brown'],
  ['red', 'orange', 'pink', 'green', 'blue', 'yellow', 'brown', 'purple'],
  ['green', 'pink', 'orange', 'red', 'purple', 'brown', 'yellow', 'blue'],
  ['pink', 'purple', 'blue', 'orange', 'brown', 'green', 'red', 'yellow'],
  ['yellow', 'red', 'green', 'brown', 'orange', 'blue', 'purple', 'pink'],
  ['blue', 'yellow', 'brown', 'purple', 'red', 'orange', 'pink', 'green'],
  ['purple', 'brown', 'yellow', 'blue', 'green', 'pink', 'orange', 'red'],
  ['brown', 'green', 'red', 'yellow', 'pink', 'purple', 'blue', 'orange'],
];

export const STANDARD_LAYOUT: readonly PieceColor[] = [
  'orange', 'blue', 'purple', 'pink', 'yellow', 'red', 'green', 'brown',
];

export const POSITION_LAYOUTS: readonly (readonly PieceColor[])[] = [
  STANDARD_LAYOUT,                                                              // 0
  ['blue', 'pink', 'red', 'orange', 'brown', 'purple', 'yellow', 'green'],     // 1
  ['blue', 'pink', 'red', 'brown', 'orange', 'purple', 'yellow', 'green'],     // 2
  ['blue', 'red', 'pink', 'orange', 'brown', 'yellow', 'purple', 'green'],     // 3
  ['yellow', 'orange', 'green', 'purple', 'red', 'blue', 'brown', 'pink'],     // 4
  ['blue', 'pink', 'red', 'orange', 'yellow', 'purple', 'brown', 'green'],     // 5
  ['yellow', 'blue', 'red', 'orange', 'brown', 'purple', 'green', 'pink'],     // 6
  ['blue', 'red', 'pink', 'brown', 'orange', 'yellow', 'purple', 'green'],     // 7
  ['yellow', 'green', 'orange', 'purple', 'red', 'brown', 'blue', 'pink'],     // 8
  ['pink', 'orange', 'green', 'purple', 'red', 'blue', 'brown', 'yellow'],     // 9
  ['yellow', 'blue', 'red', 'brown', 'orange', 'purple', 'green', 'pink'],     // 10
  ['pink', 'blue', 'red', 'orange', 'brown', 'purple', 'green', 'yellow'],     // 11
  ['blue', 'pink', 'orange', 'red', 'purple', 'brown', 'yellow', 'green'],     // 12
  ['yellow', 'blue', 'orange', 'purple', 'red', 'brown', 'green', 'pink'],     // 13
  ['yellow', 'green', 'purple', 'orange', 'brown', 'red', 'blue', 'pink'],     // 14
  ['pink', 'green', 'purple', 'orange', 'brown', 'red', 'blue', 'yellow'],     // 15
  ['green', 'pink', 'red', 'orange', 'brown', 'purple', 'yellow', 'blue'],     // 16
  ['blue', 'red', 'orange', 'pink', 'yellow', 'brown', 'purple', 'green'],     // 17
  ['pink', 'green', 'orange', 'purple', 'red', 'brown', 'blue', 'yellow'],     // 18
  ['pink', 'blue', 'red', 'brown', 'orange', 'purple', 'green', 'yellow'],     // 19
  ['yellow', 'blue', 'purple', 'brown', 'orange', 'red', 'green', 'pink'],     // 20
  ['pink', 'orange', 'green', 'red', 'purple', 'blue', 'brown', 'yellow'],     // 21
  ['green', 'pink', 'red', 'brown', 'orange', 'purple', 'yellow', 'blue'],     // 22
  ['green', 'red', 'pink', 'orange', 'brown', 'yellow', 'purple', 'blue'],     // 23
  ['green', 'orange', 'red', 'pink', 'yellow', 'purple', 'brown', 'blue'],     // 24
  ['pink', 'green', 'purple', 'brown', 'orange', 'red', 'blue', 'yellow'],     // 25
  ['red', 'green', 'pink', 'orange', 'brown', 'yellow', 'blue', 'purple'],     // 26
  ['green', 'red', 'pink', 'brown', 'orange', 'yellow', 'purple', 'blue'],     // 27
  ['pink', 'blue', 'orange', 'red', 'purple', 'brown', 'green', 'yellow'],     // 28
  ['red', 'blue', 'pink', 'orange', 'brown', 'yellow', 'green', 'purple'],     // 29
  ['green', 'pink', 'orange', 'red', 'purple', 'brown', 'yellow', 'blue'],     // 30
  ['red', 'green', 'pink', 'brown', 'orange', 'yellow', 'blue', 'purple'],     // 31
  ['red', 'orange', 'green', 'pink', 'yellow', 'blue', 'brown', 'purple'],     // 32
  ['green', 'red', 'orange', 'pink', 'yellow', 'brown', 'purple', 'blue'],     // 33
  ['red', 'blue', 'pink', 'purple', 'orange', 'yellow', 'green', 'brown'],     // 34
  ['red', 'green', 'orange', 'pink', 'yellow', 'brown', 'blue', 'purple'],     // 35
  ['red', 'blue', 'orange', 'pink', 'yellow', 'brown', 'green', 'purple'],     // 36
];
