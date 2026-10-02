# Player guide

[Back to the README](../README.md)

Kamisado runs as a desktop app, with a browser option for guests in LAN games. Downloading the app is enough to play; you do not need Node.js, npm, or a terminal.

## Choose a download

Go to [Releases](https://github.com/acilione/kamisado/releases), open the release you want, and expand **Assets**. The version number in each filename changes between releases.

| Platform | File to choose |
| --- | --- |
| Windows, Intel or AMD 64-bit | `Kamisado-<version> Setup.exe` |
| Windows, without installation | `Kamisado-win32-x64-<version>.zip` |
| Debian or Ubuntu, 64-bit | `kamisado_<version>_amd64.deb` |
| Fedora-compatible Linux, 64-bit | The `.rpm` asset, when provided |
| Linux, without installation | `Kamisado-linux-x64-<version>.zip` |
| Mac with Apple silicon | `Kamisado-darwin-arm64-<version>.zip`, if supplied by the maintainer |
| Mac with an Intel processor | `Kamisado-darwin-x64-<version>.zip`, if supplied by the maintainer |

The automated release workflow currently builds **Windows x64 and Linux x64**. Mac builds are not included yet. `x64` and `amd64` both refer to 64-bit Intel/AMD computers; `arm64` is a different architecture.

You only need one installer or ZIP for your computer. `RELEASES` and `.nupkg` files support the Windows installer. `SHA256SUMS-*.txt` lists checksums for checking download integrity. The **Source code** archives contain the project for developers, not an app you can open.

If the release has no application downloads, ask the maintainer for a build. Developers can [build from source](development.md). Preview downloads may also be attached to completed [Desktop downloads workflow runs](https://github.com/acilione/kamisado/actions/workflows/release.yml); downloading those requires a GitHub account.

## Install and open

### Windows

**Installer**

1. Download the file ending in `Setup.exe`.
2. Open it and let the installer finish.
3. Open **Kamisado** from the Start menu.

**Portable ZIP**

1. Download the `win32-x64` ZIP.
2. Right-click it, choose **Extract All**, and select a folder.
3. Open that folder and double-click **Kamisado.exe**.

Keep the files in the extracted folder together. Moving only the executable will break the app. The ZIP version still saves preferences in your Windows user profile.

The builds are currently unsigned, so Windows may show an unknown-publisher warning. Check that you downloaded the file from the project or received it from a maintainer you trust before opening it.

### Linux

**Debian or Ubuntu**

Download the `.deb` file and open it with your distribution's software installer. Install the package, then launch **Kamisado** from the applications menu.

**Fedora-compatible distributions**

Download the `.rpm` file, when it is included in the release. Open it with the system software installer, install it, and launch **Kamisado** from the applications menu.

**Portable ZIP**

1. Download the `linux-x64` ZIP and extract the entire archive.
2. Open the extracted folder and launch **Kamisado**. The filename is case-sensitive and has no `.exe` extension.
3. If your file manager will not run it, open the file's **Properties → Permissions** and enable execution. The wording varies by desktop environment.

The ZIP includes the game and Electron, but still uses system libraries. If it reports missing libraries, use the `.deb` or `.rpm` package for your distribution so the package manager can resolve dependencies. The current downloads are for Intel/AMD 64-bit Linux, not ARM devices such as a Raspberry Pi.

### Mac

There is no automated, tested Mac download at present. A Mac can already use a hosted game in a browser, including joining a LAN invitation from Windows or Linux. Offline desktop play and the app's Internet P2P mode require a Mac build; the [developer guide](development.md#macos) explains how to make one on a Mac.

If the maintainer supplies a Mac build:

1. Open **Apple menu → About This Mac**. A **Chip** entry such as Apple M1, M2, or later means you need `arm64`; an Intel **Processor** means you need `x64`.
2. Download the matching `darwin` ZIP. `darwin` is the platform name used in Mac filenames.
3. Double-click the ZIP in Finder to extract it.
4. Drag **Kamisado.app** to **Applications**, then open it from there.

Signing and notarization are not configured in this repository. If macOS blocks a trusted test build because the developer cannot be verified, try opening it once, then check **System Settings → Privacy & Security → Open Anyway**. Follow [Apple's instructions for opening downloaded apps](https://support.apple.com/en-us/102445); an alert saying the app is damaged or contains malware needs a different response from an unidentified-developer alert.

## Start a game

### Against the computer

1. Choose **Play computer** in the welcome window.
2. Set the difficulty from **1–10**, your side, match length, and any other options.
3. Press **Play computer** to begin.

Black moves first. If you choose White, the computer makes the opening move. Computer games work offline. The levels use a classical search algorithm, with more thinking time and a deeper search at higher settings.

### On the same network

Only the host needs the desktop app. The other player can use a browser on a computer, phone, or tablet.

1. Connect both devices to the same Wi-Fi or Ethernet network.
2. The host chooses **Host a LAN game**.
3. The host selects the game options and presses **Create Game**.
4. Share the invitation link shown beside the board, or let the other player scan its QR code.
5. The other player opens that invitation in a browser. The game begins when they join.

If the other player has the desktop app too, **Join with a link** opens the invitation in their usual browser. Send the full link, including the address and `/game/…` part. LAN play does not need an account or an Internet connection.

### Over the Internet with P2P

Both players need the desktop app. The host's computer runs the match; there is no central game or matchmaking server.

1. One player chooses **Host Internet game**, and the other chooses **Join Internet game**.
2. The host selects the game options, presses **Create Game**, then **Create invitation code**.
3. The host presses **Copy code** and sends the entire invitation through their usual messaging app.
4. The guest pastes it into the invitation box, presses **Create reply code**, and sends that reply back.
5. The host pastes the reply and presses **Connect to friend**.

The connection panel closes when the apps connect. Keep both apps open throughout the match. Codes expire after ten minutes; create a fresh invitation if setup takes longer.

The connection uses WebRTC and a public STUN service to find network addresses. Moves travel directly between the players. Some routers and work or mobile networks block this connection, and P2P mode does not use a TURN relay to get around that restriction. See [connection troubleshooting](#connection-troubleshooting) if setup fails.

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
| **Session → End session** in computer or P2P mode | Returns to the desktop welcome window. A P2P opponent is disconnected. |
| **Connection → Stop hosting** in LAN or ngrok mode | Ends the hosted games and returns to the welcome window. |
| Close the host app | Ends all games on that host. |

After a temporary disconnect, a player has up to 60 seconds to return before losing the match. Between rounds, the separate 30-second confirmation countdown can end the match sooner. LAN browser clients try to reconnect automatically. If a P2P connection needs a new exchange, the host creates a fresh invitation and the guest sends a fresh reply before the countdown ends. Restarting the host app creates a new session; it cannot restore the old match.

## Connection troubleshooting

### A LAN invitation will not open

- Check that the host app is still running and that both devices are on the same network. On a phone, use Wi-Fi rather than mobile data.
- Allow Kamisado through the host's firewall on your trusted private network when prompted.
- Guest Wi-Fi, hotel networks, and some hotspots keep devices apart. Try a home network that allows devices to communicate.
- If a VPN blocks local access, enable its local-network option or disconnect it for LAN play.
- A host with several network adapters may advertise the wrong address. Open **Connection → Connection details**, choose **Use for invitation** beside the shared network's address, then resend the updated invitation from the game.

### P2P setup fails

- Copy the entire code and use the latest invitation and its matching reply. A reply to an older invitation will not work.
- Keep both apps open while exchanging codes. If a code expires, start a fresh exchange.
- If the direct connection times out, try a different network. An existing private VPN that connects both computers can also provide a route for LAN play.
- The optional ngrok relay remains available if you choose to use that service. It is a separate connection mode.

### The game disappeared after closing the app

Matches are stored only in memory. Create a new game and share its new invitation. Board-view and symbol preferences are saved, but moves are not.

For other problems, [open an issue](https://github.com/acilione/kamisado/issues) with your operating system, the downloaded filename, the game mode, and the error message. Do not include ngrok tokens or active connection codes.
