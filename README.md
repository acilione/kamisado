# Kamisado

[![CI](https://github.com/acilione/kamisado/actions/workflows/ci.yml/badge.svg)](https://github.com/acilione/kamisado/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Play Kamisado against a friend or an offline computer opponent. The color you land on decides which tower your opponent must move next.

The game has realistic 2D and 3D boards, a symbol mode for players who have difficulty distinguishing colors, and ten computer difficulty levels. Matches support sumo promotions, optional clocks, and standard, fill, or random starting positions.

## Download and play

Open [Releases](https://github.com/acilione/kamisado/releases) and choose an application download from **Assets**. The desktop app includes its runtime; you do not need Node.js or development tools.

| Your computer | Download |
| --- | --- |
| Windows, Intel or AMD 64-bit | `Kamisado-<version> Setup.exe`, or the `win32-x64` ZIP |
| Debian or Ubuntu, 64-bit | The `.deb` package |
| Fedora-compatible Linux, 64-bit | The `.rpm` package, when included in the release |
| Other Linux, Intel or AMD 64-bit | The `linux-x64` ZIP; system libraries may be required |
| Mac | macOS packaging is configured, but automatic Mac releases and testing are not set up yet. See the [Mac instructions](docs/player-guide.md#mac). |

The [player guide](docs/player-guide.md) explains installation on each platform, how to start a game, and connection troubleshooting. If a release has no application assets yet, GitHub's **Source code** archives are not a replacement for the desktop download.

## Mobile

Android and iOS apps use the same game code through Capacitor. They support offline computer play and direct P2P with mobile or desktop opponents. Android test builds use an APK; iPhone installation requires a signed Xcode build until a TestFlight or App Store release is available. See the [mobile guide](docs/mobile.md) for installation, building, and current limitations.

## Ways to play

| Mode | What you need |
| --- | --- |
| Computer | One desktop app. Works offline, with difficulty levels 1–10. |
| LAN | Devices on the same Wi-Fi or Ethernet network. The host runs the app; the other player opens an invitation in a browser. |
| Internet P2P | Both players run the app and exchange an invitation code and a reply code. |

Internet P2P runs the game on the host's computer and sends moves directly between the players. It uses a public STUN service to discover connection addresses. Some networks block direct connections; this mode has no relay fallback. The optional ngrok relay is available separately.

Keep the host app open during a match. Games are held in memory and are lost when the host closes the app or ends the session.

## Documentation

- [Player guide](docs/player-guide.md): downloads, installation, game modes, and troubleshooting.
- [Game rules](docs/rules.md): movement, forced passes, scoring, and sumo towers.
- [Mobile guide](docs/mobile.md): Android and iPhone installation, native builds, and shared code.
- [Development](docs/development.md): prerequisites, running from source, compiling, packaging, tests, and releases.
- [Code structure](docs/architecture.md): module responsibilities, game state, networking, and the desktop app.
- [Computer opponent](docs/ai-research.md): search algorithm, difficulty settings, and research references.

## License

The project uses the [MIT license](LICENSE). Tower character outlines are derived from Noto Sans CJK; its [SIL Open Font License](public/licenses/NotoSansCJK-OFL.txt) is included with the game.
