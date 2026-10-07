# Kamisado

[![CI](https://github.com/acilione/kamisado/actions/workflows/ci.yml/badge.svg)](https://github.com/acilione/kamisado/actions/workflows/ci.yml)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Play Kamisado against a friend or an offline computer opponent. The color you land on decides which tower your opponent must move next.

The game has realistic 2D and 3D boards, a symbol mode for players who have difficulty distinguishing colors, and ten computer difficulty levels. Matches support sumo promotions, optional clocks, and standard, fill, or random starting positions.

## Get the game

There are no published releases or public installer downloads yet. To run the game now, follow [Build and run from source](#build-and-run-from-source) below, or ask the maintainer for a test build.

If you receive a packaged desktop build, it includes its runtime and does not require Node.js or development tools. The [player guide](docs/player-guide.md) explains how to open it and start a game. GitHub's **Source code** archives contain the project files and must be built before playing.

Local builds are collected in `out/release/`:

| Folder | Open to play | File to share |
| --- | --- | --- |
| `Windows-desktop` | `Kamisado/Kamisado.exe` | The `Windows-x64-portable.zip` archive |
| `Linux-desktop` | `Kamisado/Kamisado` | The `Linux-x64-portable.zip` archive |
| `Android` | Install the `.apk` on your phone | The `.apk` file |

Desktop builds run without installation. Extract the whole ZIP and keep its files together. On Windows, extract to a local Windows folder such as Downloads and open `Kamisado.exe` in Explorer. The Windows executable cannot run directly from the repository's `\\wsl.localhost\...` location: copy the entire `Kamisado` folder to Windows first. Each platform folder includes a start guide and SHA-256 checksums. These generated files are not committed to Git.

## Mobile

Android and iOS apps use the same game code through Capacitor. They share offline computer play. Android can host tunnl.gg and Cloudflare browser invitations; iOS retains legacy P2P hosting and can join tunnel invitations in Safari. Android test builds use an APK; iPhone installation requires a signed Xcode build until a TestFlight or App Store release is available. See the [mobile guide](docs/mobile.md) for installation, building, and current limitations.

## Ways to play

| Mode | What you need |
| --- | --- |
| Computer | One desktop or mobile app. Works offline, with difficulty levels 1–10. |
| Internet — tunnl.gg (default) | A desktop or Android 10+ host. Choose settings, press **Create game**, then share the HTTPS invitation. Your friend opens it in a browser. No account or credentials. |
| Internet — Cloudflare | Select **Cloudflare Quick Tunnel** under **Internet connection** before creating the game. Available on desktop and Android 10+, without an account. |
| Internet — ngrok | A desktop host with an ngrok account and authtoken. Guests only need the invitation link. |
| LAN | A desktop host and devices on the same Wi-Fi or Ethernet network. Guests open the invitation in a browser. |
| Legacy P2P | Existing app invitations still work, with STUN/TURN setup where needed. |

**tunnl.gg is the default for new Internet games.** The game runs on the host's device, with a bundled connector forwarding the connection through tunnl.gg. Neither player needs an account or SSH installation, and the maintainer does not operate a game server. Guests may see a welcome page before joining; free tunnels last up to 24 hours. See [tunnl.gg's limits](https://tunnl.gg/docs). Cloudflare Quick Tunnel and ngrok remain available under **Internet connection**.

To use ngrok on desktop, expand **Internet connection** in the game settings and select it. Enter the host's authtoken, or use the token saved through the desktop Connection screen. Guests never receive that token. The free plan has usage limits and a browser welcome page. See the [player guide](docs/player-guide.md#internet-invitations).

The [account-free tunnel comparison](docs/tunnel-research.md) explains the alternatives, session limits, and reliability checks needed before changing providers.

Keep the host app open and the device awake during a match. On Android, return to Kamisado after sharing and keep it in the foreground. Games are held in memory and are lost when the host closes the app. Anyone holding an invitation can try to join or watch, so share it privately. HTTPS protects traffic in transit; the tunnel provider terminates HTTPS and is not an end-to-end-encrypted peer connection.

## Build and run from source

Install Git and Node.js **22.12 or newer** with npm; Node.js 24 is recommended. Get the source using the [developer setup](docs/development.md#get-the-source), then run this once from the repository root:

```sh
npm ci
```

Desktop builds also require **Go 1.26+** on PATH to compile the bundled tunnl.gg connector. The desktop commands below build it automatically; players do not need Go or SSH installed.

All commands below start from the repository root. Build desktop apps on the operating system they will run on, using its native Node.js installation. WSL builds Linux apps; use a separate Windows checkout and Windows Node.js to build Windows apps. Before collecting another release, move the previous platform folder out of `out/release/`; collection refuses to mix old and new builds.

### Browser on Windows, Linux, or macOS

Compile and start the local server:

```sh
npm run build
npm start
```

Open `http://localhost:3000`. Stop the server with **Ctrl+C**. If port 3000 is already occupied, choose another port:

```powershell
# Windows PowerShell
$env:PORT = '3001'
npm start
```

```sh
# Linux or macOS
PORT=3001 npm start
```

Then open `http://localhost:3001`. Rebuild after changing TypeScript. For server development, `npm run dev` reloads the server automatically; it does not rebuild the browser bundle.

### Windows desktop

In PowerShell, compile and launch the app:

```powershell
npm run desktop:dev
```

To build and collect a Windows x64 portable app and ZIP:

```powershell
npm run desktop:make -- --arch=x64
npm run release:desktop
```

The ready-to-run app and ZIP are in `out/release/Windows-desktop/`. To run it directly:

```powershell
& .\out\release\Windows-desktop\Kamisado\Kamisado.exe
```

### Linux desktop

From a graphical desktop session, compile and launch the app:

```sh
npm run desktop:dev
```

To build and collect a portable Linux x64 app and ZIP on Debian or Ubuntu:

```sh
sudo apt-get install -y zip
npm run desktop:make -- --arch=x64
npm run release:desktop
```

The app and ZIP are in `out/release/Linux-desktop/`. To run the app:

```sh
./out/release/Linux-desktop/Kamisado/Kamisado
```

No package installation is needed to run the game. Electron still uses your desktop's system libraries; see the [Linux player guide](docs/player-guide.md#linux).

### macOS desktop

On a Mac, compile and launch the app:

```sh
npm run desktop:dev
```

Build a ZIP and open the unpacked app on Apple Silicon:

```sh
npm run desktop:make -- --arch=arm64
npm run release:desktop
open out/release/macOS-desktop/Kamisado/Kamisado.app
```

For an Intel Mac, replace `arm64` with `x64`. The app and ZIP are in `out/release/macOS-desktop/`. Install Apple's Command Line Tools with `xcode-select --install` if a native dependency needs compilation. macOS desktop packaging is configured but has not been validated; signing and notarization are not configured.

### Android from Windows, Linux, or macOS

Install Android Studio, **JDK 21**, Android SDK Platform **36**, Build Tools **36.0.0**, and Platform Tools. Set `JAVA_HOME` to your JDK directory and `ANDROID_HOME` to your SDK directory. Use a checkout and SDK on the same operating system.

To compile and run through Android Studio:

For Cloudflare and tunnl.gg hosting, first install **Go 1.26+** and **Android NDK 26.1+**, then build the bundled connectors once:

```powershell
# Windows PowerShell
$env:ANDROID_NDK_HOME = "$env:LOCALAPPDATA/Android/sdk/ndk/26.1.10909125"
npm run mobile:tunnel
```

```sh
# Linux/macOS: adjust this to your installed NDK
ANDROID_NDK_HOME="$ANDROID_HOME/ndk/26.1.10909125" npm run mobile:tunnel
```

Then open the native project:

```sh
npm run mobile:android
```

This builds the shared game assets, synchronizes the native project, and opens Android Studio. Select a connected phone or emulator and press **Run**. For a physical phone, enable USB debugging and accept the authorization prompt.

To build a debug APK from the terminal instead:

```powershell
# Windows PowerShell
npm run mobile:sync
.\mobile\android\gradlew.bat -p mobile/android assembleDebug
```

```sh
# Linux or macOS
npm run mobile:sync
./mobile/android/gradlew -p mobile/android assembleDebug
```

The APK is `mobile/android/app/build/outputs/apk/debug/app-debug.apk`. Run `npm run release:android` to copy it into `out/release/Android/` with instructions and checksums. With the SDK's `platform-tools` directory on your `PATH` and one authorized phone or emulator connected, install and launch it:

```sh
adb devices
adb install -r mobile/android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n io.github.acilione.kamisado/.MainActivity
```

This produces a development-signed APK. See the [mobile guide](docs/mobile.md#android-build) for release signing. Run `npm run mobile:sync` before each native rebuild after changing game code or assets.

### iOS on macOS

Use a Mac with **Xcode 26 or newer** and its command-line tools. Build the shared assets and open the native project:

```sh
npm run mobile:ios
```

In Xcode, select the **App** scheme and a simulator or connected iPhone, then press **Run**. For a physical iPhone, choose your signing team under **Signing & Capabilities**. The project uses Swift Package Manager; CocoaPods is not needed.

For a terminal build, start one iOS simulator in Xcode, then run:

```sh
npm run mobile:sync
xcodebuild -project mobile/ios/App/App.xcodeproj -scheme App \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath out/ios CODE_SIGNING_ALLOWED=NO build
xcrun simctl install booted out/ios/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch booted io.github.acilione.kamisado
```

The unsigned simulator build cannot be installed on an iPhone. Native iOS builds still need verification on a Mac; see the [iOS guide](docs/mobile.md#ios-build) for signing and distribution.

For tests, build troubleshooting, and the code layout, see [Development](docs/development.md) and [Code structure](docs/architecture.md).

## Documentation

- [Player guide](docs/player-guide.md): downloads, installation, game modes, and troubleshooting.
- [Game rules](docs/rules.md): movement, forced passes, scoring, and sumo towers.
- [Mobile guide](docs/mobile.md): Android and iPhone installation, native builds, and shared code.
- [Development](docs/development.md): prerequisites, running from source, compiling, packaging, tests, and releases.
- [Code structure](docs/architecture.md): module responsibilities, game state, networking, and the desktop app.
- [Computer opponent](docs/ai-research.md): search algorithm, difficulty settings, and research references.

## License

The project uses the [MIT license](LICENSE). Tower character outlines are derived from Noto Sans CJK; its [SIL Open Font License](public/licenses/NotoSansCJK-OFL.txt) is included with the game.
