/** Resource ceilings, not Elo ratings. Search always returns a legal completed result. */
export interface AiLevel {
  readonly level: number;
  readonly name: string;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxTimeMs: number;
  /** Lower levels may choose a deterministically varied, near-best nonterminal move. */
  readonly accuracy: number;
}

export const AI_LEVELS: readonly AiLevel[] = [
  { level: 1, name: 'First steps', maxDepth: 1, maxNodes: 150, maxTimeMs: 50, accuracy: 25 },
  { level: 2, name: 'Beginner', maxDepth: 1, maxNodes: 400, maxTimeMs: 80, accuracy: 60 },
  { level: 3, name: 'Learner', maxDepth: 2, maxNodes: 1_000, maxTimeMs: 120, accuracy: 75 },
  { level: 4, name: 'Casual', maxDepth: 3, maxNodes: 2_500, maxTimeMs: 180, accuracy: 90 },
  { level: 5, name: 'Club', maxDepth: 4, maxNodes: 6_000, maxTimeMs: 300, accuracy: 100 },
  { level: 6, name: 'Practised', maxDepth: 5, maxNodes: 15_000, maxTimeMs: 500, accuracy: 100 },
  { level: 7, name: 'Challenging', maxDepth: 6, maxNodes: 35_000, maxTimeMs: 750, accuracy: 100 },
  { level: 8, name: 'Advanced', maxDepth: 7, maxNodes: 75_000, maxTimeMs: 1_100, accuracy: 100 },
  { level: 9, name: 'Expert', maxDepth: 8, maxNodes: 120_000, maxTimeMs: 1_500, accuracy: 100 },
  { level: 10, name: 'Master', maxDepth: 9, maxNodes: 180_000, maxTimeMs: 2_000, accuracy: 100 },
];

export function isAiLevel(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 10;
}
