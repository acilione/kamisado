import assert from 'node:assert/strict';
import { normalizePeerInvitation, peerInvitationLink } from '../../src/shared/peer-invitation.js';
import { EventEmitter } from 'node:events';
import type { Peer, PeerOptions } from 'peerjs' with { 'resolution-mode': 'import' };
import {
    AutomaticPeer, automaticPeerId, generateAutomaticInvitation, parseAutomaticInvitation,
    type AutomaticPeerOptions, type PeerDataChannel,
} from '../../src/client/automatic-peer.js';

const pause = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const linkCode = generateAutomaticInvitation();
assert.equal(normalizePeerInvitation(peerInvitationLink(linkCode)), linkCode);
assert.deepEqual(parseAutomaticInvitation(peerInvitationLink(linkCode)), parseAutomaticInvitation(linkCode));
for (const bad of ['https://evil.example/' + linkCode, 'kamisado://join/' + linkCode + '?server=evil',
    'kamisado://join/' + linkCode + '#extra', 'kamisado://other/' + linkCode, 'kamisado://join/../' + linkCode,
    'kamisado://user@join/' + linkCode, 'kamisado://join/%4B' + linkCode.slice(1), 'K2.' + 'A'.repeat(21) + 'B']) {
    assert.throws(() => normalizePeerInvitation(bad));
}
const fingerprint = (byte: string) => Array(32).fill(byte).join(':');
const description = (byte: string) => ({ sdp: `v=0\r\na=fingerprint:sha-256 ${fingerprint(byte)}\r\n` });

class FakeConnection extends EventEmitter {
    peerConnection: RTCPeerConnection;
    dataChannel = { bufferedAmount: 0 };
    open = false;
    closed = false;
    blocked = false;
    label = 'kamisado-v2';
    serialization = 'raw';
    remote!: FakeConnection;
    sent: string[] = [];
    transform?: (message: string) => string;
    constructor(local: string, remote: string) {
        super();
        this.peerConnection = {
            localDescription: description(local), remoteDescription: description(remote),
        } as RTCPeerConnection;
    }
    send(data: string): void {
        this.sent.push(data);
        queueMicrotask(() => { if (!this.remote.closed) this.remote.emit('data', this.transform?.(data) ?? data); });
    }
    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.open = false;
        this.emit('close');
        this.remote?.close();
    }
}

class FakePeer extends EventEmitter {
    static instances: FakePeer[] = [];
    static peers = new Map<string, FakePeer>();
    static nextId = 0;
    static prepare?: (guest: FakeConnection, host: FakeConnection) => void;
    static neverRegister = false;
    readonly id: string;
    readonly options: PeerOptions;
    disconnected = false;
    destroyed = false;
    connections: FakeConnection[] = [];
    constructor(idOrOptions: string | PeerOptions, options?: PeerOptions) {
        super();
        this.id = typeof idOrOptions === 'string' ? idOrOptions : `guest-${++FakePeer.nextId}`;
        this.options = typeof idOrOptions === 'string' ? options! : idOrOptions;
        FakePeer.instances.push(this);
        FakePeer.peers.set(this.id, this);
        if (!FakePeer.neverRegister) queueMicrotask(() => { if (!this.destroyed) this.emit('open', this.id); });
    }
    connect(id: string, options: any): FakeConnection {
        const guest = new FakeConnection('01', '02');
        const host = new FakeConnection('02', '01');
        guest.remote = host;
        host.remote = guest;
        guest.label = host.label = options.label;
        guest.serialization = host.serialization = options.serialization;
        this.connections.push(guest);
        const destination = FakePeer.peers.get(id);
        if (!destination) {
            queueMicrotask(() => this.emit('error', { type: 'peer-unavailable' }));
            return guest;
        }
        destination.connections.push(host);
        FakePeer.prepare?.(guest, host);
        queueMicrotask(() => {
            destination.emit('connection', host);
            if (host.closed || guest.blocked) return;
            host.open = guest.open = true;
            host.emit('open');
            guest.emit('open');
        });
        return guest;
    }
    disconnect(): void {
        this.disconnected = true;
        FakePeer.peers.delete(this.id);
        this.emit('disconnected');
    }
    destroy(): void {
        this.destroyed = true;
        FakePeer.peers.delete(this.id);
        for (const connection of this.connections) connection.close();
    }
}

function options(overrides: Partial<AutomaticPeerOptions> = {}): AutomaticPeerOptions {
    return {
        Peer: FakePeer as unknown as typeof Peer,
        onConnection: () => {}, onStatus: () => {}, onError: () => {},
        registrationTimeoutMs: 200, connectionTimeoutMs: 200, handshakeTimeoutMs: 200,
        ...overrides,
    };
}

async function main(): Promise<void> {
    const invitation = generateAutomaticInvitation();
    assert.match(invitation, /^K2\.[A-Za-z0-9_-]{22}$/);
    assert.equal(parseAutomaticInvitation(`  ${invitation}\n`).secret.byteLength, 16);
    assert.equal(parseAutomaticInvitation(invitation).relay, false);
    assert.equal(parseAutomaticInvitation(generateAutomaticInvitation(true)).relay, true);
    const id = await automaticPeerId(invitation);
    assert.match(id, /^kamisado-v2-[a-f0-9]{64}$/);
    assert.equal(id, await automaticPeerId(invitation));
    assert.notEqual(id, await automaticPeerId(generateAutomaticInvitation()));
    assert.ok(!id.includes(invitation.slice(3)));
    for (const invalid of ['', 'K2.short', 'K3.' + 'A'.repeat(22), 'K2.' + 'A'.repeat(21) + 'B',
        'K2.' + 'A'.repeat(23), 'K2.' + '*'.repeat(22), 'K2.' + 'A'.repeat(22) + '?extra', ' '.repeat(129)]) {
        assert.throws(() => parseAutomaticInvitation(invalid), /invitation/);
    }

    let hostChannel: PeerDataChannel | undefined;
    let guestChannel: PeerDataChannel | undefined;
    const received: string[] = [];
    const failures: Error[] = [];
    const host = new AutomaticPeer('host', options({ onConnection: (_peer, channel) => {
        hostChannel = channel;
        channel.onopen = () => channel.send('host-ready');
        channel.onmessage = event => received.push(String(event.data));
    }, onError: error => failures.push(error) }));
    const guest = new AutomaticPeer('guest', options({ onConnection: (_peer, channel) => {
        guestChannel = channel;
        channel.onmessage = event => received.push(String(event.data));
    }, onError: error => failures.push(error) }));
    const code = await host.createInvite();
    const broker = FakePeer.instances.at(-1)!;
    assert.deepEqual(broker.options.config.iceServers, [{ urls: 'stun:stun.l.google.com:19302' }]);
    assert.equal(broker.options.config.iceTransportPolicy, 'all');
    assert.equal(broker.options.secure, true);
    await guest.join(code);
    await pause();
    assert.ok(hostChannel && guestChannel);
    assert.equal(hostChannel.readyState, 'open');
    assert.equal(guestChannel.readyState, 'open');
    guestChannel.send('a game move');
    await pause();
    assert.deepEqual(received, ['host-ready', 'a game move']);
    assert.equal(broker.disconnected, true);
    assert.equal(broker.destroyed, false, 'Disconnecting signaling must preserve the game channel');
    assert.equal(FakePeer.instances.at(-1)!.disconnected, true);
    assert.equal(failures.length, 0);
    for (const peer of FakePeer.instances) for (const connection of peer.connections) {
        assert.ok(connection.sent.every(message => !message.includes(code.slice(3))), 'Never send the invitation secret');
    }
    host.close();
    guest.close();

    // A broker can replace SDP, but cannot make the invitation proof authenticate a different DTLS peer.
    FakePeer.prepare = (guestConnection) => {
        (guestConnection.peerConnection as any).remoteDescription = description('03');
    };
    let attached = 0;
    let rejectedAttempts = 0;
    const protectedHost = new AutomaticPeer('host', options({ onConnection: () => attached++, onAttemptFailed: () => rejectedAttempts++ }));
    const attacker = new AutomaticPeer('guest', options({ onConnection: () => attached++ }));
    const protectedCode = await protectedHost.createInvite();
    const protectedBroker = FakePeer.instances.at(-1)!;
    await assert.rejects(attacker.join(protectedCode), /match|authenticat|disconnected/);
    assert.equal(attached, 0);
    assert.equal(rejectedAttempts, 1, 'A failed attempt should make an explicit relay retry available');
    assert.equal(protectedBroker.destroyed, false, 'An unauthenticated caller must leave the invitation available');
    attacker.close();
    protectedBroker.emit('error', { type: 'webrtc' });
    assert.equal(protectedBroker.destroyed, false, 'A caller negotiation error must not close the signaling lobby');
    FakePeer.prepare = undefined;
    const realGuest = new AutomaticPeer('guest', options({ onConnection: () => attached++ }));
    await realGuest.join(protectedCode);
    assert.equal(attached, 2, 'A valid friend can join after an invalid attempt');
    protectedHost.close();
    realGuest.close();

    // A proof signed for the guest role cannot authenticate the host role.
    FakePeer.prepare = guestConnection => { guestConnection.transform = data => {
        const frame = JSON.parse(data);
        frame.role = 'host';
        return JSON.stringify(frame);
    }; };
    const roleHost = new AutomaticPeer('host', options());
    const roleGuest = new AutomaticPeer('guest', options());
    await assert.rejects(roleGuest.join(await roleHost.createInvite()), /authenticat|disconnected/);
    roleHost.close();
    roleGuest.close();

    // The pre-authentication queue is bounded even if an unauthenticated caller sends many frames.
    let queueFailure: Error | undefined;
    FakePeer.prepare = guestConnection => {
        guestConnection.transform = () => JSON.stringify({ kind: 'game' });
        guestConnection.on('open', () => {
            for (let i = 0; i < 33; i++) guestConnection.send(JSON.stringify({ kind: 'game' }));
        });
    };
    const queueHost = new AutomaticPeer('host', options({ onAttemptFailed: error => { queueFailure = error; } }));
    const queueGuest = new AutomaticPeer('guest', options());
    await assert.rejects(queueGuest.join(await queueHost.createInvite()), /authenticat|disconnected/);
    assert.match(queueFailure?.message ?? '', /too many messages/);
    queueHost.close();
    queueGuest.close();

    FakePeer.prepare = guestConnection => {
        guestConnection.transform = () => 'x'.repeat(65537);
    };
    const oversizedHost = new AutomaticPeer('host', options());
    const oversizedGuest = new AutomaticPeer('guest', options());
    await assert.rejects(oversizedGuest.join(await oversizedHost.createInvite()), /authenticat|disconnected/);
    oversizedHost.close();
    oversizedGuest.close();

    FakePeer.prepare = guestConnection => { guestConnection.transform = () => JSON.stringify({ kind: 'game' }); };
    const timedHost = new AutomaticPeer('host', options({ handshakeTimeoutMs: 50 }));
    const timedGuest = new AutomaticPeer('guest', options({ handshakeTimeoutMs: 50 }));
    await assert.rejects(timedGuest.join(await timedHost.createInvite()), /authenticat|disconnected/);
    timedHost.close();
    timedGuest.close();
    FakePeer.prepare = undefined;

    const relay = { urls: 'turns:relay.example.com:443', username: 'test', credential: 'ephemeral' };
    const relayHost = new AutomaticPeer('host', options());
    const relayCode = await relayHost.createInvite(relay);
    const relayBroker = FakePeer.instances.at(-1)!;
    assert.match(relayCode, /^K2R\./);
    assert.deepEqual(relayBroker.options.config.iceServers, [relay]);
    assert.equal(relayBroker.options.config.iceTransportPolicy, 'relay');
    assert.ok(!relayCode.includes('ephemeral'));
    const relayGuest = new AutomaticPeer('guest', options());
    await assert.rejects(relayGuest.join(relayCode), /credentials/);
    await relayGuest.join(relayCode, relay);
    relayHost.close();
    relayGuest.close();

    // Configuring fallback must neither skip direct P2P nor allocate TURN for successful direct games.
    const directHost = new AutomaticPeer('host', options({ fallbackRelay: relay }));
    const directCode = await directHost.createInvite();
    const standby = FakePeer.instances.at(-1)!;
    assert.equal(standby.id, await automaticPeerId(directCode, true));
    assert.notEqual(standby.id, await automaticPeerId(directCode));
    assert.equal(standby.connections.length, 0);
    const directGuest = new AutomaticPeer('guest', options({ fallbackRelay: relay }));
    await directGuest.join(directCode);
    assert.equal(FakePeer.instances.at(-1)!.options.config.iceTransportPolicy, 'all');
    assert.equal(standby.connections.length, 0, 'Successful direct setup never contacts the standby TURN endpoint');
    assert.equal(standby.disconnected, true, 'Unused fallback signaling must close after direct success');
    directHost.close();
    directGuest.close();

    // An unreachable direct path triggers exactly one relay attempt with the original invitation.
    FakePeer.prepare = connection => {
        connection.blocked = FakePeer.instances.at(-1)!.options.config.iceTransportPolicy !== 'relay';
    };
    const statuses: string[] = [];
    let fallbackConnections = 0;
    const autoHost = new AutomaticPeer('host', options({ fallbackRelay: relay,
        onConnection: () => fallbackConnections++ }));
    const autoCode = await autoHost.createInvite();
    assert.match(autoCode, /^K2\./);
    const autoGuest = new AutomaticPeer('guest', options({ fallbackRelay: relay,
        onStatus: message => statuses.push(message), onConnection: () => fallbackConnections++ }));
    const beforeRetry = FakePeer.instances.length;
    await autoGuest.join(autoCode);
    assert.equal(fallbackConnections, 2);
    assert.equal(FakePeer.instances.length - beforeRetry, 2, 'One direct attempt and one automatic retry');
    assert.equal(FakePeer.instances.at(-2)!.destroyed, true, 'The failed direct peer is released');
    assert.equal(FakePeer.instances.at(-1)!.options.config.iceTransportPolicy, 'relay');
    assert(statuses.some(message => message.includes('automatically')));
    autoHost.close();
    autoGuest.close();

    // A guest can choose TURN immediately for a normal invitation with relay standby.
    FakePeer.prepare = undefined;
    const forcedHost = new AutomaticPeer('host', options({ fallbackRelay: relay }));
    const forcedCode = await forcedHost.createInvite();
    const forcedGuest = new AutomaticPeer('guest', options({ fallbackRelay: relay }));
    const beforeForced = FakePeer.instances.length;
    await forcedGuest.join(forcedCode, undefined, true);
    assert.equal(FakePeer.instances.length - beforeForced, 1, 'TURN directly must skip the direct attempt');
    assert.equal(FakePeer.instances.at(-1)!.options.config.iceTransportPolicy, 'relay');
    forcedGuest.close();
    forcedHost.close();
    const noCredentials = new AutomaticPeer('guest', options());
    await assert.rejects(noCredentials.join(forcedCode, undefined, true), /TURN credentials/);
    noCredentials.close();

    FakePeer.prepare = connection => { connection.blocked = true; };
    const failedRelayHost = new AutomaticPeer('host', options({ fallbackRelay: relay, connectionTimeoutMs: 50 }));
    const failedRelayGuest = new AutomaticPeer('guest', options({ fallbackRelay: relay, connectionTimeoutMs: 50 }));
    const failedCode = await failedRelayHost.createInvite();
    const beforeFailure = FakePeer.instances.length;
    await assert.rejects(failedRelayGuest.join(failedCode), /TURN fallback could not connect/);
    assert.equal(FakePeer.instances.length - beforeFailure, 2, 'Failed credentials or network must not cause a retry loop');
    assert(FakePeer.instances.slice(beforeFailure).every(peer => peer.destroyed));
    failedRelayHost.close();
    failedRelayGuest.close();

    // A failed authentication must not be treated as a network failure or trigger TURN.
    FakePeer.prepare = connection => { (connection.peerConnection as any).remoteDescription = description('03'); };
    const authHost = new AutomaticPeer('host', options({ fallbackRelay: relay }));
    const authCode = await authHost.createInvite();
    const authStandby = FakePeer.instances.at(-1)!;
    const authGuest = new AutomaticPeer('guest', options({ fallbackRelay: relay }));
    const beforeAuth = FakePeer.instances.length;
    await assert.rejects(authGuest.join(authCode), /match|authenticat|disconnected/);
    assert.equal(FakePeer.instances.length - beforeAuth, 1);
    assert.equal(authStandby.connections.length, 0);
    authHost.close();
    authGuest.close();

    // Cancelling while relay signaling registers must cancel the whole operation.
    FakePeer.prepare = connection => { connection.blocked = true; FakePeer.neverRegister = true; };
    const cancelHost = new AutomaticPeer('host', options({ fallbackRelay: relay, connectionTimeoutMs: 50 }));
    const cancelCode = await cancelHost.createInvite();
    const cancelGuest = new AutomaticPeer('guest', options({ fallbackRelay: relay, connectionTimeoutMs: 50 }));
    const beforeCancel = FakePeer.instances.length;
    const cancelling = cancelGuest.join(cancelCode);
    const cancelledResult = assert.rejects(cancelling, /cancelled/);
    const deadline = Date.now() + 500;
    while (FakePeer.instances.length < beforeCancel + 2 && Date.now() < deadline) await pause(5);
    assert.equal(FakePeer.instances.length, beforeCancel + 2);
    cancelGuest.close();
    await cancelledResult;
    assert(FakePeer.instances.slice(beforeCancel).every(peer => peer.destroyed));
    cancelHost.close();
    FakePeer.neverRegister = false;
    FakePeer.prepare = undefined;

    FakePeer.neverRegister = true;
    const unavailable = new AutomaticPeer('host', options({ registrationTimeoutMs: 50 }));
    await assert.rejects(unavailable.createInvite(), /service is unavailable/);
    assert.equal(FakePeer.instances.at(-1)!.destroyed, true);
    unavailable.close();
    const cancelled = new AutomaticPeer('host', options());
    const pending = cancelled.createInvite();
    await pause();
    cancelled.close();
    await assert.rejects(pending, /cancelled/);
    FakePeer.neverRegister = false;
    const missingGuest = new AutomaticPeer('guest', options());
    await assert.rejects(missingGuest.join(generateAutomaticInvitation()), /no longer available/);
    missingGuest.close();
    console.log('Automatic invitations, authenticated peer setup, relay isolation, and cancellation checks passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
