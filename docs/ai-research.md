# Classical Kamisado AI research

Research reviewed on 2026-10-02. The intended opponent uses explicit rules, tree search, and hand-written evaluation. No neural networks, training data, remote inference, or external engine service are needed.

## Starting reference

The supplied [wizard-chess engine research](https://github.com/acilione/wizard-chess/blob/main/public/engines/RESEARCH.txt) was read through the authenticated GitHub API. Its useful transferable ideas are iterative deepening, alpha-beta search, bounded transposition memory, move ordering, weaker-level score perturbations, and cancellation of background searches. Chess-specific material values, check evasions, capture quiescence, repetition rules, and unconditional alternating-turn negamax do not transfer directly to Kamisado.

## Additional primary research

- **Dan Setterquist and Peter Skeppstedt, _Constructing a Kamisado playing agent_ (KTH, 2013).** Their agent uses alpha-beta search and compares tower progress, goal-reaching opportunities, and mobility. Their stronger tested combinations emphasize goal-reaching opportunities, then progress, then mobility. Their experiments use 40 marathon matches per pairing, with each agent opening half; this is useful direction for an evaluator, not a calibrated human difficulty rating. They also report a forced first-player win within 17 moves from the standard single-round starting position. That result does not establish perfect play for arbitrary layouts, promoted pieces, or this implementation. [Original thesis](https://www.csc.kth.se/utbildning/kth/kurser/DD143X/dkand13/Group4Per/report/17-setterquist-skeppstedt.pdf)
- **Donald E. Knuth and Ronald W. Moore, _An Analysis of Alpha-Beta Pruning_ (1975).** Alpha-beta eliminates branches that cannot affect the minimax choice. Its effectiveness depends strongly on ordering; fixed-depth heuristic search is still an approximation to the complete game. This supports a transparent, bounded search before adding more selective techniques. [Original paper, university-hosted copy](https://webdocs.cs.ualberta.ca/~mmueller/courses/657-Fall2025/readings/1975-AIJ-Knuth-Moore-alphabeta.pdf)
- **Aske Plaat, Jonathan Schaeffer, Wim Pijls and Arie de Bruin, _A New Paradigm for Minimax Search_ and _SSS* = Alpha-Beta + TT_.** These sources, also cited by wizard-chess, emphasize the practical interaction of iterative deepening, memory, and move ordering. They inform the architecture; choosing alpha-beta does not mean implementing MTD(f) or SSS*, or reproducing their chess/checkers/Othello performance. [First paper](https://arxiv.org/abs/1404.1515), [second paper](https://arxiv.org/abs/1404.1517)
- **Peter Burley, official Kamisado rulebook.** The forced-color rule, blocked-turn chains, deadlock loss, and sumo extra turns determine the search state and successor function. The PDF is the original rulebook mirrored by Boardspace. [Rules PDF](https://www.boardspace.net/kamisado/english/RULES%20ENG.pdf)
- **Node.js worker-thread documentation.** CPU-intensive JavaScript belongs in a worker so search does not block Socket.IO traffic, timers, or other matches. Worker termination and result identity checks address different failure modes; both are useful. [Official documentation](https://nodejs.org/api/worker_threads.html)

## Kamisado-specific design recommendations

1. **Use the game's authoritative transitions.** Generate legal forward rays for the required tower (all eight on the first move), validate sumo pushes, and simulate the same rules as human moves. Clone search state without starting clocks, scheduling timers, or changing live games.
2. **Choose max/min from the actual side to move.** Sumo pushes keep the same player; forced passes can also return control to the mover. A root-perspective minimax avoids assuming that every tree edge flips the score. Turn-aware negamax would also work.
3. **Resolve forced passes before evaluating.** A blocked tower sends control to the opponent tower matching its current square. Continue until a movable tower is found or a `(player, required color)` pair repeats on the unchanged board. Two blocked towers alone do not prove deadlock. The last player who actually moved loses a repeated-chain deadlock, including after a push. This follows rule M8 and the rulebook's worked blocked-turn examples.
4. **Distinguish terminal results from estimates.** A win/loss must dominate every heuristic and difficulty perturbation. In multi-round games, score value depends on the winning tower's rank and the match target. A practical first implementation can stop at round boundaries and score those outcomes; it must not claim to solve the remaining match. Preferring quicker forced wins and later forced losses within the same search iteration is a possible refinement; the current terminal score does not include distance-to-win.
5. **Evaluate relevant threats.** Combine immediate goal-reaching opportunities, forward progress, legal mobility, and the currently forced tower's options. Account for rank movement limits. A tower's distance from the goal alone is insufficient: its landing color may hand the opponent an immediate win. Use original, documented coefficients rather than claiming that thesis ranking weights are interchangeable with raw feature weights.
6. **Keep the search bounded and interruptible.** Iteratively deepen under depth, node, and time ceilings. Preserve the last complete iteration and a legal fallback. Run search outside the server's event loop, reduce its deadline near clock expiry, and discard results if their game/revision/player is no longer current.
7. **Make caching correct before making it clever.** Include occupancy, ownership, tower colors/ranks, required color, turn, and relevant match context. Distinguish exact values from lower/upper bounds and qualify entries by remaining depth. Never store an incomplete search as exact. If scores depend on root distance, normalize them or include that distance in the cache context.
8. **Do not import unsafe chess shortcuts.** Voluntary null moves are illegal here. Capture-only quiescence has no direct analogue; a future tactical extension would need to cover forced winning threats and sumo sequences under its own strict budget. Full-width alpha-beta is easier to audit initially.

## Ten levels and calibration

The levels should increase search depth and node/time budgets, while reducing bounded root-choice variation. Apply variation only to completed root alternatives, never to cached leaf values or terminal wins/losses. Levels are relative settings, not Elo ratings; a deeper search is not guaranteed to choose a better move in every position.

The implementation's [exported difficulty profiles](../src/shared/ai-levels.ts) define these ceilings:

| Level | Maximum depth | Node ceiling | Time ceiling (ms) |
| --- | ---: | ---: | ---: |
| 1 | 1 | 150 | 50 |
| 2 | 1 | 400 | 80 |
| 3 | 2 | 1,000 | 120 |
| 4 | 3 | 2,500 | 180 |
| 5 | 4 | 6,000 | 300 |
| 6 | 5 | 15,000 | 500 |
| 7 | 6 | 35,000 | 750 |
| 8 | 7 | 75,000 | 1,100 |
| 9 | 8 | 120,000 | 1,500 |
| 10 | 9 | 180,000 | 2,000 |

These are engineering limits, not measurements or published strength claims. Hardware and position branching affect completed depth. Levels 1–4 select reproducibly among moves near the best score, with narrowing tolerance; levels 5–10 select the best completed search score. Proven terminal wins and losses are excluded from this weakening. Before interpreting levels as a strength ladder, run paired-color matches across standard/random/fill setups and a fixed tactical suite. Record wins, nodes, completed depth, and elapsed time. Test forced wins, forced-color defense, sumo extra turns, pass chains, promotion, fill choices, cancellation, disconnect/rejoin, worker failure, and clock expiry separately from playing-strength experiments.

## Implementation scope

The [engine](../src/server/ai/engine.ts) implements fixed-root alpha-beta minimax and iterative deepening, with legal successors simulated by the authoritative `KamisadoGame` methods on private snapshots. The table holds at most 50,000 entries per request, with exact/lower/upper bounds, remaining depth, and a preferred move. Its full position keys include piece locations, colors, ranks, ownership, turn, required color, scores, round status, and winners; the match settings are constant within each request. A completed iteration is preserved if a later one reaches a deadline. Levels 5–10 prune at the root as well; levels 1–4 search root alternatives with full windows so their score comparison is exact.

The handwritten evaluator uses these coefficients, from Black's perspective and negated for White:

- Match score difference: 100 per point.
- Tower advance from its home row: `2 × advance² + 5 × advance` per tower.
- Promotion: 12 per rank; legal mobility: 2 per available move.
- Goal threats: 110 per distinct tower with a legal goal-reaching move.
- Side-to-move options: 3 per move of the required tower, plus 1,200 when that tower can reach the goal immediately. With no forced color, all its towers are eligible.

A round result scores ±1,000,000 and an actual match result ±10,000,000, plus the point-score difference. Search stops at that round boundary; it does not search future random layouts or pretend that a single round settles a multi-round match. Fill direction is chosen by comparing both canonical resulting layouts with the same evaluator, with a deterministic left tie-break.

Levels 1–4 use accuracy parameters 25, 60, 75, and 90. A stable position/level hash selects among completed nonterminal root alternatives within `2 × (100 − accuracy)` points of the best evaluation. Levels 5–10 use accuracy 100 and choose the best result. These parameters describe a search setting, not the percentage of correct moves.

The [worker runner](../src/server/ai/runner.ts) keeps search off the server event loop, limits concurrency to two workers and sixteen queued searches, and terminates canceled work. Server integration checks request generation, game identity, round, turn, and connection state before validating the returned move against the live board. Search time is also limited to one twentieth of the computer's remaining clock; worker startup and queue time still count against that clock. The server falls back to a legal move if a worker fails, and checks clock expiry before applying it.

The [engine tests](../tests/unit/test_ai_engine.ts) cover legal generation against exhaustive canonical validation, all ten levels, wins for both colors, promotion and match scoring, retained turns after pushes and passes, snapshot isolation, legal deadline fallback, repeatability under node budgets, exhaustive minimax agreement, and cached/uncached agreement through a multi-round playout. Integration and runner tests separately cover lifecycle behavior. These checks establish rule and search behavior, not calibrated human playing strength.

The engine, difficulty profiles, and tests define what is actually shipped. Recommendations such as tactical extensions, preference for shorter wins, strength calibration, or complete multi-round solving are not implementation claims. This implementation has no opening book, solved-position database, or trained evaluator.

## Local responsiveness check

A timing check on 2026-10-02 used Node.js 24.10.0 in Ubuntu under WSL, the standard untouched opening, untimed three-point matches, and default budgets. Other development work was running concurrently. Levels 1 through 10 completed depths **1, 1, 1, 2, 4, 4, 5, 5, 6, 6**. Level 1 searched 102 nodes in about 35 ms; level 5 searched 4,883 nodes in about 191 ms; level 10 searched 68,020 nodes in about 2,000 ms. These are one-run responsiveness observations, not strength measurements or portable performance guarantees. The level 3 result also illustrates that a depth ceiling is not a promise that every iteration fits its node budget.
