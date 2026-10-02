Download Kamisado, create a game, and share the invitation. Only the host needs the app; the other player joins in a browser.

- **Windows:** run the `Setup.exe` installer, or extract the Windows ZIP completely and open `Kamisado.exe`.
- **Linux (x64):** install the DEB on Debian/Ubuntu or the RPM on Fedora-compatible systems.
- **Same Wi-Fi:** no account or Internet connection is required. Allow access on your private network if the firewall prompts, create a game, and share the link or QR code.
- **Internet:** choose the online option and enter your own ngrok authtoken on first use.

Keep the host app open throughout the match. Closing it or stopping hosting ends the active games. Saved preferences and ngrok credentials use your OS profile, even with the portable Windows ZIP.

These builds are currently unsigned. Windows may show an unknown-publisher warning. Only install downloads you trust. Compare a downloaded file with its entry in the included `SHA256SUMS-*` file to check download integrity; checksums do not replace publisher signing.

Maintainer checklist before publishing this draft:

- Install and launch on a clean Windows machine without Node.js.
- Install the Linux DEB/RPM on the intended distribution.
- Join from a second device on the same network and finish a round.
- Check Stop and restart, online hosting with a real ngrok account, and the three board views.
- Add release-specific changes and known limitations to these notes.
