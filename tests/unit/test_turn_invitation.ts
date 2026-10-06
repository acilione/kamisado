import assert from 'node:assert/strict';
import { readPeerInvitation, withInvitationRelay, peerInvitationLink, normalizePeerInvitation } from '../../src/shared/peer-invitation.js';
import { generateAutomaticInvitation, automaticPeerId, parseAutomaticInvitation } from '../../src/client/automatic-peer.js';
import { createMeteredCredential, estimateRelayLifetime, validateTurnRequest, providerRejection } from '../../src/shared/turn-provider.js';

async function run() {
    const server = { urls: ['turns:relay.example.com:443?transport=tcp'], username: 'friend', credential: 'temporary-password' };
    const expiresAt = Date.now() + 3600000;
    for (const relayOnly of [false, true]) {
        const base = generateAutomaticInvitation(relayOnly);
        const wrapped = withInvitationRelay(base, { server, expiresAt });
        const parsed = readPeerInvitation(peerInvitationLink(wrapped));
        assert.equal(parsed.invitation, base);
        assert.deepEqual(parsed.relay?.server, server);
        assert.equal(parsed.relay?.expiresAt, expiresAt);
        assert.equal(await automaticPeerId(wrapped), await automaticPeerId(base));
        assert.deepEqual(parseAutomaticInvitation(wrapped), parseAutomaticInvitation(base));
        assert.equal(normalizePeerInvitation(peerInvitationLink(wrapped)), wrapped);
    }
    const base = generateAutomaticInvitation();
    const pack = (value: unknown) => 'K3.' + Buffer.from(JSON.stringify(value)).toString('base64url');
    for (const payload of [null, {}, { invitation: base, relay: {} },
        { invitation: base, relay: { ...server, urls: 'https://evil.example/api' } },
        { invitation: base, relay: server, expiresAt: 'tomorrow' },
        { invitation: base, relay: server, readyAt: expiresAt },
        { invitation: base, relay: server, expiresAt, readyAt: expiresAt + 1 },
        { invitation: base, relay: server, secretKey: 'account-secret' },
    ]) assert.throws(() => readPeerInvitation(pack(payload)));
    assert.throws(() => readPeerInvitation('K3.' + 'a'.repeat(16384)));
    assert.throws(() => readPeerInvitation(pack({ invitation: base, relay: server }) + '?redirect=evil'));
    assert.equal(estimateRelayLifetime('1', '60'), 3600);
    assert.equal(estimateRelayLifetime('3', '0'), 14400);
    assert.ok(estimateRelayLifetime('15', '0') > estimateRelayLifetime('3', '0'));
    assert.ok(estimateRelayLifetime('15', '1800') >= 2 * 1800);
    const request = { domain: 'test.metered.live', secretKey: 'host-secret', lifetimeSeconds: 7200 };
    for (const domain of ['evil.example', 'test.metered.live.evil.example', 'test.metered.live@evil.example', 'test.metered.live:443', 'http://test.metered.live', 'test.metered.live/path']) {
        assert.throws(() => validateTurnRequest({ ...request, domain }));
    }
    for (const lifetimeSeconds of [0, 3599, 172801, NaN, 3600.5]) assert.throws(() => validateTurnRequest({ ...request, lifetimeSeconds }));
    const calls: any[] = [];
    const created = await createMeteredCredential(request, async input => {
        calls.push(input);
        return { status: 200, data: calls.length === 1 ? { apiKey: 'credential-key', expiryInSeconds: 7200 } : [server] };
    });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].data, { expiryInSeconds: 7200, label: 'Kamisado match' });
    assert.equal(new URL(calls[0].url).searchParams.get('secretKey'), 'host-secret');
    assert.equal(new URL(calls[1].url).searchParams.get('apiKey'), 'credential-key');
    assert.ok(created.expiresAt! > Date.now() + 7190000);
    assert.ok(created.readyAt! > Date.now() + 119000);
    assert.ok(!JSON.stringify(created).includes('host-secret'));
    await assert.rejects(createMeteredCredential(request, async () => { throw new Error('host-secret'); }), error => !String(error).includes('host-secret'));
    await assert.rejects(createMeteredCredential(request, async () => ({ status: 401, data: 'host-secret' })), /HTTP 401.*redacted/);
    await assert.rejects(createMeteredCredential(request, async () => ({ status: 400, data: JSON.stringify({ message: 'please enter a positive integer value for expiryInSeconds' }) })), /create temporary credentials.*expiryInSeconds/);
    assert.match(providerRejection(400, { message: 'Invalid request. Not subscribed to any turn server plan' }, 'create', []), /TURN plan is active/);
    assert.match(providerRejection(403, { message: 'Maximum credential limit reached' }, 'create', []), /Review existing credentials/);
    assert.match(providerRejection(400, '<html>host-secret</html>', 'create', ['host-secret']), /no readable error/);
    let callsBeforeFailure = 0;
    await assert.rejects(createMeteredCredential(request, async () => ({ status: ++callsBeforeFailure === 1 ? 200 : 400,
        data: callsBeforeFailure === 1 ? { apiKey: 'scoped-secret', expiryInSeconds: 7200 }
            : { message: 'Invalid apiKey=scoped-secret for host-secret' } })), error => {
        assert.match(String(error), /retrieve relay settings.*Credential creation succeeded/);
        assert.ok(!String(error).includes('scoped-secret') && !String(error).includes('host-secret'));
        return true;
    });
    assert.equal(callsBeforeFailure, 2, 'Provider errors must not trigger more credential creations');
    await assert.rejects(createMeteredCredential(request, async () => ({ status: 200, data: { apiKey: 'key' } })), /confirm.*expiry/);
    console.log('Shared TURN invitations, credential lifetime estimates, provider requests, validation, and secret isolation passed.');
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
