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
            if (host.closed) return;
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
