/** Validate session TURN credentials from settings, provider responses, or private invitations. */
export function parseRelaySettings(addresses: string, username: string, password: string): RTCIceServer {
    const urls = addresses.trim().split(/\s+/).filter(Boolean);
    if (!urls.length || urls.length > 4 || addresses.length > 2048) {
        throw new Error('Enter one to four TURN addresses supplied by your relay provider.');
    }
    for (const url of urls) {
        const match = /^(turns?):(\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)(?::([0-9]+))?(?:\?transport=(udp|tcp))?$/.exec(url);
        if (!match || (match[3] && (+match[3] < 1 || +match[3] > 65535)) ||
            (match[1] === 'turns' && match[4] === 'udp')) {
            throw new Error('Use a TURN address such as turns:relay.example.com:443?transport=tcp.');
        }
        try { new URL(`https://${match[2]}${match[3] ? ':' + match[3] : ''}`); }
        catch { throw new Error('The relay address has an invalid host or port.'); }
    }
    if (!username.trim() || username.length > 512 || !password.trim() || password.length > 2048) {
        throw new Error('Enter the relay username and password supplied by your provider.');
    }
    return { urls, username: username.trim(), credential: password };
}

/** Import data only: provider snippets are never evaluated as JavaScript. */
export function parseRelayImport(text: string): RTCIceServer {
    if (text.length > 65536) throw new Error('TURN settings are too large. Paste only the ICE servers JSON.');
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { throw new Error('Paste valid ICE servers JSON, using double quotes. JavaScript snippets are not supported.'); }
    const entries = Array.isArray(parsed) ? parsed : (parsed as { iceServers?: unknown } | null)?.iceServers;
    if (!Array.isArray(entries) || entries.length > 32) throw new Error('Paste an ICE servers array or an object containing iceServers.');
    let username: string | undefined;
    let credential: string | undefined;
    const urls: string[] = [];
    for (const entry of entries) {
        if (!entry || typeof entry !== 'object') throw new Error('Each ICE server must be an object.');
        const addresses = typeof entry.urls === 'string' ? [entry.urls] : entry.urls;
        if (!Array.isArray(addresses) || !addresses.every(url => typeof url === 'string')) {
            throw new Error('Each ICE server must have a URL or list of URLs.');
        }
        const turn = addresses.filter(url => !url.startsWith('stun:') && !url.startsWith('stuns:'));
        if (!turn.length) continue;
        if (typeof entry.username !== 'string' || typeof entry.credential !== 'string' ||
            (entry.credentialType !== undefined && entry.credentialType !== 'password')) {
            throw new Error('TURN entries need a username and password credential.');
        }
        if (username !== undefined && (username !== entry.username || credential !== entry.credential)) {
            throw new Error('Import one credential at a time. These TURN entries use different usernames or passwords.');
        }
        username = entry.username;
        credential = entry.credential;
        for (const url of turn) {
            parseRelaySettings(url, username!, credential!);
            if (!urls.includes(url)) urls.push(url);
        }
    }
    // Providers may return many alternate ports. Retain up to four, preferring TLS.
    urls.sort((a, b) => Number(b.startsWith('turns:')) - Number(a.startsWith('turns:')));
    return parseRelaySettings(urls.slice(0, 4).join('\n'), username ?? '', credential ?? '');
}
