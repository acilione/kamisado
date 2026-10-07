# Account-free game invitations

Reviewed 6 October 2026, starting from [awesome-tunneling](https://github.com/anderspitman/awesome-tunneling) and checking the providers' own documentation.

Kamisado now defaults to **tunnl.gg**, which documents WebSocket support and can reuse an address without an account. Cloudflare Quick Tunnel remains available. This choice does not establish that tunnl.gg has better uptime. No comparable, independently measured reliability results were found in the reviewed material.

The requirements are an HTTPS link, browser guests with no setup, no host account, no server operated by the app maintainer, and a connection that lasts through a match. Desktop uses Socket.IO; Android hosting uses HTTP long polling. Both need ordinary HTTP requests, reconnects, and a reachable address for the whole session.

## Candidates

| Service | Account-free flow | Limits relevant to Kamisado | Assessment |
| --- | --- | --- | --- |
| [Cloudflare Quick Tunnel](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/) | Temporary HTTPS URL without an account or domain. | No uptime guarantee; hostname changes when the connector restarts; 200 simultaneous requests; no SSE. | Already implemented on desktop and Android. Our game tests passed, but Android testing also encountered DNS delays and dropped tunnels. Keep it as the baseline, not a reliability promise. |
| [tunnl.gg](https://tunnl.gg/docs) | SSH tunnel; an app-generated SSH key can retain the same URL without registration. | 24-hour lifetime; two hours of inactivity; browser warning page; documented WebSocket limits. | Implemented on desktop and Android. A stable address helps recover after a brief disconnect, but does not preserve game state or establish uptime. Needs longer network-change and idle testing. |
| [localhost.run](https://localhost.run/docs/forever-free/) | SSH, no signup for free domains. | Free domains change regularly and are speed-limited. Longer-lived domains require signup. | Suitable for temporary sharing, but address rotation weakens the case for an uninterrupted match. |
| [Pinggy](https://pinggy.io/) | Account-free SSH tunnel. | Free tunnels end after 60 minutes; restarting changes the URL. Free browser links show a [screening page](https://pinggy.io/docs/http_tunnels/screening/). | Poor default for untimed and multi-round matches. Reconnecting cannot remove the free-tier time limit. |
| [Serveo](https://serveo.net/docs/) | Anonymous SSH without an account or key; supports port 443. | Free browser links have a warning page. An address may repeat, but depends on availability; reserved identities require registration. | Worth a compatibility trial, but the reviewed documentation does not establish better anonymous-service reliability. |
| [Tunnelmole](https://github.com/robbie-cahill/tunnelmole-client) | Account-free HTTP sharing, with a Node.js API. | The client README says random URLs expose the host IP and telemetry is enabled by default. Its internal WebSocket transport does not by itself prove support for a guest application's WebSockets. | Easy desktop integration is attractive, but guest transport compatibility and Android packaging need validation before adoption. |

Self-hostable tools in the list, such as frp, rathole, and boringproxy, solve the transport problem but still need a publicly reachable relay operated by someone. They do not meet the requirement to avoid running infrastructure simply because their source is available. VPN-based solutions also add guest setup instead of letting a guest open a browser link.

## Remaining reliability checks

Compare Cloudflare and tunnl.gg on the same devices and networks over repeated sessions. Check startup success and time to a usable browser link, moves and refreshes, an hour or more of idle play, several-hour matches, Wi-Fi/mobile network changes, and recovery after losing the connection. Record failures and whether the original invitation still works. A successful short demonstration is not an uptime benchmark.

For an SSH connector, create a dedicated application key rather than using the player's personal keys. Verify the relay's host key, supervise the connection, and close it when hosting ends. Android needs an embedded connector; assuming an installed command-line SSH client would break the download-and-play requirement. Keep the existing shared game engine and native HTTP bridge.

Fallback between providers can help **before an invitation is shared**. Switching providers during a match changes the hostname, and the guest cannot discover the new link automatically. That requires a stable rendezvous address or sending another invitation. None of these providers removes Android's foreground and battery restrictions.

## Implementation follow-up — 7 October 2026

tunnl.gg is now the default provider on desktop and Android. A shared Go SSH connector creates an app-specific identity, requests a stable URL, checks a pinned server key, and reconnects after brief interruptions. It is bundled with the app; players do not install SSH or enter credentials. Cloudflare remains available as an alternative.

Live checks passed on the Windows and Linux portable apps: a browser guest joined, both sides moved, and stopping hosting ended the tunnel. An Android phone also hosted a desktop browser guest, exchanged moves, and restored the guest after refresh. One Android attempt timed out before joining; a retry passed. These are short compatibility checks, not an uptime or battery benchmark. Network changes and long idle sessions still need testing.

All three HTTP tunnel providers operate relay servers and terminate HTTPS; they are not end-to-end P2P connections.
