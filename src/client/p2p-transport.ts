import { EventSocket, type EventTransport } from './event-socket.js';
import { connectGameSocket, type GameSocket } from './transport.js';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/types.js';

const MAX_CODE_LENGTH = 65536;
const MAX_MESSAGE_LENGTH = 65536;
const MAX_PENDING_ACKS = 32;
const CODE_PREFIX = 'KAMISADO1.';
const CLIENT_EVENTS = new Set(['checkActiveSession', 'joinGame', 'makeMove', 'confirmNextRound', 'fillChoice']);
const SERVER_EVENTS = new Set<keyof ServerToClientEvents>([
    'hostStopped', 'runtimeConfig', 'gameStateUpdate', 'gameEnded', 'playerJoined',
    'playerDisconnected', 'playerReconnected', 'sessionTakenOver', 'lobbyExpired', 'roundTimerStart', 'error',
]);
/** A peer can act only in the invited room; creating or deleting rooms is local-only. */
export class P2pSocket extends EventSocket {
    constructor(transport: EventTransport) { super(transport, CLIENT_EVENTS); }
}
type LocalSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type P2pSocketAdapter = Pick<LocalSocket, 'on' | 'off' | 'emit' | 'timeout' | 'connected' | 'disconnect'>;
export interface P2pStatus {
    state: 'idle' | 'gathering' | 'waiting-answer' | 'connecting' | 'connected' | 'disconnected' | 'closed' | 'error';
    message: string;
}

export interface P2pOptions {
    iceServers?: RTCIceServer[];
    /** Bounds may be shortened for tests; never extended past the production limits. */
    gatheringTimeoutMs?: number;
    connectionTimeoutMs?: number;
    exchangeTimeoutMs?: number;
}

interface SignalCode {
    v: 1;
    type: 'offer' | 'answer';
    gameId: string;
    sessionId: string;
    sdp: string;
}

function record(value: unknown): value is Record<string, any> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validGameId(value: unknown): value is string {
    return typeof value === 'string' && /^[a-f0-9]{12}$/.test(value);
}

function readCode(code: string, expectedType: SignalCode['type']): SignalCode {
    if (typeof code !== 'string' || code.length > MAX_CODE_LENGTH) throw new Error('The connection code is too long.');
    // Messaging and email apps may wrap long codes. Bound the raw input first,
    // then allow only ASCII spacing around or inside the encoded characters.
    const trimmed = code.replace(/[\t\n\v\f\r ]+/g, '');
    if (!trimmed.startsWith(CODE_PREFIX) || !/^[A-Za-z0-9_-]+$/.test(trimmed.slice(CODE_PREFIX.length))) {
        throw new Error('Paste the complete Kamisado connection code.');
    }
    let value: unknown;
    try {
        const raw = atob(trimmed.slice(CODE_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/'));
        const bytes = Uint8Array.from(raw, character => character.charCodeAt(0));
        value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch { throw new Error('This connection code is not valid. Copy it again.'); }
    if (!record(value) || value.v !== 1 || value.type !== expectedType || !validGameId(value.gameId) ||
        typeof value.sessionId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.sessionId) ||
        typeof value.sdp !== 'string' || value.sdp.length > 48000 ||
        !/^v=0\r?\n/.test(value.sdp) || !/^m=application /m.test(value.sdp) || /^m=(?!application )/m.test(value.sdp)) {
        throw new Error(`Paste a valid Kamisado ${expectedType === 'offer' ? 'invitation' : 'reply'} code.`);
    }
    return value as unknown as SignalCode;
}

function writeCode(value: SignalCode): string {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let raw = '';
    for (const byte of bytes) raw += String.fromCharCode(byte);
    const code = CODE_PREFIX + btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    if (code.length > MAX_CODE_LENGTH) throw new Error('The network produced too many connection candidates. Try another network.');
    return code;
}

/** Manual signaling and a data-only WebRTC channel. No game or signaling relay is used. */
export class P2pTransport {
    private peer: RTCPeerConnection | null = null;
    private channel: RTCDataChannel | null = null;
    private proxy: GameSocket | null = null;
    private socket = new P2pSocket(this);
    private status: P2pStatus = { state: 'idle', message: 'Ready to connect to a friend.' };
    private statusListeners = new Set<(status: P2pStatus) => void>();
    private room: string | null = null;
    private sessionId = '';
    private generation = 0;
    private connectionTimer: ReturnType<typeof setTimeout> | null = null;
    private exchangeTimer: ReturnType<typeof setTimeout> | null = null;
    private cancelGathering: (() => void) | null = null;
    private cancelOperations = new Set<() => void>();
    private peerPlayerId: string = crypto.randomUUID();
    private incomingWindow = 0;
    private incomingCount = 0;
    private proxyAcks = new Set<number>();
    private lastAckId = 0;

    constructor(readonly role: 'host' | 'guest', private readonly options: P2pOptions = {}) {}

    get gameId(): string | null { return this.room; }
    // Match Socket.IO's generic method signatures so callers can select either
    // transport without losing callback argument inference on their union.
    getGuestSocket(): P2pSocketAdapter { return this.socket as unknown as P2pSocketAdapter; }

    onStatus(callback: (status: P2pStatus) => void): () => void {
        this.statusListeners.add(callback);
        callback(this.status);
        return () => { this.statusListeners.delete(callback); };
    }

    async createOffer(gameId: string): Promise<string> {
        if (this.role !== 'host' || !validGameId(gameId)) throw new Error('Create a multiplayer game before inviting a friend.');
        const peer = this.makePeer();
        const generation = this.begin(peer, gameId, crypto.randomUUID());
        try {
            this.attachChannel(peer.createDataChannel('kamisado', { ordered: true, protocol: 'kamisado-v1' }), generation);
            const description = await this.operation(peer.createOffer(), generation);
            await this.operation(peer.setLocalDescription(description), generation);
            await this.gather(peer, generation);
            this.ensureCurrent(generation);
            const code = writeCode({ v: 1, type: 'offer', gameId, sessionId: this.sessionId, sdp: peer.localDescription!.sdp });
            this.update('waiting-answer', 'Send the invitation code to your friend, then paste their reply. This code expires in ten minutes.');
            this.startExchangeDeadline(generation);
            return code;
        } catch (error) {
            if (generation === this.generation) this.fail(error instanceof Error ? error.message : 'Could not prepare the invitation.');
            throw error;
        }
    }

    async acceptOffer(code: string): Promise<string> {
        if (this.role !== 'guest') throw new Error('Only the joining player can accept an invitation.');
        const offer = readCode(code, 'offer');
        // Validate SDP on a new connection before replacing any working session.
        const peer = this.makePeer();
        const beforeValidation = this.generation;
        try { await this.operation(peer.setRemoteDescription({ type: 'offer', sdp: offer.sdp }), beforeValidation); }
        catch {
            peer.close();
            throw new Error(beforeValidation === this.generation
                ? 'This invitation could not be read. Ask your friend for a new code.' : 'Connection setup was cancelled.');
        }
        if (beforeValidation !== this.generation) {
            peer.close();
            throw new Error('Connection setup was cancelled.');
        }
        const generation = this.begin(peer, offer.gameId, offer.sessionId);
        try {
            const description = await this.operation(peer.createAnswer(), generation);
            await this.operation(peer.setLocalDescription(description), generation);
            await this.gather(peer, generation);
            this.ensureCurrent(generation);
            const answer = writeCode({ v: 1, type: 'answer', gameId: offer.gameId, sessionId: offer.sessionId, sdp: peer.localDescription!.sdp });
            if (this.status.state !== 'connected') {
                this.update('connecting', 'Send this reply to your friend so they can complete the connection. This reply expires in ten minutes.');
                this.startExchangeDeadline(generation);
            }
            return answer;
        } catch (error) {
            if (generation === this.generation) this.fail(error instanceof Error ? error.message : 'Could not prepare your reply.');
            throw error;
        }
    }

    async acceptAnswer(code: string): Promise<void> {
        if (this.role !== 'host') throw new Error('Only the inviting player can accept a reply.');
        const answer = readCode(code, 'answer');
        if (!this.peer || answer.gameId !== this.room || answer.sessionId !== this.sessionId || this.peer.signalingState !== 'have-local-offer') {
            throw new Error('This reply does not match the current invitation. Ask your friend to use your latest code.');
        }
        const generation = this.generation;
        try { await this.operation(this.peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp }), generation); }
        catch { throw new Error('This reply could not be read. Copy the complete reply and try again.'); }
        this.ensureCurrent(generation);
        this.clearExchangeDeadline();
        if (this.status.state !== 'connected') {
            this.update('connecting', 'Connecting directly to your friend…');
            this.startConnectionDeadline(generation);
        }
    }

    close(): void {
        this.release();
        this.update('closed', 'Peer connection closed.');
    }

    sendRequest(frame: Record<string, unknown>): boolean {
        return this.role === 'guest' && this.send(frame);
    }

    private makePeer(): RTCPeerConnection {
        if (typeof RTCPeerConnection !== 'function') throw new Error('This browser does not support peer connections. Open the desktop app or a current browser.');
        return new RTCPeerConnection({
            iceServers: this.options.iceServers ?? [{ urls: 'stun:stun.l.google.com:19302' }],
            bundlePolicy: 'max-bundle',
        });
    }

    private begin(peer: RTCPeerConnection, gameId: string, sessionId: string): number {
        this.release();
        const generation = this.generation;
        this.peer = peer;
        this.room = gameId;
        this.sessionId = sessionId;
        if (this.role === 'host') {
            // The server keeps a disconnected seat for 60 seconds. Restoring
            // this secret after a host-page reload lets the invited peer reclaim
            // that seat, while guest-provided player IDs are never trusted.
            try {
                const key = `kamisado_p2p_peer_${gameId}`;
                const stored = sessionStorage.getItem(key);
                this.peerPlayerId = stored && /^[a-f0-9-]{36}$/.test(stored) ? stored : crypto.randomUUID();
                sessionStorage.setItem(key, this.peerPlayerId);
            } catch { /* The same transport still retains its identity in memory. */ }
        }
        this.incomingWindow = Date.now();
        this.incomingCount = 0;
        this.lastAckId = 0;
        peer.ondatachannel = event => {
            if (this.role !== 'guest' || this.channel || event.channel.label !== 'kamisado' || event.channel.protocol !== 'kamisado-v1') {
                event.channel.close();
                return;
            }
            this.attachChannel(event.channel, generation);
        };
        peer.onconnectionstatechange = () => {
            if (generation !== this.generation) return;
            if (peer.connectionState === 'failed') this.fail('A direct connection could not be established. Try the same Wi-Fi or a shared VPN.');
            else if (peer.connectionState === 'disconnected') {
                this.socket.setConnected(false, 'Peer connection interrupted');
                this.update('disconnected', 'The peer connection was interrupted. Waiting to reconnect…');
                this.startConnectionDeadline(generation);
            } else if (peer.connectionState === 'connected' && this.channel?.readyState === 'open') {
                if (this.role === 'host' && this.proxy?.connected) this.markReady();
                else if (this.role === 'guest') this.send({ kind: 'ready-request' });
            }
        };
        this.update('gathering', 'Preparing a direct connection…');
        return generation;
    }

    private ensureCurrent(generation: number): void {
        if (generation !== this.generation || !this.peer) throw new Error('Connection setup was cancelled.');
    }

    private operation<T>(pending: Promise<T>, generation: number): Promise<T> {
        // Browsers may abandon an outstanding RTC promise when close() runs.
        // Explicit cancellation also prevents a late SDP result reviving a
        // session the user already ended.
        return new Promise((resolve, reject) => {
            const cancel = () => reject(new Error('Connection setup was cancelled.'));
            this.cancelOperations.add(cancel);
            if (generation !== this.generation) cancel();
            pending.then(value => {
                this.cancelOperations.delete(cancel);
                if (generation !== this.generation) cancel();
                else resolve(value);
            }, error => {
                this.cancelOperations.delete(cancel);
                reject(error);
            });
        });
    }

    private gather(peer: RTCPeerConnection, generation: number): Promise<void> {
        this.ensureCurrent(generation);
        if (peer.iceGatheringState === 'complete') return Promise.resolve();
        return new Promise((resolve, reject) => {
            const finish = (error?: Error) => {
                clearTimeout(timer);
                peer.removeEventListener('icegatheringstatechange', changed);
                if (this.cancelGathering === cancel) this.cancelGathering = null;
                error ? reject(error) : resolve();
            };
            const cancel = () => finish(new Error('Connection setup was cancelled.'));
            const changed = () => { if (peer.iceGatheringState === 'complete') finish(); };
            const timer = setTimeout(() => {
                // A slow/unreachable STUN service must not block usable local candidates.
                if (/^a=candidate:/m.test(peer.localDescription?.sdp || '')) finish();
                else finish(new Error('No network address was found. Check your connection and try again.'));
            }, Math.min(10000, Math.max(100, this.options.gatheringTimeoutMs ?? 10000)));
            this.cancelGathering = cancel;
            peer.addEventListener('icegatheringstatechange', changed);
            changed();
        });
    }

    private attachChannel(channel: RTCDataChannel, generation: number): void {
        this.channel = channel;
        channel.onopen = () => {
            if (generation !== this.generation) return;
            this.clearExchangeDeadline();
            this.startConnectionDeadline(generation);
            if (this.role === 'host') this.connectProxy(generation);
        };
        channel.onmessage = event => {
            if (generation !== this.generation) return;
            if (typeof event.data !== 'string' || event.data.length > MAX_MESSAGE_LENGTH) {
                this.fail('The peer sent an invalid message.');
                return;
            }
            if (Date.now() - this.incomingWindow > 5000) { this.incomingWindow = Date.now(); this.incomingCount = 0; }
            if (++this.incomingCount > 100) { this.fail('The peer sent too many messages.'); return; }
            let frame: unknown;
            try { frame = JSON.parse(event.data); }
            catch { this.fail('The peer sent an invalid message.'); return; }
            if (!record(frame)) { this.fail('The peer sent an invalid message.'); return; }
            if (this.role === 'host') this.receiveRequest(frame);
            else this.receiveResponse(frame);
        };
        channel.onclose = () => {
            if (generation !== this.generation) return;
            this.release();
            this.update('disconnected', 'Your friend disconnected. Exchange new codes to reconnect.');
        };
        channel.onerror = () => {
            if (generation === this.generation) this.fail('The peer connection failed. Exchange new codes and try again.');
        };
    }

    private connectProxy(generation: number): void {
        if (this.proxy) return;
        const proxy = this.proxy = connectGameSocket();
        proxy.on('connect', () => { if (generation === this.generation) this.markReady(); });
        proxy.on('disconnect', () => {
            if (generation !== this.generation) return;
            this.send({ kind: 'disconnected', reason: 'The host game server disconnected.' });
            this.update('disconnected', 'Reconnecting to the game on this computer…');
            this.startConnectionDeadline(generation);
        });
        proxy.onAny((event: string, ...args: unknown[]) => {
            if (generation !== this.generation || !SERVER_EVENTS.has(event as keyof ServerToClientEvents)) return;
            if (event === 'gameStateUpdate' && (!record(args[0]) || args[0].id !== this.room)) return;
            // Local network addresses are neither needed nor advertised to an Internet guest.
            this.send({ kind: 'event', event, args: event === 'runtimeConfig' ? [{ publicOrigin: null }] : args });
        });
        if (proxy.connected) this.markReady();
    }

    private markReady(): void {
        this.clearConnectionDeadline();
        this.clearExchangeDeadline();
        this.send({ kind: 'ready', gameId: this.room });
        this.update('connected', 'Connected directly to your friend.');
    }

    private receiveRequest(frame: Record<string, any>): void {
        if (frame.kind === 'ready-request') { if (this.proxy?.connected) this.markReady(); return; }
        const id = frame.id;
        if (frame.kind !== 'request' || typeof frame.event !== 'string' || !CLIENT_EVENTS.has(frame.event) || !record(frame.data) ||
            (id !== undefined && (!Number.isSafeInteger(id) || id <= this.lastAckId || id <= 0)) || this.proxyAcks.size >= MAX_PENDING_ACKS) {
            this.fail('The peer sent an unsupported game request.');
            return;
        }
        if (id !== undefined) this.lastAckId = id;
        const reject = (message: string) => {
            if (id !== undefined) this.send({ kind: 'ack', id, data: { success: false, active: false, message } });
            else this.send({ kind: 'event', event: 'error', args: [{ message }] });
        };
        if (!this.proxy?.connected) { reject('The host game server is reconnecting.'); return; }
        if (frame.event !== 'checkActiveSession' && frame.data.gameId !== this.room) {
            reject('This invitation only opens its own game.');
            return;
        }
        const data: Record<string, unknown> = { gameId: this.room };
        switch (frame.event) {
            case 'checkActiveSession':
            case 'joinGame': data.playerId = this.peerPlayerId; break;
            case 'makeMove': {
                const move = frame.data.move;
                if (!record(move) || !['fromR', 'fromC', 'toR', 'toC'].every(key => Number.isInteger(move[key]) && move[key] >= 0 && move[key] < 8)) {
                    reject('Choose a valid board move.'); return;
                }
                data.move = { fromR: move.fromR, fromC: move.fromC, toR: move.toR, toC: move.toC };
                break;
            }
            case 'fillChoice':
                if (frame.data.direction !== 'left' && frame.data.direction !== 'right') { reject('Choose a fill direction.'); return; }
                data.direction = frame.data.direction;
                break;
        }
        const generation = this.generation;
        const acknowledge = (response: unknown) => {
            if (id === undefined || !this.proxyAcks.delete(id) || generation !== this.generation) return;
            if (record(response) && response.gameId && response.gameId !== this.room) {
                this.send({ kind: 'ack', id, data: { active: false, success: false } });
                return;
            }
            this.send({ kind: 'ack', id, data: response });
        };
        if (id !== undefined) this.proxyAcks.add(id);
        // Explicit event dispatch prevents peer-controlled property access or arbitrary RPC.
        switch (frame.event) {
            case 'checkActiveSession': this.proxy.emit('checkActiveSession', { playerId: this.peerPlayerId }, acknowledge); break;
            case 'joinGame': this.proxy.emit('joinGame', { gameId: this.room!, playerId: this.peerPlayerId }, acknowledge); break;
            case 'makeMove': this.proxy.emit('makeMove', data as Parameters<ClientToServerEvents['makeMove']>[0]); break;
            case 'confirmNextRound': this.proxy.emit('confirmNextRound', { gameId: this.room! }); break;
            case 'fillChoice': this.proxy.emit('fillChoice', { gameId: this.room!, direction: data.direction as 'left' | 'right' }); break;
        }
        if (id !== undefined && frame.event !== 'checkActiveSession' && frame.event !== 'joinGame') {
            this.proxyAcks.delete(id);
            reject('This game action does not provide an acknowledgement.');
        }
    }

    private receiveResponse(frame: Record<string, any>): void {
        if (frame.kind === 'ready' && frame.gameId === this.room) {
            this.clearConnectionDeadline();
            this.clearExchangeDeadline();
            this.update('connected', 'Connected directly to your friend.');
            this.socket.setConnected(true);
        } else if (frame.kind === 'disconnected' && typeof frame.reason === 'string' && frame.reason.length <= 256) {
            this.socket.setConnected(false, frame.reason);
            this.update('disconnected', frame.reason);
            this.startConnectionDeadline(this.generation);
        } else if (frame.kind === 'ack' && Number.isSafeInteger(frame.id) && frame.id > 0 && record(frame.data)) {
            this.socket.acknowledge(frame.id, frame.data);
        } else if (frame.kind === 'event' && SERVER_EVENTS.has(frame.event) && Array.isArray(frame.args) && frame.args.length <= 1) {
            if (frame.event === 'gameStateUpdate' && (!record(frame.args[0]) || frame.args[0].id !== this.room)) return;
            this.socket.deliver(frame.event, ...frame.args);
        } else this.fail('The peer sent an unsupported response.');
    }

    private send(frame: Record<string, unknown>): boolean {
        if (this.channel?.readyState !== 'open') return false;
        const data = JSON.stringify(frame);
        if (data.length > MAX_MESSAGE_LENGTH || this.channel.bufferedAmount > MAX_MESSAGE_LENGTH * 4) {
            this.fail('The peer connection is overloaded. Please reconnect.');
            return false;
        }
        try { this.channel.send(data); return true; }
        catch { this.fail('The peer connection could not send a message.'); return false; }
    }

    private startConnectionDeadline(generation: number): void {
        if (this.connectionTimer) return;
        this.connectionTimer = setTimeout(() => {
            this.connectionTimer = null;
            if (generation === this.generation) this.fail('The direct connection timed out. Exchange new codes, or try the same Wi-Fi or a shared VPN.');
        }, Math.min(30000, Math.max(100, this.options.connectionTimeoutMs ?? 30000)));
    }

    private clearConnectionDeadline(): void {
        if (this.connectionTimer) clearTimeout(this.connectionTimer);
        this.connectionTimer = null;
    }

    private startExchangeDeadline(generation: number): void {
        this.clearExchangeDeadline();
        this.exchangeTimer = setTimeout(() => {
            this.exchangeTimer = null;
            if (generation === this.generation) this.fail('This connection code expired. Create a fresh invitation and exchange new codes.');
        }, Math.min(600000, Math.max(100, this.options.exchangeTimeoutMs ?? 600000)));
    }

    private clearExchangeDeadline(): void {
        if (this.exchangeTimer) clearTimeout(this.exchangeTimer);
        this.exchangeTimer = null;
    }

    private update(state: P2pStatus['state'], message: string): void {
        this.status = { state, message };
        for (const listener of [...this.statusListeners]) listener(this.status);
    }

    private fail(message: string): void {
        this.release();
        this.update('error', message);
        this.socket.deliver('connect_error', new Error(message));
    }

    private release(): void {
        this.generation++;
        for (const cancel of this.cancelOperations) cancel();
        this.cancelOperations.clear();
        this.cancelGathering?.();
        this.cancelGathering = null;
        this.clearConnectionDeadline();
        this.clearExchangeDeadline();
        if (this.channel) {
            this.channel.onopen = this.channel.onclose = this.channel.onerror = this.channel.onmessage = null;
            this.channel.close();
            this.channel = null;
        }
        if (this.peer) {
            this.peer.ondatachannel = this.peer.onconnectionstatechange = null;
            this.peer.close();
            this.peer = null;
        }
        if (this.proxy) {
            this.proxy.removeAllListeners();
            this.proxy.disconnect();
            this.proxy = null;
        }
        this.proxyAcks.clear();
        this.socket.setConnected(false);
        this.socket.rejectPending('Peer connection closed.');
    }
}
