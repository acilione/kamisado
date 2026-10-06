import { parseRelayImport } from './turn-settings.js';

export const MAX_PEER_INVITATION_LENGTH = 16384;
export interface InvitationRelay {
    server: RTCIceServer;
    /** Provider-enforced expiry, when known. Invitation expiry cannot revoke TURN. */
    expiresAt?: number;
    readyAt?: number;
}
const legacy = /^K2R?\.[A-Za-z0-9_-]{21}[AQgw]$/;
const invalid = 'Open or paste a complete Kamisado invitation link.';

function encode(value: string): string {
    return btoa(String.fromCharCode(...new TextEncoder().encode(value))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** K3 carries relay access, not an account secret. Treat the entire link as private. */
export function readPeerInvitation(value: unknown): { code: string; invitation: string; relay?: InvitationRelay } {
    if (typeof value !== 'string' || value.length > MAX_PEER_INVITATION_LENGTH) throw new Error(invalid);
    const input = value.trim();
    const code = input.startsWith('kamisado://join/') ? input.slice('kamisado://join/'.length) : input;
    if (legacy.test(code)) return { code, invitation: code };
    if (!/^K3\.[A-Za-z0-9_-]+$/.test(code)) throw new Error(invalid);
    try {
        const json = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(
            atob(code.slice(3).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));
        if (encode(json) !== code.slice(3)) throw new Error(invalid);
        const data = JSON.parse(json);
        if (!data || typeof data.invitation !== 'string' || !legacy.test(data.invitation) ||
            !data.relay || Object.keys(data).some(key => !['invitation', 'relay', 'expiresAt', 'readyAt'].includes(key))) throw new Error(invalid);
        const server = parseRelayImport(JSON.stringify([data.relay]));
        for (const key of ['expiresAt', 'readyAt']) {
            if (data[key] !== undefined && (!Number.isSafeInteger(data[key]) || data[key] <= 0)) throw new Error(invalid);
        }
        if (data.readyAt && (!data.expiresAt || data.readyAt >= data.expiresAt)) throw new Error(invalid);
        return { code, invitation: data.invitation, relay: { server, expiresAt: data.expiresAt, readyAt: data.readyAt } };
    } catch { throw new Error(invalid); }
}

export function normalizePeerInvitation(value: unknown): string { return readPeerInvitation(value).code; }

export function withInvitationRelay(invitation: string, relay: InvitationRelay): string {
    return normalizePeerInvitation('K3.' + encode(JSON.stringify({ invitation: readPeerInvitation(invitation).invitation,
        relay: parseRelayImport(JSON.stringify([relay.server])), expiresAt: relay.expiresAt, readyAt: relay.readyAt })));
}

export function peerInvitationLink(value: unknown): string {
    return 'kamisado://join/' + normalizePeerInvitation(value);
}
