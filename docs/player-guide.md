# Player guide

[Back to the README](../README.md)

Kamisado runs as a desktop app, with a browser option for guests in LAN games. A packaged desktop build includes everything needed to play; you do not need Node.js, npm, or a terminal to run it.

## Get a build

There are no published releases or public installer downloads yet. You can [build from source](../README.md#build-and-run-from-source) or ask the maintainer for a test build. If you receive packaged files, use the table below to choose the one for your computer. Filenames include the build's version number.

| Platform | File to choose |
| --- | --- |
| Windows, Intel or AMD 64-bit | `Windows-desktop/Kamisado-<version>-Windows-x64-portable.zip` |
| Linux, Intel or AMD 64-bit | `Linux-desktop/Kamisado-<version>-Linux-x64-portable.zip` |
| Android | `Android/Kamisado-<version>-Android-test.apk` |
| Mac with Apple silicon | `Kamisado-<version>-macOS-arm64-portable.zip`, if supplied by the maintainer |
| Mac with an Intel processor | `Kamisado-<version>-macOS-x64-portable.zip`, if supplied by the maintainer |

The automated release workflow currently builds **Windows x64 and Linux x64**. Mac builds are not included yet. `x64` and `amd64` both refer to 64-bit Intel/AMD computers; `arm64` is a different architecture.

These platform folders are under `out/release/` in a local build. Each desktop folder also contains an unpacked `Kamisado/` directory ready to open. Desktop builds run without installation. `SHA256SUMS-*.txt` lists checksums for the archive and start guide. The **Source code** archives contain the project for developers, not an app you can open.

The repository includes a **Desktop downloads** workflow for generating test packages. Its configuration does not mean a downloadable build has been produced or a release published.

## Open and play

### Windows

1. Download the `Windows-x64-portable.zip` archive.
2. Right-click it, choose **Extract All**, and select a Windows folder such as Downloads.
3. Open that folder and double-click **Kamisado.exe**.

Keep the files in the extracted folder together. Moving only the executable will break the app. The ZIP version still saves preferences in your Windows user profile.

If you already have the unpacked build, open `Windows-desktop/Kamisado/Kamisado.exe`. Use this Windows build directly from Explorer, even if you develop the game in WSL.

The builds are currently unsigned, so Windows may show an unknown-publisher warning. Check that you downloaded the file from the project or received it from a maintainer you trust before opening it.

### Linux

1. Download the `Linux-x64-portable.zip` archive and extract it completely.
2. Open the extracted folder and launch **Kamisado**. The filename is case-sensitive and has no `.exe` extension.
3. If your file manager will not run it, open the file's **Properties → Permissions** and enable execution. The wording varies by desktop environment.

If you already have the unpacked build, open `Linux-desktop/Kamisado/Kamisado`. No DEB or RPM installation is needed. Keep the runtime files beside the executable. If needed, run `chmod +x Kamisado` in the extracted folder and then `./Kamisado`.

The ZIP includes the game and Electron, but still uses Linux desktop libraries such as GTK, NSS, and ALSA. If it reports a missing library, install that library using your distribution's package manager. Run as your ordinary desktop user, not root; do not disable the Chromium sandbox to work around launch errors. The current downloads are for Intel/AMD 64-bit Linux, not ARM devices such as a Raspberry Pi.

### Mac

There is no automated, tested Mac download at present. A Mac can already use a hosted game in a browser, including joining a LAN invitation from Windows or Linux. Offline desktop play and the app's Internet P2P mode require a Mac build; the [developer guide](development.md#macos) explains how to make one on a Mac.

If the maintainer supplies a Mac build:

1. Open **Apple menu → About This Mac**. A **Chip** entry such as Apple M1, M2, or later means you need `arm64`; an Intel **Processor** means you need `x64`.
2. Download the matching `macOS` portable ZIP.
3. Double-click the ZIP in Finder to extract it.
4. Drag **Kamisado.app** to **Applications**, then open it from there.

Signing and notarization are not configured in this repository. If macOS blocks a trusted test build because the developer cannot be verified, try opening it once, then check **System Settings → Privacy & Security → Open Anyway**. Follow [Apple's instructions for opening downloaded apps](https://support.apple.com/en-us/102445); an alert saying the app is damaged or contains malware needs a different response from an unidentified-developer alert.

### Android, iPhone, and iPad

The [mobile guide](mobile.md) covers the Android APK and iOS project, offline computer play, and P2P with desktop or mobile opponents. Phones can also open desktop LAN invitations in their browsers without installing the mobile app.

## Windows, WSL, and Internet connections

If you launch the Linux desktop app inside WSL, its WebRTC connection also runs inside WSL. WSL normally uses NAT and can add another firewall boundary; this can make a direct connection harder. Use the native Windows portable build to remove that layer. If only the Node server runs in WSL and the game opens in a Windows browser, WebRTC originates in that Windows browser. See [Microsoft's WSL networking documentation](https://learn.microsoft.com/en-us/windows/wsl/networking).

A failed direct connection does not identify WSL as the cause. Routers, mobile carriers, and firewalls can also prevent peers on different networks from reaching each other. Try a fresh invitation with the native Windows app and keep both apps open. If that still fails, use **Relay fallback** with TURN credentials, or a reachable network shared by both players. STUN discovers addresses but cannot relay blocked traffic; [WebRTC's TURN guide](https://webrtc.org/getting-started/turn-server) explains this limit. TURN remains an explicit fallback after the direct attempt.

## Start a game

### Against the computer

1. Open the app. The game settings appear first.
2. Set the difficulty from **1–10**, your side, match length, and any other options.
3. Press **Play with computer** to begin.

Black moves first. If you choose White, the computer makes the opening move. Computer games work offline. The levels use a classical search algorithm, with more thinking time and a deeper search at higher settings.

### On the same network

Only the host needs the desktop app. The other player can use a browser on a computer, phone, or tablet.

1. Connect both devices to the same Wi-Fi or Ethernet network.
2. The host opens **Connection → Host a LAN game** before creating a match.
3. The host selects the game options and presses **Create Game**.
4. Share the invitation link shown beside the board, or let the other player scan its QR code.
5. The other player opens that invitation in a browser. The game begins when they join.

If the other player has the desktop app too, **Join with a link** opens the invitation in their usual browser. Send the full link, including the address and `/game/…` part. LAN play does not need an account or an Internet connection.

### Over the Internet with P2P

Both players need an updated desktop or mobile app. The host's device runs the match.

1. The host chooses the game settings and presses **Create game**.
2. Press **Share link**. On a phone, choose a messaging app in the share sheet. On desktops without system sharing, the link is copied for you to send.
3. Your friend opens the `kamisado://join/…` link. Kamisado opens and joins automatically, without a reply code or another Join button.

Some messaging apps do not make custom app links clickable. In that case, copy the link into **Join a game** in Kamisado. App links require Kamisado to be registered as their handler. On Windows, open the extracted app once before using links; on Linux, paste invitations into the portable app unless your desktop already has a registered handler. These links do not need a website.

The connection panel closes when the apps connect. There is no reply to copy back. Keep both apps open throughout the match; on a phone, return to Kamisado after sending the invitation. Invitations expire after ten minutes. Create a fresh one if setup takes longer.

This **Quick connect** mode uses [PeerJS Cloud](https://peerjs.com/server/cloud) to exchange connection details automatically. The players and Kamisado's maintainer do not need an account or a server. PeerJS Cloud handles setup, while moves travel over an encrypted WebRTC connection between the apps. The service can see connection metadata such as addresses; it does not run the match. A service outage can prevent a new connection but does not end an already connected game.

The invitation link contains a randomly generated secret. Treat it like access to your game: share it only with the intended opponent. The app uses that secret to authenticate the connection; it does not send the secret to the signaling service. Earlier `K2.` codes can still be pasted into Join.

The first attempt uses public STUN address discovery, with no TURN relay. Direct connections can work between different Internet providers, but some routers and mobile carriers block them. Quick connect removes the manual exchange; it cannot make a blocked direct route reachable. See [Relay fallback](#relay-fallback) if the connection fails.

### Manual connection

Use this option if PeerJS Cloud is unavailable or you prefer to exchange the setup details yourself. In the connection panel, open **Advanced** and set **Connection method** to **Manual code exchange** on both apps.

1. The host presses **Create invitation code**, copies the full code, and sends it to the guest.
2. The guest pastes the invitation, presses **Create reply code**, and sends the reply back.
3. The host pastes the reply and presses **Connect to friend**.

These longer `KAMISADO1` codes remain compatible with earlier versions for direct connections. They expire after ten minutes and still use public STUN for address discovery. Manual exchange avoids the signaling service; it does not bypass a router or carrier that blocks direct P2P.

### Relay fallback

After a direct attempt fails, open **Relay fallback** in the connection panel. It lets you retry through a TURN service while keeping the game on the host's device. Both players need an updated app containing this option.

1. Obtain TURN addresses, a username, and a session password from a relay provider. The app does not include a service or create an account. Use temporary session credentials where the provider supports them; do not enter its account password or API key.
2. On the host, check **Use TURN for the next attempt** and enter those credentials. Prefer the provider's `turns:` address with TCP, often on port 443, if offered. Use its actual address; `relay.example.com` in the placeholder is not a service.
3. Create a **new invitation** and send it to your friend. A Quick connect relay link contains `K2R.`.
4. The guest pastes the new invitation, opens **Relay fallback**, enables TURN, and enters their relay credentials before pressing **Join**. A relay invitation makes this option available even if the guest has not yet seen a failure.
5. The apps connect automatically. The status confirms when the connection uses a relay. If you selected manual exchange, send a new reply back to the host instead.

Credentials stay in the open app session and are not saved or included in invitation/reply codes. Game data is encrypted between the two apps; the relay forwards it and can see connection addresses and traffic volume. It does not run the game. These are the standard [WebRTC TURN](https://webrtc.org/getting-started/turn-server) and [data-channel encryption](https://www.rfc-editor.org/rfc/rfc8831) mechanisms.

The app never contacts TURN during the first direct attempt. Selecting the fallback uses a relay for that retry. Uncheck it to try direct P2P again. If the relay cannot supply an address, check its credentials and expiry, and try the provider's TLS/TCP endpoint. A relay on your home network is not enough for an Internet opponent unless it is publicly reachable.

For a managed service, [Cloudflare TURN](https://developers.cloudflare.com/realtime/turn/generate-credentials/) supports temporary credentials. Its long-term TURN key is used to generate a session username and credential; it must not be entered into the game or shipped with the app. Enter the returned TURN addresses, username, and credential in the fields above. A provider account and credential generation are separate from building Kamisado.

### Through the optional ngrok relay

This is an alternative for someone who wants to host with an ngrok account and let their friend join in a browser.

1. Expand **Other Internet connection options** and choose **Connect with ngrok**.
2. Follow the link to your ngrok account, copy its authtoken, and paste it into the app.
3. Choose whether to remember the token, then press **Connect and continue**.
4. Create a game and share its invitation link.

This mode sends traffic through ngrok's service. The guest needs neither the app nor an ngrok account. Saved credentials can be removed with **Forget** in the connection settings.

## Board and match controls

Click a tower, then one of its highlighted destinations. In the 3D view, drag to rotate the board and scroll or pinch to zoom; **Reset view** restores the camera to your side.

Choose **Realistic 2D** or **Realistic 3D** in the game options or below the board. **Symbol mode** adds matching characters to the squares and towers; during a match, use the compact **Symbols** switch below the board. **Symbol key** shows the correspondence between colors and characters. These settings affect only your own view and are remembered on your device. If 3D is unavailable, the game falls back to 2D.

Match lengths are 1, 3, 7, or 15 points. You can also choose a clock and a starting-position mode. The [rules guide](rules.md) explains forced moves, sumo towers, and what changes between rounds.

## Leave or resume a game

Keep the host computer awake during play. The app does not save unfinished matches.

| Action | Result |
| --- | --- |
| **End game** in a computer match | Ends that match and returns to its game menu. |
| **Connection → End session** in computer or P2P mode | Returns to the desktop connection window. A P2P opponent is disconnected. |
| **Connection → Stop hosting** in LAN or ngrok mode | Ends the hosted games and returns to the welcome window. |
| Close the host app | Ends all games on that host. |

After a temporary disconnect, a player has up to 60 seconds to return before losing the match. Between rounds, the separate 30-second confirmation countdown can end the match sooner. LAN browser clients try to reconnect automatically. If a P2P connection needs a new setup, the host creates a fresh invitation and the guest joins again before the countdown ends. Manual mode also requires a fresh reply. Restarting the host app creates a new session; it cannot restore the old match.

## Connection troubleshooting

### A LAN invitation will not open

- Check that the host app is still running and that both devices are on the same network. On a phone, use Wi-Fi rather than mobile data.
- Allow Kamisado through the host's firewall on your trusted private network when prompted.
- Guest Wi-Fi, hotel networks, and some hotspots keep devices apart. Try a home network that allows devices to communicate.
- If a VPN blocks local access, enable its local-network option or disconnect it for LAN play.
- A host with several network adapters may advertise the wrong address. Open **Connection → Connection details**, choose **Use for invitation** beside the shared network's address, then resend the updated invitation from the game.

### P2P setup fails

- Update both apps to use Quick connect, copy the entire invitation, and keep the host app open. If the invitation expires, create a fresh one.
- Return to Kamisado after sharing an invitation from your phone. A background app may be suspended before the guest connects.
- If Quick connect cannot reach its signaling service, try again or use [Manual connection](#manual-connection). Manual mode needs the latest invitation and its matching reply; a reply to an older invitation will not work.
- If direct setup keeps failing, use [Relay fallback](#relay-fallback) with a TURN service. Without a relay, you need a network that permits direct connections, or a private VPN connecting both devices.
- The optional ngrok relay remains available if you choose to use that service. It is a separate connection mode.

### The game disappeared after closing the app

Matches are stored only in memory. Create a new game and share its new invitation. Board-view and symbol preferences are saved, but moves are not.

For other problems, [open an issue](https://github.com/acilione/kamisado/issues) with your operating system, the downloaded filename, the game mode, and the error message. Do not include ngrok tokens or active connection codes.
