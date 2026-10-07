# Android and iPhone

The mobile app uses Capacitor 8 to package the existing game for Android and iOS. The board, symbols, 3D renderer, rules, match controller, and ten AI levels are shared with the desktop version.

## Install and play

### Android

Open `out/release/Android/` in a local build, or get a Kamisado `.apk` supplied by the maintainer. Transfer the APK to your phone and open it. Android may ask you to allow installation from the browser or file manager you used. After installation, open **Kamisado** from your apps.

After building, `npm run release:android` collects the APK, start guide, and checksums in `out/release/Android/`. Move an older `Android` output folder elsewhere before collecting another build.

The project currently produces a **debug APK** for testing. It is signed with a development key and is not a Google Play release. Updates built on a different machine may require uninstalling the earlier test app first, which removes its preferences. A public release should use a stable signing key.

Android 7.0 or newer is required, with Android System WebView 100 or newer. Keep WebView up to date. Devices without usable WebGL fall back to the 2D board.

### iPhone and iPad

The iOS project is included, but there is no App Store or TestFlight release yet. A maintainer with a Mac must build and sign it in Xcode before it can be installed on an iPhone. The app targets iOS 15.4 or newer.

You can also join a desktop LAN game now by opening its invitation link in Safari. This browser option requires the desktop host to keep running.

### Game modes

- **Play with computer:** choose settings and press the button. All ten levels work offline.
- **Create game on Android:** choose settings, then press **Create game**. tunnl.gg opens the connection by default. Press **Share link**, send the invitation, then return to Kamisado. Your friend opens the link in a browser, without an account or app installation.
- **Join a game:** open the HTTPS invitation in your browser, or paste it into the app's join field. Legacy `kamisado://join/` invitations still open the P2P join screen.

Cloudflare and tunnl.gg hosting require Android 10 or newer and are included for arm64 and x86_64 builds. tunnl.gg is selected by default under **Internet connection**; no account or credentials are needed. Its browser welcome page may appear before your friend joins. Older supported Android versions can still play offline and join in a browser. No Termux or router setup is needed. The host phone must remain awake with Kamisado in the foreground; locking it or switching away for an extended period can interrupt the game. There is no background service or permanent wake lock. Hosting keeps a connector and the game WebView running, so it uses more battery than joining; battery consumption has not been benchmarked. Keep brightness modest and use a charger for long games.

The tunnel forwards traffic through the selected provider. tunnl.gg retains its address across reconnects; Cloudflare assigns a new address for each hosting session. Neither guarantees an uninterrupted match. The app closes the connector when you return to the main menu or close the app. Share invitations privately: anyone with the link can try to join or watch. The provider terminates HTTPS and can process the traffic.

If a fresh invitation does not resolve, keep Kamisado open and ask your friend to retry the same link after a minute. If you selected Cloudflare, error **1033** means the connector has lost its connection; allow it to reconnect with the phone awake. If the error persists, return to the main menu and create a new invitation. Mobile hosting is experimental: it passed an on-device game test, but the connection also dropped during repeated testing.

ngrok hosting remains desktop-only. iOS hosting still uses the existing P2P flow; an iPhone can join either tunnel service through Safari. No iOS native tunnel connector is included.

Tap a tower, then its destination. In 3D, drag to rotate and pinch to zoom. The view selector and **Symbols** switch are below the board. **Main menu** returns to the settings screen, asking before leaving an unfinished match.

Keep multiplayer apps in the foreground. Mobile operating systems can suspend an app when you switch away or lock the screen; the existing reconnect deadlines still apply. In computer games, switching away pauses the playing clock and cancels the current search; returning resumes it. The between-round confirmation countdown still expires normally. Closing the app loses unfinished games. Display and difficulty preferences are saved.

## Build from source

Start with the [developer setup](development.md#get-the-source). Install dependencies, then build and copy the shared web assets into the native projects:

```sh
npm ci
npm run mobile:sync
```

`mobile:sync` runs the mobile build and Capacitor sync. Run it after changing TypeScript, HTML, CSS, or native plugin dependencies. `npm run mobile:build` alone creates the web bundle in `out/mobile/` for browser testing. The native projects under `mobile/` are checked in; do not run `cap add` again.

### Android build

Install Android Studio 2025.2.1 or newer, JDK 21, Android SDK platform/build tools 36, Go 1.26 or newer, and Android NDK 26.1 or newer. Set Android Studio's Gradle JDK to 21. These follow the [Capacitor 8 environment requirements](https://capacitorjs.com/docs/getting-started/environment-setup).

Build the bundled connector once before building the APK (and again when updating its pinned version):

```sh
# Linux/macOS: use your installed NDK path
export ANDROID_NDK_HOME="$ANDROID_HOME/ndk/26.1.10909125"
npm run mobile:tunnel
npm run mobile:android
```

```powershell
# Windows PowerShell: use your installed SDK path
$env:ANDROID_NDK_HOME = "$env:LOCALAPPDATA/Android/sdk/ndk/26.1.10909125"
npm run mobile:tunnel
npm run mobile:android
```

The connector build downloads checksum-pinned Cloudflare source and uses Go's module checksums for dependencies. It adds the small, checked-in `scripts/android-cloudflared-dns.go` adapter so Go DNS queries use Android's resolver, including its VPN/private DNS settings, instead of looking for a Unix `resolv.conf`. It produces `arm64-v8a` and `x86_64` executables under `mobile/android/app/src/main/jniLibs/`. They are packaged as native libraries because Android does not allow apps to execute downloaded files from writable app storage. `KAMISADO_ANDROID_ABIS=arm64-v8a` can restrict a local device build. Go and the NDK are build-time tools; players only install the APK. Without the connector build, offline games still compile, but Android Internet hosting reports a missing connector.

This synchronizes the assets and opens Android Studio. Select a phone or emulator and press **Run**. Use Android Studio's APK build action to create a test installer.

For a command-line build, configure `JAVA_HOME` and `ANDROID_HOME` for your installed JDK and SDK, then run:

```sh
npm run mobile:sync
cd mobile/android
./gradlew assembleDebug
```

In Windows PowerShell, use `.\gradlew.bat assembleDebug`. The APK is written to `mobile/android/app/build/outputs/apk/debug/app-debug.apk`. Build on the same operating system as your SDK; a Windows SDK cannot be used directly by Linux Gradle in WSL.

For distribution, use Android Studio's **Generate Signed App Bundle or APK** flow and retain the signing key outside Git. See [Android's signing guide](https://developer.android.com/studio/publish/app-signing). A debug APK is suitable for testing; Google Play distribution needs a signed release bundle.

### iOS build

Use a Mac with Xcode 26 or newer and its command-line tools. The project uses Swift Package Manager, so CocoaPods is not required. See the [Capacitor iOS setup](https://capacitorjs.com/docs/getting-started/environment-setup).

```sh
npm run mobile:ios
```

In Xcode, select the **App** target, choose your signing team under **Signing & Capabilities**, then select a simulator or connected iPhone and run it. Keep the bundle identifier consistent for future updates. Use **Product > Archive** and Xcode's distribution tools for TestFlight or App Store delivery.

An unsigned simulator build can be checked from the command line:

```sh
xcodebuild -project mobile/ios/App/App.xcodeproj -scheme App \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath out/ios CODE_SIGNING_ALLOWED=NO build
```

This produces a simulator application, not an installer for a physical iPhone. Native iOS execution must be verified on a Mac and an iPhone before a release.

## Code and maintenance

| Location | Responsibility |
| --- | --- |
| `public/`, `src/client/` | One game page, touch layout, 2D/3D boards, symbols, and P2P interface for every platform. |
| `src/server/game.ts`, `src/server/sessions.ts` | Shared rules and match authority. The session host has no Node runtime dependency. |
| `src/server/ai/engine.ts`, `position.ts` | Shared AI search and evaluation. |
| `src/mobile/main.ts` | Mobile menu, native app lifecycle, and opening LAN invitations in the browser. |
| `src/mobile/local-host.ts` | In-memory event transport connecting the shared client and match controller. |
| `src/mobile/worker-runner.ts`, `ai-worker.ts` | Web Worker adapter for the shared AI. Desktop uses its existing Node worker adapter. |
| `src/client/event-socket.ts` | Event and acknowledgement handling shared by local, HTTP, and WebRTC transports. |
| `src/mobile/tunnel-host.ts`, `tunnel-guest.ts`, `src/client/http-socket.ts` | Android host adapter and browser guest transport; both use the shared match controller. |
| `mobile/android/.../GameTunnelPlugin.java` | Loopback HTTP listener, bounded guest queues, static guest assets, and connector lifecycle. No game rules. |
| `scripts/build-android-tunnel.cjs` | Verified source download and Android cross-compilation of cloudflared. |
| `native/tunnl/`, `scripts/build-tunnl.cjs` | Shared SSH connector and desktop/Android builds. `mobile:tunnel` builds both providers. |
| `scripts/build-mobile.cjs` | Packages the existing HTML/CSS and mobile entry point; embeds the AI worker for offline use and iOS's local URL scheme. |
| `capacitor.config.json`, `mobile/android/`, `mobile/ios/` | App identifiers, native project settings, icons, permissions, and native builds. |

Both native shells use their platform WebView. There is no React Native, Flutter, or second UI framework to maintain. Changes to game rules or rendering apply to all versions. Only the transport and worker adapters vary.

The mobile transport clones messages so a renderer cannot accidentally change the authoritative board. P2P uses the same room restrictions, identity handling, and message limits as desktop. LAN invitations open in the browser; remote pages are not loaded into the app's native bridge.

Icons come from `mobile/icon.svg`. After editing it, run `node scripts/generate-mobile-icons.cjs` with Playwright Chromium installed. Commit the generated native artwork along with the SVG. Generated web assets, Gradle outputs, and signing credentials are ignored by Git.

## Verification and CI

```sh
npx playwright install --with-deps chromium webkit
npm test
npm run test:mobile
```

The mobile tests run the actual bundle with phone-sized touch viewports, disable networking for all ten AI levels, check symbols and 2D/3D, and exchange moves with desktop hosts and guests using real WebRTC. To run the same checks with WebKit:

```sh
MOBILE_BROWSER=webkit node tests/browser/test_mobile.cjs
```

In PowerShell, set `$env:MOBILE_BROWSER = 'webkit'` before running the Node command. Browser WebKit tests exercise the web code; they do not replace native iPhone testing.

The **Mobile apps** workflow builds an Android debug APK, compiles an unsigned iOS simulator app, and runs the mobile browser tests. Its Android artifact can be downloaded from the completed Actions run for 14 days; extract the downloaded ZIP to get `app-debug.apk`. These builds do not publish to an app store.

For a native Android smoke test, install a debug APK on a test phone or emulator and open its main menu. Enable USB debugging, find the app process with `adb shell pidof io.github.acilione.kamisado`, and forward its WebView socket:

```sh
adb forward tcp:9223 localabstract:webview_devtools_remote_<process-id>
node scripts/test-mobile-native.cjs
```

Replace `<process-id>` with the returned number. The script connects to that existing app, plays a level-10 game, verifies a real AI-worker result, and checks symbols and both board views. Turn on airplane mode on the test device first to verify the native offline path. `MOBILE_CDP_URL` can override the forwarded address. Screenshots are written under `out/mobile-checks/`.

Before distributing a build, install it on real devices and check screen locking, app switching, sharing an invitation through a messaging app, and P2P between different Internet connections. Automated local tests do not cover every router or mobile operating-system policy.
