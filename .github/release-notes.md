## Downloads

Choose one application download for your computer:

| Platform | Download and open |
| --- | --- |
| Windows, Intel/AMD 64-bit | Extract `Kamisado-<version>-Windows-x64-portable.zip` and open `Kamisado.exe`. |
| Linux, Intel/AMD 64-bit | Extract `Kamisado-<version>-Linux-x64-portable.zip` and open `Kamisado`. System libraries may still be required. |

Mac builds are not included in the automated releases yet. Mac users can join a LAN game through a browser; standalone builds are covered in the [developer guide](https://github.com/acilione/kamisado/blob/main/docs/development.md#macos).

The app includes its runtime and runs without installation. You do not need Node.js or development tools. Keep all files together after extracting the ZIP. On Windows, use a Windows folder such as Downloads and open the Windows executable directly, rather than running the Linux app through WSL. GitHub's **Source code** archives are for developers. Android test APKs are produced by the separate **Mobile apps** workflow.

## Playing

- **Computer:** choose the game settings and a difficulty from 1–10, then press **Play with computer**. Works offline.
- **LAN:** choose **Host a LAN game**, create a game, and share the link or QR code. Your friend joins in a browser on the same network.
- **Internet:** choose settings, press **Create game**, and share the HTTPS invitation. Cloudflare Quick Tunnel is the default and needs no account. Your friend joins in a browser.
- **ngrok:** select it under **Internet connection** on desktop. Only the host needs an account token; it is never included in invitations.

Android can host Cloudflare invitations with its bundled connector. ngrok hosting is desktop-only; iPhones can join in Safari. Cloudflare Quick Tunnels are a testing service with no uptime guarantee. The tunnel provider forwards traffic and terminates HTTPS. Legacy P2P app invitations remain supported separately.

Keep the host app open during play. Closing it or ending the session loses unfinished games.

## Instructions

`START-HERE-*.txt` covers opening the app and connection setup. A copy is also included beside the executable in Windows and Linux ZIPs. The [player guide](https://github.com/acilione/kamisado/blob/main/docs/player-guide.md) has the full platform instructions and troubleshooting steps.

These builds are unsigned, so the operating system may show a publisher warning. Use a download from a source you trust. `SHA256SUMS-*` files let you check download integrity; they do not verify the publisher's identity.
