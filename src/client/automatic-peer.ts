import type { DataConnection, Peer, PeerOptions } from 'peerjs' with { 'resolution-mode': 'import' };
import { normalizePeerInvitation } from '../shared/peer-invitation.js';

const MAX_FRAME_BYTES = 65536;
const MAX_QUEUED_FRAMES = 32;
const encoder = new TextEncoder();
type Role = 'host' | 'guest';

/** The game transport uses the same small channel surface for manual and automatic setup. */
export interface PeerDataChannel {
    onopen: (() => void) | null;
    onclose: (() => void) | null;
    onerror: (() => void) | null;
    onmessage: ((event: { data: unknown }) => void) | null;
    readonly readyState: RTCDataChannelState;
    readonly bufferedAmount: number;
    send(data: string): void;
    close(): void;
}

export interface AutomaticPeerOptions {
    onConnection(peer: RTCPeerConnection, channel: PeerDataChannel): void;
    onStatus(message: string): void;
    onError(error: Error): void;
    /** Enables an explicit relay retry without allowing a failed caller to close the host lobby. */
    onAttemptFailed?(error: Error): void;
    /** Tests can use a local PeerServer without changing the production signaling service. */
    Peer?: typeof Peer;
    server?: Pick<PeerOptions, 'host' | 'port' | 'path' | 'secure' | 'key'>;
    iceServers?: RTCIceServer[];
    registrationTimeoutMs?: number;
    connectionTimeoutMs?: number;
    handshakeTimeoutMs?: number;
}

function base64url(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decode(value: string, length: number): Uint8Array<ArrayBuffer> {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Paste the complete Kamisado invitation.');
    const bytes = Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
    if (bytes.length !== length || base64url(bytes) !== value) throw new Error('Paste the complete Kamisado invitation.');
    return bytes;
}

export function generateAutomaticInvitation(relay = false): string {
    return `${relay ? 'K2R' : 'K2'}.${base64url(crypto.getRandomValues(new Uint8Array(16)))}`;
}

export function parseAutomaticInvitation(value: string): { secret: Uint8Array<ArrayBuffer>; relay: boolean } {
    if (typeof value !== 'string' || value.length > 128) throw new Error('Paste the complete Kamisado invitation.');
    const match = /^(K2R?)\.([A-Za-z0-9_-]{22})$/.exec(normalizePeerInvitation(value));
    if (!match) throw new Error('Paste the complete Kamisado invitation.');
    return { secret: decode(match[2], 16), relay: match[1] === 'K2R' };
}

/** Only a hash is published to the broker. The invitation secret stays on the two devices. */
export async function automaticPeerId(invitation: string): Promise<string> {
    const { secret } = parseAutomaticInvitation(invitation);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', secret));
    return 'kamisado-v2-' + Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

function timeout(value: number | undefined, maximum: number): number {
    return Math.min(maximum, Math.max(50, value ?? maximum));
}

function fingerprint(description: RTCSessionDescription | null): string {
    const fingerprints = new Set(Array.from((description?.sdp ?? '').matchAll(
        /^a=fingerprint:sha-256 ([a-f0-9]{2}(?::[a-f0-9]{2}){31})\r?$/gim,
    ), match => match[1].toUpperCase()));
    if (fingerprints.size !== 1) throw new Error('The peer connection could not be authenticated.');
    return [...fingerprints][0];
}

function proofInput(role: Role, nonce: string, local: string, remote: string): Uint8Array<ArrayBuffer> {
    return encoder.encode(JSON.stringify(['kamisado-auth', 1, role, nonce, local, remote]));
}

/** Uses PeerJS events, leaving its native RTCDataChannel handlers intact. */
class AuthenticatedChannel implements PeerDataChannel {
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    private closed = false;
    private sentProof = false;
    private receivedProof = false;
    private verified = false;
    private sentReady = false;
    private receivedReady = false;
    private opened = false;
    private attached = false;
    private queue: string[] = [];
    private queuedBytes = 0;
    private timer: ReturnType<typeof setTimeout>;
    authenticated = false;

    constructor(
        readonly connection: DataConnection,
        private readonly role: Role,
        private readonly key: CryptoKey,
        options: AutomaticPeerOptions,
        private readonly ready: (channel: AuthenticatedChannel) => void,
        private readonly failed: (channel: AuthenticatedChannel, error: Error) => void,
    ) {
        this.timer = setTimeout(() => this.fail(new Error('A direct connection could not be established. Try the relay fallback or a shared network.')),
            timeout(options.connectionTimeoutMs, 30000));
        const opened = () => {
            if (this.closed || this.opened) return;
            this.opened = true;
            clearTimeout(this.timer);
            this.timer = setTimeout(() => this.fail(new Error('Your friend did not finish authenticating the connection. Try a new invitation.')),
                timeout(options.handshakeTimeoutMs, 10000));
            void this.authenticate().catch(error => this.fail(error));
        };
        connection.on('open', opened);
        connection.on('data', data => { void this.receive(data).catch(error => this.fail(error)); });
        connection.on('error', () => this.fail(new Error('The peer connection failed. Try a new invitation.')));
        connection.on('close', () => {
            if (this.closed) return;
            if (!this.authenticated) this.fail(new Error('Your friend disconnected before the connection was ready.'));
            else this.close();
        });
        if (connection.open) queueMicrotask(opened);
    }

    get readyState(): RTCDataChannelState { return this.closed ? 'closed' : this.authenticated ? 'open' : 'connecting'; }
    get bufferedAmount(): number { return this.connection.dataChannel?.bufferedAmount ?? 0; }

    send(data: string): void {
        if (this.readyState !== 'open') throw new Error('The peer connection is not ready.');
        this.connection.send(data);
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        clearTimeout(this.timer);
        this.queue = [];
        this.queuedBytes = 0;
        this.connection.close();
        this.onclose?.();
    }

    private fail(error: unknown): void {
        if (this.closed) return;
        const failure = error instanceof Error ? error : new Error('The peer connection could not be authenticated.');
        const authenticated = this.authenticated;
        if (authenticated) this.onerror?.();
        this.close();
        if (!authenticated) this.failed(this, failure);
    }

    private async authenticate(): Promise<void> {
        const peer = this.connection.peerConnection;
        const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
        const signature = await crypto.subtle.sign('HMAC', this.key, proofInput(
            this.role, nonce, fingerprint(peer.localDescription), fingerprint(peer.remoteDescription),
        ));
        if (this.closed) return;
        this.connection.send(JSON.stringify({ kind: 'kamisado-auth', v: 1, role: this.role, nonce, proof: base64url(new Uint8Array(signature)) }));
        this.sentProof = true;
        this.finishAuthentication();
    }

    private async receive(data: unknown): Promise<void> {
        if (this.closed) return;
        if (typeof data !== 'string' || encoder.encode(data).byteLength > MAX_FRAME_BYTES) {
            throw new Error('The peer sent an invalid message.');
        }
        if (this.attached) { this.onmessage?.({ data }); return; }
        let frame: any;
        try { frame = JSON.parse(data); } catch { throw new Error('The peer sent an invalid message.'); }
        if (frame?.kind === 'kamisado-auth-ready') {
            if (frame.v !== 1 || this.receivedReady) throw new Error('The peer connection could not be authenticated.');
            this.receivedReady = true;
            this.finishAuthentication();
            return;
        }
        if (frame?.kind !== 'kamisado-auth') {
            // A verified peer can start sending while our asynchronous verification is finishing.
            this.queue.push(data);
            this.queuedBytes += encoder.encode(data).byteLength;
            if (this.queue.length > MAX_QUEUED_FRAMES || this.queuedBytes > MAX_FRAME_BYTES) {
                throw new Error('The peer sent too many messages before authentication.');
            }
            return;
        }
        const expectedRole = this.role === 'host' ? 'guest' : 'host';
        if (this.receivedProof || frame.v !== 1 || frame.role !== expectedRole ||
            typeof frame.nonce !== 'string' || frame.nonce.length !== 22 ||
            typeof frame.proof !== 'string' || frame.proof.length !== 43) {
            throw new Error('The peer connection could not be authenticated.');
        }
        this.receivedProof = true;
        decode(frame.nonce, 16);
        const peer = this.connection.peerConnection;
        this.verified = await crypto.subtle.verify('HMAC', this.key, decode(frame.proof, 32), proofInput(
            expectedRole, frame.nonce, fingerprint(peer.remoteDescription), fingerprint(peer.localDescription),
        ));
        if (this.closed) return;
        if (!this.verified) throw new Error('The invitation does not match this peer connection. Ask your friend for a new invitation.');
        this.finishAuthentication();
    }

    private finishAuthentication(): void {
        if (this.closed || this.authenticated || !this.sentProof || !this.verified) return;
        if (!this.sentReady) {
            this.connection.send(JSON.stringify({ kind: 'kamisado-auth-ready', v: 1 }));
            this.sentReady = true;
        }
        if (!this.receivedReady) return;
        this.authenticated = true;
        clearTimeout(this.timer);
        this.ready(this);
        // Let the game transport install its handlers before delivering open or queued game frames.
        queueMicrotask(() => {
            if (this.closed) return;
            this.attached = true;
            this.onopen?.();
            const queued = this.queue;
            this.queue = [];
            this.queuedBytes = 0;
            for (const data of queued) {
                if (this.closed) break;
                this.onmessage?.({ data });
            }
        });
    }
}

/** PeerJS Cloud exchanges connection details; authenticated game traffic stays on WebRTC. */
export class AutomaticPeer {
    private generation = 0;
    private peer: Peer | null = null;
    private candidates = new Set<AuthenticatedChannel>();
    private active: AuthenticatedChannel | null = null;
    private rejectRegistration: ((error: Error) => void) | null = null;
    private finishJoin: (() => void) | null = null;
    private rejectJoin: ((error: Error) => void) | null = null;
    private registrationTimer: ReturnType<typeof setTimeout> | null = null;
    private invitationTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(readonly role: Role, private readonly options: AutomaticPeerOptions) {}

    async createInvite(relay?: RTCIceServer): Promise<string> {
        if (this.role !== 'host') throw new Error('Only the host can create an invitation.');
        this.close();
        const generation = this.generation;
        const invitation = generateAutomaticInvitation(!!relay);
        try {
            await this.register(invitation, relay, generation);
            this.options.onStatus('Send this invitation to your friend. Keep this window open while they join.');
            this.invitationTimer = setTimeout(() => this.fail(new Error('This invitation expired. Create a new invitation.'), generation), 600000);
            return invitation;
        } catch (error) {
            this.fail(error, generation);
            throw error;
        }
    }

    async join(invitation: string, relay?: RTCIceServer): Promise<void> {
        if (this.role !== 'guest') throw new Error('Only the joining player can use an invitation.');
        const parsed = parseAutomaticInvitation(invitation);
        if (parsed.relay !== !!relay) throw new Error(parsed.relay
            ? 'Your friend is using the relay fallback. Enter your relay credentials before joining.'
            : 'This invitation uses a direct connection. Leave relay fallback disabled.');
        this.close();
        const generation = this.generation;
        try {
            const key = await this.register(invitation, relay, generation);
            const destination = await automaticPeerId(invitation);
            this.ensureCurrent(generation);
            await new Promise<void>((resolve, reject) => {
                this.finishJoin = resolve;
                this.rejectJoin = reject;
                // The pinned PeerJS version names its unencoded serializer "raw".
                const connection = this.peer!.connect(destination, { label: 'kamisado-v2', serialization: 'raw', reliable: true });
                this.watch(connection, key, generation);
                this.options.onStatus('Connecting to your friend…');
            });
        } catch (error) {
            this.fail(error, generation);
            throw error;
        }
    }

    close(): void {
        this.generation++;
        if (this.registrationTimer) clearTimeout(this.registrationTimer);
        if (this.invitationTimer) clearTimeout(this.invitationTimer);
        this.registrationTimer = this.invitationTimer = null;
        this.rejectRegistration?.(new Error('Connection setup was cancelled.'));
        this.rejectJoin?.(new Error('Connection setup was cancelled.'));
        this.rejectRegistration = this.rejectJoin = this.finishJoin = null;
        for (const channel of this.candidates) channel.close();
        this.candidates.clear();
        this.active?.close();
        this.active = null;
        const peer = this.peer;
        this.peer = null;
        peer?.destroy();
    }

    private ensureCurrent(generation: number): void {
        if (generation !== this.generation) throw new Error('Connection setup was cancelled.');
    }

    private async register(invitation: string, relay: RTCIceServer | undefined, generation: number): Promise<CryptoKey> {
        this.options.onStatus('Opening an invitation through PeerJS Cloud…');
        const { secret } = parseAutomaticInvitation(invitation);
        const [Constructor, key, id] = await Promise.all([
            this.options.Peer ?? import('peerjs').then(module => module.Peer),
            crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']),
            this.role === 'host' ? automaticPeerId(invitation) : Promise.resolve(undefined),
        ]);
        this.ensureCurrent(generation);
        const config: PeerOptions = {
            secure: true,
            ...this.options.server,
            debug: 0,
            config: {
                // Override PeerJS defaults, which otherwise include public TURN servers.
                iceServers: relay ? [relay] : this.options.iceServers ?? [{ urls: 'stun:stun.l.google.com:19302' }],
                iceTransportPolicy: relay ? 'relay' : 'all',
                bundlePolicy: 'max-bundle',
            },
        };
        const peer = this.peer = id ? new Constructor(id, config) : new Constructor(config);
        const registered = new Promise<void>((resolve, reject) => {
            this.rejectRegistration = reject;
            this.registrationTimer = setTimeout(() => this.fail(new Error('The invitation service is unavailable. Try again or use manual connection codes.'), generation),
                timeout(this.options.registrationTimeoutMs, 20000));
            peer.on('open', () => {
                if (generation !== this.generation) return;
                if (this.registrationTimer) clearTimeout(this.registrationTimer);
                this.registrationTimer = null;
                this.rejectRegistration = null;
                resolve();
            });
        });
        peer.on('connection', connection => {
            if (generation !== this.generation || this.role !== 'host' || this.active || this.candidates.size >= 2 ||
                connection.label !== 'kamisado-v2' || connection.serialization !== 'raw') {
                connection.close();
                return;
            }
            this.watch(connection, key, generation);
        });
        peer.on('call', call => call.close());
        peer.on('error', error => {
            if (this.active) return;
            if (this.role === 'host' && (error.type === 'webrtc' || error.type === 'peer-unavailable')) {
                // PeerJS also reports an individual caller's negotiation errors on the broker.
                // Keep the registered invitation available for the intended friend.
                this.options.onStatus('Still waiting for your friend. An unsuccessful connection attempt was closed.');
                this.options.onAttemptFailed?.(new Error('A connection attempt failed. You can try the relay fallback.'));
                return;
            }
            const message = error.type === 'peer-unavailable'
                ? 'This invitation is no longer available. Ask your friend to create a new one.'
                : 'The invitation service could not connect. Try again or use manual connection codes.';
            this.fail(new Error(message), generation);
        });
        peer.on('disconnected', () => {
            if (!this.active) this.fail(new Error('The invitation service disconnected. Create a new invitation or use manual connection codes.'), generation);
        });
        await registered;
        this.ensureCurrent(generation);
        return key;
    }

    private watch(connection: DataConnection, key: CryptoKey, generation: number): void {
        const channel = new AuthenticatedChannel(connection, this.role, key, this.options, ready => {
            if (generation !== this.generation || this.active) { ready.close(); return; }
            this.active = ready;
            this.candidates.delete(ready);
            for (const other of this.candidates) other.close();
            this.candidates.clear();
            if (this.invitationTimer) clearTimeout(this.invitationTimer);
            this.invitationTimer = null;
            this.peer!.disconnect();
            this.options.onConnection(connection.peerConnection, ready);
            this.finishJoin?.();
            this.finishJoin = this.rejectJoin = null;
        }, (failed, error) => {
            this.candidates.delete(failed);
            if (generation !== this.generation || this.active) return;
            if (this.role === 'guest') this.fail(error, generation);
            // An unauthenticated caller must never be able to destroy the host's invitation.
            else {
                this.options.onStatus('Still waiting for your friend. An unsuccessful connection attempt was closed.');
                this.options.onAttemptFailed?.(error);
            }
        });
        this.candidates.add(channel);
    }

    private fail(error: unknown, generation: number): void {
        if (generation !== this.generation) return;
        const failure = error instanceof Error ? error : new Error('The peer connection failed.');
        this.rejectRegistration?.(failure);
        this.rejectJoin?.(failure);
        this.rejectRegistration = this.rejectJoin = null;
        this.close();
        this.options.onError(failure);
    }
}
