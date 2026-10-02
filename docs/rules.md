# Game rules

[Back to the README](../README.md) · [Player guide](player-guide.md)

Kamisado is played on an 8×8 colored board. Each player has eight towers, one for each board color. Black moves first in the opening round.

## Movement

On the first move of a round, the player may choose any tower. After that, the color of the square just reached determines which tower the opponent must move.

A tower moves forward any unobstructed distance, either straight ahead or diagonally. It cannot move sideways or backward, jump over another tower, or enter an occupied square except as part of a legal sumo push.

Reaching the opponent's home row wins the round.

## Forced passes and deadlock

If the required tower cannot move, its owner passes. The color of the square under that blocked tower determines which tower the other player must move. This can cause a chain of passes.

If the chain repeats without either player being able to move, the position is a deadlock. The player who made the last actual move loses the round. The winner promotes the tower matching the color of the square where that last move ended.

## Sumo towers and scoring

A tower that wins a round is promoted, up to rank 3. Its rank before the win determines the points earned that round.

| Rank | Tower | Maximum move | Push capacity | Points for a win |
| ---: | --- | ---: | --- | ---: |
| 0 | Normal | Unlimited | None | 1 |
| 1 | Sumo | 5 squares | 1 lower-ranked tower | 2 |
| 2 | Double Sumo | 3 squares | 2 lower-ranked towers | 4 |
| 3 | Triple Sumo | 1 square | 3 lower-ranked towers | 8 |

A sumo tower can push adjacent opposing towers straight forward when an empty square exists at the end of the chain. It cannot push its own towers, an equal- or higher-ranked tower, a tower on its home row, or a chain off the board. Pushes cannot be diagonal.

After a push, the pushing player moves again. The color under the furthest pushed tower determines the required tower for this extra turn.

A match ends when a player reaches the selected target: 1, 3, 7, or 15 points. The loser of a round moves first in the next one.

## Starting positions

- **Standard:** towers return to the standard layout at the start of each round.
- **Fill:** after the opening round, the previous winner chooses the direction in which the towers are arranged for the next round.
- **Random:** each side receives a layout drawn from 37 predefined arrangements.

Promotions carry over between rounds. Both players confirm that they are ready before the next round begins; the computer handles its own confirmation and fill choice.

## Clocks

The clock is optional. When enabled, each player starts with the chosen time allowance for the match, and only the player whose turn it is uses time. Computer thinking time counts against its clock. Running out of time loses the match.

The interface shows the required tower, legal destinations, scores, promotions, and any countdown between rounds. For controls and connection settings, see the [player guide](player-guide.md).
