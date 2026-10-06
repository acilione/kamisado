import { parseRelayImport } from './turn-settings.js';
import type { InvitationRelay } from './peer-invitation.js';

export interface TurnCredentialRequest { domain: string; secretKey: string; lifetimeSeconds: number }
export interface ProviderHttpRequest { url: string; method: 'GET' | 'POST'; data?: Record<string, unknown> }
export type ProviderHttp = (request: ProviderHttpRequest) => Promise<{ status: number; data: unknown }>;

function parseProviderBody(data: unknown): unknown {
    if (typeof data !== 'string') return data;
    if (data.length > 65536) return null;
    try { return JSON.parse(data); } catch { return data; }
}

/** Keep useful provider diagnostics without echoing credentials, URLs, or response objects. */
export function providerRejection(status: number, data: unknown, operation: 'create' | 'retrieve', secrets: string[]): string {
    const body = parseProviderBody(data);
    const candidate = typeof body === 'string' ? body : (body as { message?: unknown; error?: unknown } | null)?.message
        ?? (body as { error?: unknown } | null)?.error;
    let detail = typeof candidate === 'string' && candidate.length <= 4096 && !candidate.includes('<') ? candidate : '';
    for (const secret of secrets.filter(Boolean)) {
        for (const representation of new Set([secret, encodeURIComponent(secret)])) detail = detail.split(representation).join('[redacted]');
    }
    detail = detail.replace(/https?:\/\/\S+/gi, '[URL omitted]')
        .replace(/((?:secret[_-]?key|api[_-]?key|password|credential|token)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[redacted]')
        .replace(/[A-Za-z0-9_+\/=-]{24,}/g, '[redacted]')
        .replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
    let guidance = '';
    if (/not subscribed|no (?:active )?turn.*plan/i.test(detail)) {
        guidance = ' Check that a TURN plan is active for this account in the provider dashboard. Creating an account alone may not activate TURN.';
    } else if (/maximum.*credential|credential.*limit/i.test(detail)) {
        guidance = ' Review existing credentials in the provider dashboard; the app will not delete them or change your plan.';
    } else if (/expiry|expiration|lifetime/i.test(detail)) {
        guidance = ' The provider rejected the requested lifetime. Try selecting 1 hour; the app will not silently remove the expiry.';
    } else if (operation === 'retrieve') {
        guidance = ' Credential creation succeeded, but retrieving its ICE settings failed. Check the new credential in the dashboard before trying again.';
    }
    return `TURN provider could not ${operation === 'create' ? 'create temporary credentials' : 'retrieve relay settings'} (HTTP ${status}).`
        + (detail ? ` Provider message: ${detail}` : ' The provider returned no readable error message.') + guidance;
}

/** Clocks run across the whole match. Untimed rounds have no finite upper bound. */
export function estimateRelayLifetime(matchType: string, timer: string): number {
    const target = [1, 3, 7, 15].includes(Number(matchType)) ? Number(matchType) : 3;
    const seconds = [0, 60, 180, 300, 600, 1800].includes(Number(timer)) ? Number(timer) : 0;
    const rounds = 2 * target - 1;
    const playing = seconds ? 2 * seconds + rounds * 60 : rounds * 30 * 60;
    // 50% margin plus 15 minutes to share/join; round up to whole hours.
    return Math.max(3600, Math.ceil((playing * 1.5 + 900) / 3600) * 3600);
}

export function validateTurnRequest(value: unknown): TurnCredentialRequest {
    const request = value as TurnCredentialRequest | null;
    if (!request || typeof request.domain !== 'string' || typeof request.secretKey !== 'string') throw new Error('Enter your Metered domain and account secret key.');
    const domain = request.domain.trim().replace(/^https:\/\//, '').replace(/\/$/, '').toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.metered\.live$/.test(domain)) throw new Error('Enter your account domain, such as your-app.metered.live.');
    if (!request.secretKey.trim() || request.secretKey.length > 2048) throw new Error('Enter the account secret key from the provider dashboard.');
    if (!Number.isInteger(request.lifetimeSeconds) || request.lifetimeSeconds < 3600 || request.lifetimeSeconds > 172800) throw new Error('Choose a relay lifetime between 1 and 48 hours.');
    return { domain, secretKey: request.secretKey.trim(), lifetimeSeconds: request.lifetimeSeconds };
}

/** The caller is the host's native app; never expose this operation on the game server. */
export async function createMeteredCredential(value: unknown, http: ProviderHttp): Promise<InvitationRelay> {
    const request = validateTurnRequest(value);
    const started = Date.now();
    const call = async (method: 'GET' | 'POST', path: string, key: string, data?: Record<string, unknown>): Promise<any> => {
        let response;
        try { response = await http({ method, url: `https://${request.domain}/api/v1/turn/${path}${encodeURIComponent(key)}`, data }); }
        catch { throw new Error('Could not reach the TURN provider. Check your network and retry.'); }
        if (response.status < 200 || response.status >= 300) throw new Error(providerRejection(
            response.status, response.data, method === 'POST' ? 'create' : 'retrieve', [request.secretKey, key]));
        return parseProviderBody(response.data);
    };
    const created = await call('POST', 'credential?secretKey=', request.secretKey,
        { expiryInSeconds: request.lifetimeSeconds, label: 'Kamisado match' });
    if (!created || typeof created.apiKey !== 'string' || created.apiKey.length > 2048 || !created.apiKey ||
        created.expiryInSeconds !== request.lifetimeSeconds) throw new Error('The provider did not confirm the requested credential expiry.');
    const servers = await call('GET', 'credentials?apiKey=', created.apiKey);
    let server: RTCIceServer;
    try { server = parseRelayImport(JSON.stringify(servers)); }
    catch { throw new Error('The provider returned invalid TURN settings.'); }
    return { server, expiresAt: started + request.lifetimeSeconds * 1000, readyAt: Date.now() + 120000 };
}
