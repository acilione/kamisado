## Downloads

Choose one application download for your computer:

| Platform | Download and open |
| --- | --- |
| Windows, Intel/AMD 64-bit | Run `Setup.exe`, or extract the `win32-x64` ZIP and open `Kamisado.exe`. |
| Debian / Ubuntu, 64-bit | Install the `.deb` package and launch Kamisado from the applications menu. |
| Fedora-compatible Linux, 64-bit | Install the `.rpm` package and launch Kamisado from the applications menu. |
| Portable Linux, Intel/AMD 64-bit | Extract the `linux-x64` ZIP and open `Kamisado` inside it. System libraries may still be required. |

Mac builds are not included in the automated releases yet. Mac users can join a LAN game through a browser; standalone builds are covered in the [developer guide](https://github.com/acilione/kamisado/blob/main/docs/development.md#macos).

The app includes its runtime. You do not need Node.js or development tools. Keep all files in a portable ZIP together after extracting it. `RELEASES` and `.nupkg` are Windows installer support files; GitHub's **Source code** archives are for developers.

## Playing

- **Computer:** choose **Play computer**, set a difficulty from 1–10, and start a game. Works offline.
- **LAN:** choose **Host a LAN game**, create a game, and share the link or QR code. Your friend joins in a browser on the same network.
- **Internet P2P:** both players run the app. Choose **Host Internet game** and **Join Internet game**, then exchange the invitation and reply codes.

P2P moves travel directly between the players. Public STUN helps discover connection addresses; there is no central Kamisado game or signaling server. Some networks block direct connections, and this mode has no TURN relay. The optional ngrok relay is a separate connection mode.

Keep the host app open during play. Closing it or ending the session loses unfinished games.

## Instructions

`START-HERE-*.txt` covers installation and connection setup. A copy is also included beside the executable in Windows and Linux ZIPs. The [player guide](https://github.com/acilione/kamisado/blob/main/docs/player-guide.md) has the full platform instructions and troubleshooting steps.

These builds are unsigned, so the operating system may show a publisher warning. Use a download from a source you trust. `SHA256SUMS-*` files let you check download integrity; they do not verify the publisher's identity.
