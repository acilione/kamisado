/** Accept only game invitations before opening an external browser or navigating. */
export function normalizeGameInvitation(value: unknown): string {
    const invalid = 'Paste the full invitation link from your friend’s game.';
    if (typeof value !== 'string' || value.length > 2048) throw new Error(invalid);
    const text = value.trim();
    if (!/^https?:\/\//i.test(text) || /[\\\u0000-\u0020\u007f]/.test(text)) throw new Error(invalid);
    let url: URL;
    try { url = new URL(text); }
    catch { throw new Error(invalid); }
    const match = url.pathname.match(/^\/game\/([a-f0-9]{12})\/?$/i);
    if (!match || !url.hostname || url.username || url.password || url.search || url.hash) throw new Error(invalid);
    url.pathname = `/game/${match[1].toLowerCase()}`;
    return url.href;
}
