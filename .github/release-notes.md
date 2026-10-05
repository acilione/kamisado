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
- **Internet P2P:** choose the settings, create a game, and press **Share link**. Your friend opens the app link to join automatically. Both players need an updated app.

PeerJS Cloud exchanges setup messages automatically; no account or self-hosted service is needed for direct play. Gameplay stays on the host's device, with direct WebRTC first. Configure temporary TURN credentials on both devices before connecting to enable automatic relay fallback with the same invitation. No TURN service is bundled. Manual code exchange remains available under **Advanced** and needs fresh codes for a relay retry. The optional ngrok mode is separate.

Keep the host app open during play. Closing it or ending the session loses unfinished games.

## Instructions

`START-HERE-*.txt` covers opening the app and connection setup. A copy is also included beside the executable in Windows and Linux ZIPs. The [player guide](https://github.com/acilione/kamisado/blob/main/docs/player-guide.md) has the full platform instructions and troubleshooting steps.

These builds are unsigned, so the operating system may show a publisher warning. Use a download from a source you trust. `SHA256SUMS-*` files let you check download integrity; they do not verify the publisher's identity.
