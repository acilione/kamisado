# Kamisado

A full-featured multiplayer [Kamisado](https://en.wikipedia.org/wiki/Kamisado) board game built with TypeScript, Node.js, Express, and Socket.IO. Play in real time with a friend through shareable game links -- no accounts required.

## Quick Start

```bash
# Install dependencies
npm install

# Build and run
npm run build
npm start
```

The server starts at `http://localhost:3000`. Open it in two browser tabs to play locally.

### Play with someone on another computer

To share the game over the internet, use [ngrok](https://ngrok.com/download):

```bash
# One command -- starts the server and opens an ngrok tunnel
npm run ngrok
```

ngrok will display a public URL (e.g. `https://abc123.ngrok-free.app`). Send that link to your friend -- they open it in their browser and join your game.

If you prefer to run them separately:

```bash
# Terminal 1: start the server
npm start

# Terminal 2: expose it with ngrok
ngrok http 3000
```

> **Note:** ngrok must be [installed](https://ngrok.com/download) and authenticated (`ngrok config add-authtoken <token>`) before use. The free tier works fine for playing.

### Development

For development with auto-reload:

```bash
npm run dev
```

## How to Play

Kamisado is an abstract strategy game played on an 8x8 color-coded board. Each player controls 8 towers of different colors.

**Goal:** Move one of your towers to the opponent's home row.

**Movement:**
- Towers move **forward only** -- straight or diagonally
- Towers cannot jump over other pieces
- After each move, the opponent **must** move the tower matching the color of the square you landed on
- If that tower is blocked, the turn passes back. If both players are blocked (deadlock), the last player who moved wins the round

**Sumo Ranks:**

Towers that win a round are promoted (up to rank 3). Higher ranks gain pushing power but lose movement range:

| Rank | Title | Max Range | Push Capacity |
|------|-------|-----------|---------------|
| 0 | Normal | Unlimited | None |
| 1 | Sumo | 5 squares | 1 piece |
| 2 | Double Sumo | 3 squares | 2 pieces |
| 3 | Triple Sumo | 1 square | 3 pieces |

Pushes are straight forward only, against adjacent opponent pieces of lower rank. After a push, you get another turn.

**Scoring:** The winning tower scores `2^rank` points (1, 2, 4, or 8). First to the target score wins the match.

## Features

- **Real-time multiplayer** via Socket.IO with shareable game links
- **Sumo push mechanics** with rank-based movement limits and chain pushes
- **Multiple match lengths:** Single Round (1 pt), Standard (3 pts), Long (7 pts), Marathon (15 pts)
- **Chess-style timers:** 1, 3, 5, 10, or 30 minute time controls
- **Three position modes:**
  - *Standard* -- default starting positions each round
  - *Fill* -- round winner rearranges pieces by choosing left/right fill direction
  - *Random* -- randomly drawn layout from 37 predefined setups each round
- **Reconnection support** -- refresh the page or lose connection and rejoin seamlessly within 60 seconds
- **Spectator mode** -- third players can watch live games
- **Session takeover detection** -- opening the game in a second tab transfers the session
- **Mobile responsive** -- works on phones and tablets
- **Deadlock detection** with automatic turn passing and resolution

## Project Structure

```
src/
  shared/
    types.ts          # Shared type definitions (Piece, Board, GameState, Socket.IO events)
    constants.ts      # Board color matrix, piece layouts (37 position presets)
  server/
    game.ts           # KamisadoGame class -- all game logic, move validation, sumo mechanics
    index.ts          # Express + Socket.IO server, session management, reconnection
  client/
    client.ts         # Browser client -- UI rendering, board interaction, timer display
    globals.d.ts      # Type declarations for Socket.IO CDN global
public/
  index.html          # Game page
  style.css           # Styling with mobile responsive design
tests/
  unit/               # 113 unit tests (game logic, sumo rules, scoring, timer)
  integration/        # 47 integration tests (multiplayer flows, reconnection, spectator)
```

## Configuration

The server port defaults to `3000` and can be changed via the `PORT` environment variable:

```bash
PORT=8080 npm start
```

## Tests

**Unit tests** test game logic directly and require no running server:

```bash
npm run test:unit
```

**Integration tests** test multiplayer scenarios via Socket.IO and require the server to be running:

```bash
# In one terminal:
npm start

# In another terminal:
npm run test:integration
```

## Tech Stack

- **Runtime:** Node.js
- **Language:** TypeScript (strict mode)
- **Server:** Express + Socket.IO
- **Client:** Vanilla TypeScript bundled with esbuild
- **Tests:** Custom lightweight test framework (no external test dependencies)

## License

[MIT](LICENSE)
