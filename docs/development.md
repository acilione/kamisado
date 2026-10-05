# Development

For installation and play instructions, see the [README](../README.md) and [player guide](player-guide.md). This guide covers building, testing, and packaging from source.

Install Git and Node.js **22.12 or newer**, including npm. Node.js 24 is recommended; CI runs the main test suite on Node.js 22 and 24.

## Get the source

```sh
git clone https://github.com/acilione/kamisado.git
cd kamisado
npm ci
```

Run the commands below from this directory. `npm ci` installs the versions recorded in `package-lock.json`. An Internet connection is needed to download the dependencies and Electron runtime.

## Run the web application

```sh
npm run build
npm start
```

Open `http://localhost:3000`. To test both seats on one computer, use a second browser or a private window: tabs in the same browser profile share a player identity.

`npm run build` runs TypeScript and bundles the browser entry point with esbuild. It writes compiled modules and declarations to `dist/`, and the browser bundle to `public/client.js`. Both outputs are ignored by Git. Edit files under `src/`, then rebuild; do not edit the generated JavaScript.

For automatic server reloads:

```sh
npm run build
npm run dev
```

`dev` watches the TypeScript server with `tsx`. It does not rebuild the browser bundle. After changing browser TypeScript, run `node build-client.js` in another terminal and refresh the page. Changes to `public/index.html` or CSS need only a refresh. A server restart loses all in-memory games.

To choose a different server port, use the syntax for your shell:

```sh
# Linux or macOS
PORT=3001 npm start
```

```powershell
# Windows PowerShell
$env:PORT = '3001'
npm start
```

## Run and package the desktop application

Run these commands on the operating system you are building for. Use Windows Node.js for Windows builds, Linux Node.js for Linux builds, and macOS Node.js for macOS builds. WSL produces Linux builds. Keep separate dependency installations when working across operating systems; Electron and ngrok include platform-specific binaries.

After `npm ci`, the desktop commands are:

| Command | Result |
| --- | --- |
| `npm run desktop:dev` | Builds the code and launches Electron through Forge. |
| `npm run desktop:package` | Builds an unpacked application under `out/Kamisado-<platform>-<arch>/`. |
| `npm run desktop:make` | Packages the application and creates a portable ZIP under `out/make/zip/`. |
| `npm run release:desktop` | Collects the portable build, ZIP, guide, and checksums into `out/release/<platform>-desktop/`. |
| `npm run release:android` | Collects the debug APK and instructions into `out/release/Android/`. |

Each command rebuilds before running Forge. `desktop:dev` has no source watcher; restart it after changing TypeScript. Packaging uses [`forge.config.js`](../forge.config.js), stores application files in `app.asar`, unpacks native `.node` modules, and copies `desktop/START-HERE.txt` into the package directory.

Forge defaults to the current Node.js architecture. Pass `--arch=x64` or `--arch=arm64` explicitly when needed. The automated release targets are **Windows x64 and Linux x64**. Other architectures need a compatible native dependency installation and testing on the target machine; selecting an architecture does not establish support for it.

### Windows

Run in PowerShell from a Windows checkout:

```powershell
npm ci
npm run desktop:make -- --arch=x64
```

The configured maker produces a portable ZIP. Run `npm run release:desktop` to collect it with the unpacked app into `out/release/Windows-desktop/`. The original unpacked executable is `out/Kamisado-win32-x64/Kamisado.exe`.

### Linux

The make command produces a portable ZIP and needs `zip`. On Debian or Ubuntu:

```sh
sudo apt-get install -y zip
npm ci
npm run desktop:make -- --arch=x64
npm run release:desktop
```

Open `out/release/Linux-desktop/Kamisado/Kamisado`. The app runs without installing a package; Electron still needs a graphical session and its system libraries. For headless packaged tests, install `xvfb` as described below. The original unpacked build remains in `out/Kamisado-linux-x64/`.

### macOS

The Forge configuration includes a macOS ZIP maker. Run on macOS, choosing the architecture of the target Mac:

```sh
npm ci
npm run desktop:make -- --arch=arm64
```

Use `--arch=x64` for Intel Macs. The package contains `Kamisado.app` under `out/Kamisado-darwin-<arch>/`. macOS packaging is not covered by the current CI or release workflow. Signing and notarization are not configured; treat these commands as a starting point for local testing, not a validated distribution process.

If npm needs to compile a native dependency, install Apple's Command Line Tools with `xcode-select --install`. Distribution builds need signing and notarization configured in Forge; see [Forge's macOS signing guide](https://www.electronforge.io/guides/code-signing/code-signing-macos).

## Mobile applications

Android and iOS use Capacitor with the existing game UI, match controller, and AI. Run `npm run mobile:sync` to bundle the mobile app and copy it into both native projects. `npm run mobile:android` and `npm run mobile:ios` open the platform IDE. See [Mobile](mobile.md) for SDK requirements, APK and iOS builds, installation, and the source layout.

## Tests

```sh
npm test
```

This runs type checking, unit tests, then integration tests. Integration tests build the application, start a temporary server, run real Socket.IO clients against it, and stop it afterward. No separately running server is required.

| Command | Coverage |
| --- | --- |
| `npm run typecheck` | Application and TypeScript test sources, without emitting files. |
| `npm run test:unit` | Rules, sumo, clocks, AI search/workers, invitations, connectivity, credentials, server shutdown, and desktop artifact collection. |
| `npm run test:integration` | Games, spectators, links, reconnection, lobby refresh, socket resilience, and computer matches. |
| `npm run test:browser` | Board views, invitations, computer games, the launcher UI, manual WebRTC, and quick join against a local PeerServer in Chromium. |
| `npm run test:mobile` | Offline phone play, touch layouts, and P2P interoperability with desktop using the mobile bundle. |
| `npm run test:p2p-relay` | Quick and manual connections through a real TURN service, invalid credentials, invitation privacy, and desktop/mobile moves. Requires the test relay variables below. |
| `npm run test:desktop` | Launches an existing packaged application and checks real desktop, browser guest, P2P, and offline play flows. |

Browser and packaged tests are separate from `npm test`. Install Chromium before running them:

```sh
npx playwright install chromium
npm run test:browser
npm run desktop:package
npm run test:desktop
```

On Linux, Playwright can install its browser system dependencies, and Xvfb supplies a display for the packaged application:

```sh
npx playwright install --with-deps chromium
sudo apt-get install -y xvfb
npm run test:browser
npm run desktop:package
xvfb-run --auto-servernum npm run test:desktop
```

The packaged test uses a temporary Electron profile and normally locates the executable for the current OS and Node.js architecture. Browser screenshots are written under `out/`. The ordinary WebRTC tests use local ICE candidates. The separate relay test needs `KAMISADO_TEST_TURN_URL`, `KAMISADO_TEST_TURN_USER`, and `KAMISADO_TEST_TURN_PASSWORD` set in the shell to an authenticated test TURN service. It deliberately attempts an invalid password before using the supplied credentials; use a test account. Quick-connect tests import ICE JSON, discard direct ICE candidates to exercise automatic fallback with the original invitation, then verify actual relay candidates and desktop/mobile moves in both hosting directions. Set `KAMISADO_TEST_TURN_DIRECT=host` or `guest` when running `node tests/browser/test_quick_join.cjs` with the TURN variables to exercise immediate relay selection instead. These variants assert that no direct RTC connection is created. Authentication failures must never trigger a fallback retry. Neither suite tests every Internet router or carrier.

For a local-only relay test on Linux with Docker, start this temporary service. The loopback exception is for this test only; do not use this configuration for a public deployment:

```sh
docker run --rm -d --name kamisado-turn-test --network host coturn/coturn:4.6.3 \
  -n --listening-ip=127.0.0.1 --relay-ip=127.0.0.1 --listening-port=34790 \
  --min-port=49190 --max-port=49210 --realm=kamisado-test \
  --user=kamisado-test:local-test-only --lt-cred-mech --no-tls --no-dtls \
  --no-cli --allow-loopback-peers --no-multicast-peers --log-file=stdout
KAMISADO_TEST_TURN_URL='turn:127.0.0.1:34790?transport=tcp' \
KAMISADO_TEST_TURN_USER=kamisado-test KAMISADO_TEST_TURN_PASSWORD=local-test-only \
  npm run test:p2p-relay
docker stop kamisado-turn-test
```

Stop the test container even if a test fails. For testing a provider's secure endpoint, use its `turns:` URL and temporary credentials in the same environment variables; keep them out of Git and CI logs.

## Environment variables

Set variables in the shell before starting the relevant command. The application does not automatically load `.env` files.

| Variable | Used by | Purpose |
| --- | --- | --- |
| `PORT` | `npm start`, `npm run dev`, `npm run ngrok` | Server port; defaults to `3000`. `0` requests an available port. |
| `KAMISADO_DESKTOP_PORT` | Desktop application | Preferred port; defaults to `32145`. If occupied, the app requests an available port. |
| `KAMISADO_USER_DATA_DIR` | Desktop application | Override the Electron profile directory, useful for isolated manual tests. |
| `NGROK_AUTHTOKEN` | ngrok provider | Token fallback when no token is supplied through the desktop UI. |
| `TEST_PORT` | Integration test runner | Override its automatically chosen server port. |
| `TEST_SERVER_URL` | Individual integration test files | Server URL when running a test directly; the suite runner supplies its own URL. |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE` | Browser and packaged tests | Use a specific Chromium executable instead of Playwright's installed browser. |
| `KAMISADO_PACKAGED_EXECUTABLE` | `test:desktop` | Override the packaged application executable to launch. |

To test the optional ngrok relay from source, build first, set `NGROK_AUTHTOKEN`, then run `npm run ngrok`. The script starts its own loopback server and prints the public URL. Do not run `npm start` on the same port alongside it. WebRTC play uses Quick connect or manual code exchange and does not use this script or a token.

## CI and releases

[`ci.yml`](../.github/workflows/ci.yml) runs `npm test` on Node.js 22 and 24, browser tests on Node.js 24, and a Windows package-and-launch test. [`release.yml`](../.github/workflows/release.yml), named **Desktop downloads**, validates the code, makes Windows x64 and Linux x64 downloads, and launches each packaged build before collecting artifacts.

For a candidate build, run **Desktop downloads** manually in GitHub Actions. It uploads workflow artifacts retained for 14 days and does not create a release. For a versioned release:

1. Set the intended version in `package.json` and `package-lock.json`, and review [the release notes](../.github/release-notes.md).
2. Commit the release changes and push a matching `v<version>` tag. The workflow rejects tags that do not match `package.json`.
3. Review the generated draft GitHub release and its downloads before publishing it.

The tag workflow creates or updates a draft; it refuses to replace an already published release. Signing is not configured for the current downloads.

Before publishing, extract and run the downloads on machines without development tools and check the packaged `START-HERE.txt`. Play a LAN round from a second device and a P2P round across two separate Internet connections. Check both board views, symbol mode, computer play, and session shutdown. Local automated tests do not cover those operating-system and network combinations. Test ngrok with a real account if offering the relay, and record any platform limitations in the release notes.

For local artifact collection after `npm run desktop:make`:

```sh
npm run release:desktop
```

The collector creates `out/release/Windows-desktop/`, `Linux-desktop/`, or `macOS-desktop/` for the current platform. Each contains a ready-to-run `Kamisado/` directory, a clearly named `Kamisado-<version>-<OS>-<arch>-portable.zip`, a start guide, and checksums. Send the ZIP, not just the executable. CI uploads only the ZIP, guide, and checksums to avoid duplicating the unpacked runtime.

The destination platform folder must be empty. Move the previous build elsewhere before collecting a replacement; other platforms can stay in `out/release/`. Build and collect on the same OS with the same source revision. The collector selects the ZIP matching `package.json` and refuses missing runtime files. Do not collect an older ZIP after rebuilding only the unpacked application.

For a non-default architecture or output directory, pass all three arguments:

```sh
node scripts/collect-desktop-artifacts.cjs out/make/zip/darwin/x64 out/release/macOS-desktop x64
```

For Android, build the debug APK first, then run `npm run release:android`. It copies the APK into `out/release/Android/` with installation instructions and checksums. A custom APK source and destination can be passed to `node scripts/collect-android-artifacts.cjs <debug-apk> <destination>`. This command labels the APK as a test build; production signing remains a separate step.

See [Architecture](architecture.md) for the source layout and runtime boundaries, and [AI research](ai-research.md) for the search design and its limits.
