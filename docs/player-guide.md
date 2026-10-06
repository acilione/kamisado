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

If you already have the unpacked build, copy the entire `Windows-desktop/Kamisado` folder to a local Windows folder such as Downloads, then open `Kamisado.exe` there. Running it directly from `\\wsl.localhost\...` or another network share prevents Electron's sandboxed processes from starting. The app displays a message explaining where to move it. Copying only the executable is not enough.

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

A failed direct connection does not identify WSL as the cause. Routers, mobile carriers, and firewalls can also prevent peers on different networks from reaching each other. Try the native Windows app and keep both apps open. Use a Cloudflare invitation, or configure legacy **TURN relay settings** on the host to let Quick connect retry through TURN automatically, or use a reachable network shared by both players. STUN discovers addresses but cannot relay blocked traffic; [WebRTC's TURN guide](https://webrtc.org/getting-started/turn-server) explains this limit.

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

### Internet invitations

1. Open the desktop or Android app and choose your game settings.
2. Press **Create game**. Cloudflare is selected by default. The first desktop connection downloads its connector; Android includes it in the APK.
3. Wait for the invitation, then press **Share link** (or **Copy link** if sharing is unavailable).
4. Your friend opens the HTTPS link in a browser on their phone or computer. They do not need an account, password, or installed app.
5. Keep the host app open and awake. On Android, return to the game after using the share sheet.

Cloudflare Quick Tunnels require no account, domain, payment details, or TURN settings. They are a temporary testing service with no availability guarantee. If creation fails, retry; on desktop you can also select ngrok under **Internet connection**. Ending hosting invalidates the tunnel address, so send a fresh invitation after restarting.

A new address can take a little time to become reachable. If your friend's browser cannot find it, leave the host running and retry the same link after a minute. A Cloudflare **1033** page means the tunnel is disconnected: keep the host awake and connected while it reconnects. If that persists, return to the main menu, create another game, and share the new link.

To host with **ngrok** on desktop:

1. Create or sign in to an [ngrok account](https://dashboard.ngrok.com/), then copy **Your Authtoken** from [the dashboard](https://dashboard.ngrok.com/get-started/your-authtoken). Use the authtoken, not an API key.
2. In Kamisado, choose your game settings, expand **Internet connection**, and select **ngrok**.
3. Paste the token into **ngrok authtoken**, then press **Create game**. The desktop app includes the ngrok connector, so there is no separate installation or terminal command.
4. Send the game's invitation link to your friend and keep Kamisado open. Your friend opens it in a browser; on the free plan, they may first need to click **Visit** on ngrok's welcome page.

Only the host configures the account; invitations do not contain its token. To save the token securely when supported, use **Connection → Other Internet connection options → Connect with ngrok**. The token entered in the game settings is cleared after the connection attempt. ngrok's free plan currently allows 1 GB outgoing traffic and 20,000 HTTP requests per month; check its dashboard for your actual usage and current limits. [ngrok limits](https://ngrok.com/docs/pricing-limits/free-plan-limits)

Share invitations privately. Anyone holding one can try to join or watch. These services forward the connection and terminate HTTPS; they are not end-to-end-encrypted P2P connections. You do not need to run a permanent game server. [Cloudflare Quick Tunnel documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

ngrok hosting is desktop-only. Android supports Cloudflare hosting; iPhones can join in Safari, while native iOS hosting retains the legacy P2P option.

### Over the Internet with P2P

This is the legacy connection mode. On desktop, select **Connection → Legacy P2P hosting**. For new games, use Internet invitations above to avoid relay configuration.


Both players need an updated desktop or mobile app. The host's device runs the match.

1. The host chooses the game settings and presses **Create game**.
2. Press **Share link**. On a phone, choose a messaging app in the share sheet. On desktops without system sharing, the link is copied for you to send.
3. Your friend opens the `kamisado://join/…` link. Kamisado opens and joins automatically, without a reply code or another Join button.

Some messaging apps do not make custom app links clickable. In that case, copy the link into **Join a game** in Kamisado. App links require Kamisado to be registered as their handler. On Windows, open the extracted app once before using links; on Linux, paste invitations into the portable app unless your desktop already has a registered handler. These links do not need a website.

The connection panel closes when the apps connect. There is no reply to copy back. Keep both apps open throughout the match; on a phone, return to Kamisado after sending the invitation. Invitations expire after ten minutes. Create a fresh one if setup takes longer.

This **Quick connect** mode uses [PeerJS Cloud](https://peerjs.com/server/cloud) to exchange connection details automatically. The players and Kamisado's maintainer do not need an account or a server. PeerJS Cloud handles setup, while moves travel over an encrypted WebRTC connection between the apps. The service can see connection metadata such as addresses; it does not run the match. A service outage can prevent a new connection but does not end an already connected game.

The invitation link contains a randomly generated secret. Treat it like access to your game: share it only with the intended opponent. The app uses that secret to authenticate the connection; it does not send the secret to the signaling service. Earlier `K2.` codes can still be pasted into Join.

By default, the first attempt uses public STUN address discovery, with no TURN relay. Direct connections can work between different Internet providers, but some routers and mobile carriers block them. Quick connect removes the manual exchange; it cannot make a blocked direct route reachable. See [Relay fallback](#relay-fallback) to configure automatic fallback or use TURN directly.

### Manual connection

Use this option if PeerJS Cloud is unavailable or you prefer to exchange the setup details yourself. In the connection panel, open **Advanced** and set **Connection method** to **Manual code exchange** on both apps.

1. The host presses **Create invitation code**, copies the full code, and sends it to the guest.
2. The guest pastes the invitation, presses **Create reply code**, and sends the reply back.
3. The host pastes the reply and presses **Connect to friend**.

These longer `KAMISADO1` codes remain compatible with earlier versions for direct connections. They expire after ten minutes and still use public STUN for address discovery. Manual exchange avoids the signaling service; it does not bypass a router or carrier that blocks direct P2P.

### Relay fallback

If direct P2P is blocked, a TURN service can forward the encrypted moves. The match still runs on the host's device. No relay service or provider account is bundled with Kamisado.

Only the host needs to configure TURN for new Quick connect invitations. The private `kamisado://join/K3.?` link includes session relay access. The guest opens it and joins automatically, without copying a server address, username, or password. Both apps must be updated to read these links. Older `K2.` and `K2R.` invitations remain supported, but do not carry credentials.

There are two ways to set up the host:

- **Import existing credentials:** create the game, open **TURN relay settings ? Import provider settings**, paste your provider's ICE servers JSON, and press **Import TURN settings**. Then share the invitation. This works with any compatible TURN provider. The imported credential keeps its existing provider expiry; Kamisado cannot shorten its lifetime simply by putting it in a link.
- **Generate temporary credentials:** in the desktop or mobile app's game settings, open **Automatic TURN credentials**. Enable generation, enter your Metered/OpenRelay account domain (for example, `your-app.metered.live`) and account secret key from **Developers** in the provider dashboard. Choose the relay lifetime, then press **Create game**. The app requests fresh credentials for that game before opening the lobby. This setup stays on the host screen for subsequent games; it is not saved across page navigation or app restarts.

The account secret is used only by the host's native app to call the provider. It is never included in invitations. Do not put an account secret in the manual relay password field. Ordinary browser pages support importing session credentials but cannot generate them through the native provider integration.

**How to connect** appears above the invitation buttons:

| Choice | What happens | Invitation |
| --- | --- | --- |
| P2P first, TURN if needed | Tries direct P2P for about 12 seconds, then TURN if configured | Automatic fallback keeps the same link. |
| TURN only (skip P2P), chosen by the host | Both apps skip the direct attempt | The new link selects TURN only and configures the guest automatically. |
| TURN only (skip P2P), chosen by the guest | Joins the host's relay route immediately | Works with the same P2P-first invitation if the host included relay access. |

Change the host's mode or relay settings before sharing. Changing them invalidates its previous invitation, so share the new one. Invitation setup lasts ten minutes; this is separate from the provider credential's lifetime.

#### Choosing a credential lifetime

The automatic estimate uses the selected match length and clocks:

- With a clock: both players' time budgets, plus one minute per possible round for breaks. The game's clocks cover the whole match.
- Without a clock: thirty minutes per possible round. A match played to `N` points can take up to `2N ? 1` scoring rounds; repeated draws and long pauses can extend it.
- Add a 50% margin and fifteen minutes for setup, then round up to whole hours, with a one-hour minimum.

For example, a standard three-point untimed match gets four hours; an untimed fifteen-point match gets twenty-two hours. These are estimates, not measured completion times. Use the lifetime selector to choose up to forty-eight hours for a slower game.

Metered enforces the expiry and may disconnect an active relayed match when the time runs out. The app shows the expiry on both devices; it does not silently extend access. New credentials may take up to two minutes to become usable. If a guest opens the link during that period, the app shows a countdown and joins automatically afterward. This conservative wait also applies to a P2P-first invitation containing freshly generated credentials. See Metered's [credential creation API](https://www.metered.ca/docs/turn-rest-api/post-create-credential/) and [expiry guide](https://www.metered.ca/docs/turnserver-guides/expiring-turn-credentials/).

#### Keeping invitations private

The guest's screen does not show shared passwords, but the link grants relay access and its contents can be extracted. Anyone with it may use the credential owner's allowance until the provider expires or revokes the credential. The link is encoded, not encrypted. Share it only with your opponent. Neither relay credentials nor the account secret are saved in browser storage. Native bridge payload logging is disabled to avoid logging secrets or invitations.

Game data is encrypted between the apps; TURN forwards it and can see addresses and traffic volume. The invitation secret and relay password are not sent to the public signaling service. See [WebRTC TURN](https://webrtc.org/getting-started/turn-server) and [data-channel encryption](https://www.rfc-editor.org/rfc/rfc8831).

**Manual code exchange** still needs credentials on both devices and fresh codes for a relay retry. Automatic credential sharing applies to Quick connect links.

### Cloudflare usage and costs

Cloudflare's published allowance, checked on 4 October 2026, is **1,000 GB per month shared by Realtime TURN and SFU**, followed by **$0.05 per GB of egress**. The account that issues the TURN credentials pays for their use, even when another player uses them. The free allowance is not a separate allowance for each player or TURN key. See [Realtime pricing](https://developers.cloudflare.com/realtime/sfu/platform/pricing/).

To check your account:

1. Open the Cloudflare dashboard and select **Manage Account > Billing > Billable Usage**.
2. Select the current billing period and find Realtime. Compare **Total usage**, **Billable usage**, and **Usage cost**. Use the account's billing dates; do not assume the period starts on the first day of the month.
3. Select **Create budget alert** to receive an email when account-wide spending crosses your chosen dollar threshold. This warns about spending already incurred; it does not stop traffic or guarantee free use.

Cloudflare documents the [billing dashboard](https://developers.cloudflare.com/billing/manage/billable-usage/) and states explicitly that [budget alerts do not pause or cap usage](https://developers.cloudflare.com/billing/manage/budget-alerts/). The published documentation does not establish a provider-enforced free-only cutoff for Realtime TURN. Do not treat the free allowance as a spending cap.

For earlier warnings, the [TURN analytics API](https://developers.cloudflare.com/realtime/turn/analytics/) exposes `egressBytes`, with usage normally appearing after about 30 seconds according to the [TURN FAQ](https://developers.cloudflare.com/realtime/turn/faq/). It requires an API token with **Account Analytics** permission. Count all TURN keys and any SFU use sharing the allowance. For example, a monitor could warn at 500 GB and stop issuing new credentials at 800 GB, leaving headroom. Those are suggested thresholds, not Cloudflare limits. Analytics can be delayed and [adaptively sampled](https://developers.cloudflare.com/realtime/turn/replacing-existing/); the billing figures remain the reference for charges.

Stopping new credentials does not stop credentials already issued. Use short-lived credentials and [revoke them](https://developers.cloudflare.com/realtime/turn/generate-credentials/#revoke-credentials) when necessary. Monitoring and revocation reduce exposure, but are not a guaranteed zero-cost cap.

Kamisado currently shows whether a connection is direct or relayed. It does **not** read your Cloudflare account usage, send budget warnings, or enforce a spending limit. Session credentials do not grant access to billing information. A local game-data counter would also miss other devices and protocol overhead, so it could not reliably show your remaining allowance. Keep account and credential-generation API tokens outside the game.

If an absolute zero-charge guarantee is required, use a service with an explicit provider-enforced cutoff or prepaid limit. Cloudflare's documented budget alerts alone do not meet that requirement.

### Through the optional ngrok relay

This is an alternative for someone who wants to host with an ngrok account and let their friend join in a browser.

1. Expand **Other Internet connection options** and choose **Connect with ngrok**.
2. Follow the link to your ngrok account, copy its authtoken, and paste it into the app.
3. Choose whether to remember the token, then press **Connect and continue**.
4. Create a game and share its invitation link.

This mode sends traffic through ngrok's service. The guest needs neither the app nor an ngrok account. Saved credentials can be removed with **Forget** in the connection settings.

The ngrok option tunnels the desktop game's HTTP/WebSocket server; it does not configure TURN. Use an ngrok authtoken in the ngrok connection settings, not in the TURN fields. A [TCP tunnel](https://ngrok.com/docs/gateway/endpoints/tcp) could expose a TURN server's TCP listener, but that alone would not make its UDP relay ports reachable: [TURN over TCP still uses UDP on the peer side](https://www.rfc-editor.org/rfc/rfc8656.html). For this game, the existing HTTPS invitation is the simpler ngrok route.

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
