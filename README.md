# Kamisado

[![CI](https://github.com/acilione/kamisado/actions/workflows/ci.yml/badge.svg)](https://github.com/acilione/kamisado/actions/workflows/ci.yml)
[![Node.js 20+](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A real-time implementation of [Kamisado](https://en.wikipedia.org/wiki/Kamisado), built with TypeScript, Express, Socket.IO, and Electron. Play in a browser or use the self-contained desktop host to create a room, share its invitation link, and play without player accounts (online hosting optionally uses your ngrok account).

## Highlights

- Server-authoritative movement, scoring, deadlock, and sumo-push rules
- Real-time two-player matches with shareable links
- Spectator mode for additional visitors
- Session takeover protection and a 60-second reconnection window
- Chess-style match clocks with 1, 3, 5, 10, and 30-minute presets
- Standard, fill, and 37-layout random position modes
- Responsive board and controls for desktop and mobile browsers
- Realistic 2D and interactive 3D views with octagonal towers, inspired by the physical game
- Color-blind friendly symbol mode with matching shapes on squares, towers, and turn instructions
- Self-contained desktop host for direct/LAN and ngrok rooms
- Automated rule, timer, multiplayer, reconnection, and adversarial socket tests

## Download and play

Get a published build from **[Releases](https://github.com/acilione/kamisado/releases)**. Only the host needs the application; the other player joins in a browser on a phone, tablet, or computer. No Node.js, npm, or separate ngrok installation is needed.

| Computer | Download | Open it |
| --- | --- | --- |
| Windows x64 | `Setup.exe` or the Windows ZIP | Run the installer, or extract the ZIP completely and launch `Kamisado.exe` |
| Debian / Ubuntu x64 | `.deb` | Open it with your software installer, then launch Kamisado |
| Fedora-compatible Linux x64 | `.rpm` | Open it with your package manager, then launch Kamisado |

1. Open Kamisado and choose **Same Wi-Fi network**. Allow access on your private network if the firewall asks.
2. Choose your rules and press **Create Game** in the same window.
3. Share the invitation link or let the other player scan its QR code. They open it in their browser and the match begins.

LAN play works without an account or Internet connection. Both devices must be able to reach each other; guest Wi-Fi and some office networks isolate devices. Keep the host application open throughout the match. **Stop hosting** closes the server and ends its games; restarting creates a fresh session. Closing the app also loses active games. Playing both sides on one computer currently requires a second browser or a private window; there is no dedicated pass-and-play mode.

For someone on another network, choose **Play over the Internet** and enter your own [ngrok authtoken](https://dashboard.ngrok.com/get-started/your-authtoken) on first use. The guest needs only the invitation, not an account. An Internet connection is required, and ngrok may show a browser warning page before the game. Remembering the token is optional: supported OS storage encrypts saved credentials; otherwise the token is retained only until you quit. **Forget** clears both saved and session credentials.

Current automated downloads are **unsigned**. Windows may show an unknown-publisher warning; use builds from a source you trust. Each build includes a `SHA256SUMS-<platform>-<architecture>.txt` integrity file. The Windows ZIP avoids installation but still saves preferences in your OS user profile. macOS releases are not automated yet; the existing macOS maker needs testing, signing, and notarization before distribution.

If no release has been published yet, maintainers can run **[Desktop downloads](https://github.com/acilione/kamisado/actions/workflows/release.yml)** manually. Completed runs provide downloadable artifacts (GitHub sign-in required), without creating a public release.

## Run from source

Prerequisites: Node.js 20 or newer and npm.

```bash
git clone https://github.com/acilione/kamisado.git
cd kamisado
npm ci
npm run build
npm start
```

Open `http://localhost:3000`. Create a game, then open its invitation link in a second browser or private window. If port 3000 is already in use, set another port, for example `PORT=3001 npm start` on Linux/macOS, or `$env:PORT = '3001'; npm start` in PowerShell. The desktop application chooses another port automatically when its preferred port is occupied.

For server-side development with automatic reload:

```bash
npm run dev
```

The browser client is a generated bundle. Run `npm run build` after changing client code.

## Build the desktop application

The Electron host packages the TypeScript server and browser client. Start it during development with `npm run desktop:dev`, or build distributables for the current operating system:

```bash
npm ci
npm run desktop:make
```

Artifacts are written to `out/make`. Windows builds include a Squirrel installer and portable ZIP; Linux builds produce DEB/RPM packages; the macOS maker produces a ZIP application bundle. Build on the target operating system. Linux makers require `fakeroot` and `rpm` (on Debian/Ubuntu: `sudo apt-get install fakeroot rpm`). The Linux launchers explicitly target the case-sensitive `Kamisado` executable.

The host combines connection setup and the game in one window. **Connection** exposes the detected LAN addresses, optional public address for direct port-forwarded connections, and Stop hosting. Direct Internet connections require reachable TCP port forwarding and may not work behind CGNAT; ngrok provides the alternative. The host remains authoritative in both modes. No server listens until you choose a hosting mode.

### Test a packaged build

```bash
npm run desktop:package
npx playwright install chromium
npm run test:desktop
```

On a headless Linux machine, use `xvfb-run --auto-servernum npm run test:desktop`. The smoke test launches the actual packaged executable with a temporary profile, forces a port conflict, creates a room in the single host window, opens its LAN invitation in a separate Chromium browser, makes a move, and checks Stop and restart. It does not contact ngrok. `KAMISADO_PACKAGED_EXECUTABLE` selects a different packaged binary; `PLAYWRIGHT_CHROMIUM_EXECUTABLE` selects an existing Chromium installation. `KAMISADO_USER_DATA_DIR` isolates the app's settings during testing.

### Prepare a release

The **Desktop downloads** workflow builds Windows x64 and Linux x64, runs the application and browser tests plus packaged smoke test, and uploads downloads with SHA-256 checksums. A manual run creates Actions artifacts only. A version-tag push creates a **draft** GitHub release after both builds pass; publishing remains a deliberate maintainer step.

1. Update the version in `package.json` and `package-lock.json` together (`npm version patch --no-git-tag-version` is one option), review the changes, and commit.
2. Tag that commit `v<package.json version>`, then push the commit and tag when ready. The workflow rejects a tag/version mismatch.
3. Review the draft downloads and follow its clean-machine and second-device checks. Add release-specific notes, then publish the draft from GitHub.

The workflow uses the repository's `GITHUB_TOKEN` and needs no third-party publishing secret. It refuses to replace an already published release. CI also smoke-tests the unpacked Windows app on normal changes. Download checksums detect corruption, not publisher identity; add Windows signing credentials and macOS signing/notarization before describing builds as signed. See [Electron's signing documentation](https://www.electronjs.org/docs/latest/tutorial/code-signing) for platform requirements.

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

## Board views

Choose **Simple**, **Realistic 2D**, or **Realistic 3D** among the menu options or below the board. The realistic views use a framed board, the physical game's palette, and black/ivory octagonal towers with colored characters. The 3D view adds modeled tower tiers and crenellations, lighting, shadows, and an adjustable camera. Click a tower and a destination to move; drag to rotate, scroll or pinch to zoom, and use **Reset view** to return to your side.

The **Symbols** switch works in all three views. Simple view uses neutral squares and geometric shapes. Realistic 2D and 3D follow `ref_imgs/kamisado_colorblind board.png`: they retain the colored squares and print pale characters in opposite corners, matching the colored character on each tower. Display preferences are saved locally and do not affect the opponent or the rules. If WebGL is unavailable, the game falls back to realistic 2D. All rendering assets are bundled locally; the photos in `ref_imgs/` are design references, not runtime dependencies.

## Rules implemented

Enable **Symbol mode** among the menu options, or use the compact **Symbols** switch below the board. Match the square's marking to the marking inside a tower: geometric shapes in Simple view, or the physical board's printed characters in realistic views. The required-move indicator and **Symbol key** use the same markings as the current view, while sumo ranks remain separate numbers. The setting is saved in your browser and applies only to your view, including when spectating.

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
| `npm run test:browser` | Build and verify board views, invitations, clipboard fallback, and 3D fallback in Chromium |
| `npm run ngrok` | Start the compiled server and embedded ngrok provider |
| `npm run desktop:dev` | Build and launch the Electron host |
| `npm run desktop:package` | Create an unpacked desktop application |
| `npm run desktop:make` | Create platform-specific distributables |
| `npm run test:desktop` | Launch a packaged host and verify guest play, Stop, and restart |

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
  index.html            Single-window connection setup and embedded game
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

Browser rendering checks use Playwright. Install its browser once with `npx playwright install chromium`, then run `npm run test:browser`. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use an existing Chromium installation. Screenshots are saved in `out/browser-checks/`.

The realistic tower character outlines are derived from Noto Sans CJK, licensed under the SIL Open Font License; the notice is included in `public/licenses/NotoSansCJK-OFL.txt`.

## License

[MIT](LICENSE)
