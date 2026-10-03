# Computer opponent

The computer player uses minimax search with alpha-beta pruning and a handwritten evaluation function. It runs locally in a Node.js worker thread on desktop, or a Web Worker on mobile, with no neural network, training data, or external engine service.

## Search

[`engine.ts`](../src/server/ai/engine.ts) searches one move deep, then repeats at increasing depths until it reaches the level's depth, node, or time limit. It keeps the result of the last complete iteration. If no iteration finishes, it returns a legal fallback move.

Search positions are private copies of [`KamisadoGame`](../src/server/game.ts), created by [`position.ts`](../src/server/ai/position.ts) with clocks disabled. Human moves and search moves therefore use the same rules for forced colors, sumo pushes, blocked-turn chains, promotion, and scoring.

Scores are measured from the root player's perspective. Each node chooses whether to maximize or minimize according to the actual player to move: a sumo push or a chain of forced passes can leave the same player in control. Assuming that every move switches sides would give incorrect results.

Move ordering tries goal-reaching moves first, then the previous search's preferred move, pushes, and forward progress. A transposition table stores up to 50,000 positions per request. Entries record the remaining depth, preferred move, and whether the score is exact or a lower or upper bound. Position keys include the pieces, ranks, turn, required color, scores, round state, and winners; match settings stay constant within a search request.

Search stops at a round or match result. It does not plan across future rounds or random layouts. For a fill choice, the engine evaluates the two resulting layouts and chooses the better one, choosing left on a tie.

## Evaluation

The evaluator adds the following features for Black and subtracts them for White, then reverses the result when searching for White. These are the implementation's own coefficients, not weights copied from a published playing-strength study.

| Feature | Score |
| --- | ---: |
| Match points | 100 per point |
| Tower progress from its home row | `2 * advance^2 + 5 * advance` per tower |
| Promotion rank | 12 per rank |
| Mobility, considering all towers | 2 per legal move |
| Towers with a legal move to the goal row | 110 per tower |
| Current player's required tower mobility | 3 per legal move |
| Current player's required tower can reach the goal | 1,200 |

When no color is required, the last two features consider all of the current player's towers. Mobility and goal threats respect movement limits and blocking.

A round win or loss scores `+/-1,000,000`; a match result scores `+/-10,000,000`. The match-point difference contributes another 100 per point. These terminal scores dominate the positional features. There is no extra preference for a shorter win or a longer loss.

## Difficulty levels

[`ai-levels.ts`](../src/shared/ai-levels.ts) defines the ten profiles:

| Level | Name | Maximum depth | Node limit | Time limit (ms) |
| --- | --- | ---: | ---: | ---: |
| 1 | First steps | 1 | 150 | 50 |
| 2 | Beginner | 1 | 400 | 80 |
| 3 | Learner | 2 | 1,000 | 120 |
| 4 | Casual | 3 | 2,500 | 180 |
| 5 | Club | 4 | 6,000 | 300 |
| 6 | Practised | 5 | 15,000 | 500 |
| 7 | Challenging | 6 | 35,000 | 750 |
| 8 | Advanced | 7 | 75,000 | 1,100 |
| 9 | Expert | 8 | 120,000 | 1,500 |
| 10 | Master | 9 | 180,000 | 2,000 |

Levels 1-4 can choose a move close to the best score. Their `accuracy` settings are 25, 60, 75, and 90; the allowed score difference is `2 * (100 - accuracy)`. A stable hash of the position and level selects among eligible moves. This variation applies only to completed, nonterminal alternatives, so it cannot override a discovered forced win. These levels search each root move with a full alpha-beta window to obtain comparable scores.

Levels 5-10 use accuracy 100 and choose the best result from the completed search, with pruning at the root as well. The accuracy field controls score tolerance; it is not a percentage of correct moves.

The levels are relative search settings, not Elo ratings. A depth limit is a ceiling: the node or time limit may stop the search earlier. Playing strength has not been calibrated against human players or through a large tournament. Such a comparison should use paired colors, several starting layouts, and a fixed set of tactical positions.

## Server integration

[`runner.ts`](../src/server/ai/runner.ts) allows two active workers and sixteen queued searches. Each worker is terminated when its request finishes, is cancelled, or reaches its deadline. Search time is also capped at one twentieth of the computer's remaining clock; queue time and worker startup still count against that clock.

Before applying a result, the server checks the request generation, game, round, turn, and connection state, then validates the move against the live board. A failed worker produces a legal fallback if time remains. Ending a game, disconnecting, or stopping the server cancels outstanding work.

The [engine tests](../tests/unit/test_ai_engine.ts) compare legal move generation with the rules engine and search results with exhaustive minimax. They cover both colors, all levels, promotions, scoring, retained turns, forced passes, snapshot isolation, budget fallback, and cached versus uncached search. [Runner tests](../tests/unit/test_ai_runner.ts) and [integration tests](../tests/integration/test_ai_games.ts) cover cancellation, failures, clocks, and game lifecycle. See [Development](development.md#tests) for the commands.

## Performance notes

A local check on 2 October 2026 used Node.js 24.10.0 on Ubuntu under WSL, the standard opening, untimed three-point matches, and the default budgets. Other development work was running at the same time.

| Level | Completed depth | Nodes | Elapsed time |
| --- | ---: | ---: | ---: |
| 1 | 1 | 102 | About 35 ms |
| 5 | 4 | 4,883 | About 191 ms |
| 10 | 6 | 68,020 | About 2,000 ms |

Across levels 1-10, completed depths were `1, 1, 1, 2, 4, 4, 5, 5, 6, 6`. This was a responsiveness check on one position, not a strength benchmark; timings and completed depths vary with hardware and position.

## Research references

The [wizard-chess research notes](https://github.com/acilione/wizard-chess/blob/main/public/engines/RESEARCH.txt) provided the starting point for iterative deepening, transposition tables, move ordering, and background search. Kamisado needs its own evaluator and turn handling; chess capture search and voluntary null-move pruning are not used here.

- Dan Setterquist and Peter Skeppstedt, [*Constructing a Kamisado playing agent*](https://www.csc.kth.se/utbildning/kth/kurser/DD143X/dkand13/Group4Per/report/17-setterquist-skeppstedt.pdf), KTH, 2013. A Kamisado-specific study of alpha-beta search and evaluation based on progress, goal opportunities, and mobility.
- Donald E. Knuth and Ronald W. Moore, [*An Analysis of Alpha-Beta Pruning*](https://webdocs.cs.ualberta.ca/~mmueller/courses/657-Fall2025/readings/1975-AIJ-Knuth-Moore-alphabeta.pdf), 1975. The basis for the pruning algorithm and the importance of move ordering.
- Aske Plaat, Jonathan Schaeffer, Wim Pijls, and Arie de Bruin, [A New Paradigm for Minimax Search](https://arxiv.org/abs/1404.1515) and [SSS* = Alpha-Beta + TT](https://arxiv.org/abs/1404.1517). Research on search, stored results, and iterative deepening. This engine does not implement MTD(f) or SSS*.
- Peter Burley, [*Kamisado rules*](https://www.boardspace.net/kamisado/english/RULES%20ENG.pdf), mirrored by Boardspace. The reference for forced moves, blocked turns, deadlock, and sumo play.
- [Node.js worker-thread documentation](https://nodejs.org/api/worker_threads.html). The runtime mechanism used to keep CPU-intensive search off the server event loop.
