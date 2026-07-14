# Kamisado

A real-time, browser-based implementation of [Kamisado](https://en.wikipedia.org/wiki/Kamisado), built with TypeScript, Express, and Socket.IO. Create a match, share its invitation link, and play without accounts or a client installation.

## Highlights

- Server-authoritative movement, scoring, deadlock, and sumo-push rules
- Real-time two-player matches with shareable links
- Spectator mode for additional visitors
- Session takeover protection and a 60-second reconnection window
- Chess-style match clocks with 1, 3, 5, 10, and 30-minute presets
- Standard, fill, and 37-layout random position modes
- Responsive board and controls for desktop and mobile browsers
- Dependency-free desktop host for direct/LAN and ngrok rooms
- Automated rule, timer, multiplayer, reconnection, and adversarial socket tests

## Quick start

Prerequisites: Node.js 20 or newer and npm.

```bash
git clone https://github.com/acilione/kamisado.git
cd kamisado
npm ci
npm run build
npm start
```

Open `http://localhost:3000`. Create a game, then open its invitation link in a second browser or private window.

For server-side development with automatic reload:

```bash
npm run dev
```

The browser client is a generated bundle. Run `npm run build` after changing `src/client/client.ts`.

## Desktop application

The Electron host packages the existing TypeScript server and browser client without rewriting the game engine. End users do not need Node.js, npm, ngrok, or any other runtime.

Start it during development:

```bash
npm run desktop:dev
```

Create a distributable for the current operating system:

```bash
npm run desktop:make
```

Artifacts are written to `out/make`. Windows builds include an installer and a portable ZIP; Linux builds produce DEB/RPM packages; macOS builds produce a ZIP application bundle. Production releases should be code-signed on each target platform.

The host window offers two interchangeable connectivity providers:

- **ngrok:** enter an authtoken for the current session. The integrated SDK creates an HTTPS endpoint, so the guest only needs the invitation link and a browser. The token is kept in memory and is not saved.
- **Direct P2P:** the guest connects straight to the host's Socket.IO server. LAN addresses are detected automatically. Internet use requires TCP port forwarding; enter the public host and port in the optional public-address field. CGNAT or restrictive routers may prevent this mode from working, in which case use ngrok.

In both modes, the host remains authoritative and all moves are validated by the same `KamisadoGame` implementation. “Direct P2P” describes the network path—there is no relay or cloud server—not a decentralized game-state model.

## Playing over the internet

The included helper uses the same embedded [ngrok JavaScript SDK](https://ngrok.com/docs/getting-started/javascript) as the desktop application:

```bash
npm run build
NGROK_AUTHTOKEN=<token> npm run ngrok
```

In PowerShell:

```powershell
$env:NGROK_AUTHTOKEN = '<token>'
npm run ngrok
```

No separate ngrok executable is required. Send the displayed HTTPS URL to the other player. Direct `/game/<id>` links are handled by the same web client.

## Rules implemented

Kamisado is played on an 8x8 colored board. Each player has eight towers, one for each board color. Black moves first.

- A tower moves any unobstructed distance forward, either straight or diagonally.
- Towers cannot move sideways or backward and cannot jump over another tower.
- The color of the destination square determines which tower the opponent must move.
- If that tower cannot move, the turn passes back using the blocked tower's square color.
- If the newly required tower is also blocked, the last mover wins the round.
- Reaching the opponent's home row wins the round.

### Sumo ranks and scoring

A tower that wins a round is promoted, up to rank 3. Its score for a later win is `2^rank`.

| Rank | Tower | Maximum move | Push capacity | Points |
| ---: | --- | ---: | ---: | ---: |
| 0 | Normal | Unlimited | None | 1 |
| 1 | Sumo | 5 squares | 1 lower-ranked tower | 2 |
| 2 | Double Sumo | 3 squares | 2 lower-ranked towers | 4 |
| 3 | Triple Sumo | 1 square | 3 lower-ranked towers | 8 |

Pushes are straight forward, begin against an adjacent opposing tower, and cannot push an equal/higher-ranked tower, a tower on its home row, or a chain off the board. A successful push grants another turn; the furthest pushed tower's landing-square color becomes the next required color.

The available match targets are 1, 3, 7, and 15 points.

### Position modes

- **Standard:** each round resets to the standard layout.
- **Fill:** after round one, the previous winner chooses the fill direction for the next layout.
- **Random:** each side receives a different layout drawn from 37 predefined arrangements.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run build` | Type-check the application and bundle the browser client |
| `npm start` | Run the compiled server on `PORT` (default `3000`) |
| `npm run dev` | Run the TypeScript server in watch mode |
| `npm run typecheck` | Type-check application and test sources |
| `npm run test:unit` | Run the game-rule and timer suites |
| `npm run test:integration` | Build, start an isolated server, and run all Socket.IO suites |
| `npm test` | Run type checks, unit tests, and integration tests |
| `npm run ngrok` | Start the compiled server and embedded ngrok provider |
| `npm run desktop:dev` | Build and launch the Electron host |
| `npm run desktop:package` | Create an unpacked desktop application |
| `npm run desktop:make` | Create platform-specific distributables |

`TEST_PORT` can override the integration runner's temporary port. Tests can also target an already running instance by executing an individual integration file with `TEST_SERVER_URL` set.

## Architecture

```text
src/
  shared/
    constants.ts       Board colors and position layouts
    types.ts           Game state and typed Socket.IO event contracts
  server/
    game.ts            Rules engine and match state
    index.ts           HTTP server, sessions, timers, and socket authorization
  desktop/
    main.ts            Electron lifecycle, windows, and host orchestration
    preload.ts         Narrow IPC bridge for the isolated host UI
    connectivity/      Direct and ngrok providers behind one interface
  client/
    client.ts          Rendering, input, clocks, and reconnect UI
desktop/
  index.html            Connectivity-provider host window
  renderer.js           Unprivileged host-window interaction
  style.css             Desktop host presentation
public/
  index.html            Browser shell and rules tutorial
  style.css             Responsive presentation
tests/
  unit/                 Rule, scoring, sumo, round, and timer coverage
  integration/          Live multiplayer and WebSocket lifecycle coverage
scripts/
  run-integration-tests.js
  start-ngrok.js
```

The server owns the canonical board and validates every action. Clients receive serialized game-state updates and never decide whether a move is legal. Socket actions are accepted only from the currently bound player connection; spectators and replaced browser tabs cannot mutate a match. The desktop connectivity manager starts exactly one provider at a time and closes the previous tunnel before switching, while the underlying room and Socket.IO protocol remain unchanged.

## Deployment notes

This project currently stores games and session mappings in process memory. That keeps local setup simple, but it has important production implications:

- restarting the process ends all active games;
- multiple server replicas need shared state and Socket.IO coordination;
- invitation/player IDs are bearer-style tokens, not authenticated accounts;
- reverse proxies must allow WebSocket upgrades and should keep clients on a compatible Socket.IO deployment.

For a public production service, add durable/shared storage, authenticated identities, rate limiting, origin policy, structured logging, and a multi-node Socket.IO adapter before scaling beyond one trusted instance.

## Testing

The test suite covers the rules engine as well as real Socket.IO clients. Integration coverage includes game creation and joining, move broadcasts, direct links, cancellation, session restoration, dual-tab takeover, reconnect countdowns, timer persistence, spectators, malformed messages, stale sockets, and lobby disconnect races.

```bash
npm test
```

GitHub Actions runs the same command on Node.js 20 and 22.

## License

[MIT](LICENSE)
