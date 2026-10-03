# Android and iPhone

The mobile app uses Capacitor 8 to package the existing game for Android and iOS. The board, symbols, 3D renderer, rules, match controller, and ten AI levels are shared with the desktop version.

## Install and play

### Android

Download a Kamisado `.apk` supplied by the maintainer, transfer it to your phone, and open it. Android may ask you to allow installation from the browser or file manager you used. After installation, open **Kamisado** from your apps.

The project currently produces a **debug APK** for testing. It is signed with a development key and is not a Google Play release. Updates built on a different machine may require uninstalling the earlier test app first, which removes its preferences. A public release should use a stable signing key.

Android 7.0 or newer is required, with Android System WebView 100 or newer. Keep WebView up to date. Devices without usable WebGL fall back to the 2D board.

### iPhone and iPad

The iOS project is included, but there is no App Store or TestFlight release yet. A maintainer with a Mac must build and sign it in Xcode before it can be installed on an iPhone. The app targets iOS 15.4 or newer.

You can also join a desktop LAN game now by opening its invitation link in Safari. This browser option requires the desktop host to keep running.

### Game modes

- **Play computer:** choose a level and game options, then start. All ten levels work offline.
- **Host a friend / Join a friend:** exchange the invitation and reply codes. Either a phone or a desktop can host. The same controls work on local Wi-Fi and over the Internet.
- **Join a desktop LAN game:** paste the desktop invitation. It opens in your phone's browser. Scanning the desktop's QR code with your phone's camera works too.

Phone hosting uses direct WebRTC connections. It does not create an HTTP server or a browser invitation link. A friend joining a phone host needs the mobile or desktop app and the connection codes. Public STUN helps discover addresses; some networks prevent direct connections and there is no TURN relay fallback.

Tap a tower, then its destination. In 3D, drag to rotate and pinch to zoom. The view selector and **Symbols** switch are below the board. **End session** returns to the mobile menu.

Keep multiplayer apps in the foreground. Mobile operating systems can suspend an app when you switch away or lock the screen; the existing reconnect deadlines still apply. In computer games, switching away pauses the playing clock and cancels the current search; returning resumes it. The between-round confirmation countdown still expires normally. Closing the app loses unfinished games. Display and difficulty preferences are saved.

## Build from source

Start with the [developer setup](development.md#get-the-source). Install dependencies, then build and copy the shared web assets into the native projects:

```sh
npm ci
npm run mobile:sync
```

`mobile:sync` runs the mobile build and Capacitor sync. Run it after changing TypeScript, HTML, CSS, or native plugin dependencies. `npm run mobile:build` alone creates the web bundle in `out/mobile/` for browser testing. The native projects under `mobile/` are checked in; do not run `cap add` again.

### Android build

Install Android Studio 2025.2.1 or newer, JDK 21, and Android SDK platform/build tools 36. Set Android Studio's Gradle JDK to 21. These follow the [Capacitor 8 environment requirements](https://capacitorjs.com/docs/getting-started/environment-setup).

```sh
npm run mobile:android
```

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
| `src/client/event-socket.ts` | Event and acknowledgement handling shared by local mobile sessions and WebRTC guests. |
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

Before distributing a build, install it on real devices and check screen locking, app switching, copying connection codes through a messaging app, and P2P between different Internet connections. Automated local tests do not cover every router or mobile operating-system policy.
