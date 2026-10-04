/** App links contain only an invitation, never a server address or executable action. */
export function normalizePeerInvitation(value: unknown): string {
    if (typeof value !== 'string' || value.length > 128) throw new Error('Open or paste a complete Kamisado invitation link.');
    const input = value.trim();
    const code = input.startsWith('kamisado://join/') ? input.slice('kamisado://join/'.length) : input;
    // Sixteen random bytes have a canonical, 22-character base64url representation.
    if (!/^K2R?\.[A-Za-z0-9_-]{21}[AQgw]$/.test(code)) throw new Error('Open or paste a complete Kamisado invitation link.');
    return code;
}

export function peerInvitationLink(value: unknown): string {
    return 'kamisado://join/' + normalizePeerInvitation(value);
}
