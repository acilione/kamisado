import assert from 'node:assert/strict';
import { parseRelaySettings, parseRelayImport, candidateCounts, selectedRoute } from '../../src/client/peer-network.js';

const imported = { urls: 'turn:relay.example.com:3478', username: 'player', credential: 'secret' };
const iceServers = [{ urls: 'stun:stun.example.com' }, imported,
    { ...imported, urls: ['turns:relay.example.com:443?transport=tcp', imported.urls] }];
for (const data of [iceServers, { iceServers }]) {
    assert.deepEqual(parseRelayImport(JSON.stringify(data)), {
        urls: ['turns:relay.example.com:443?transport=tcp', imported.urls], username: 'player', credential: 'secret',
    });
}
const many = Array.from({ length: 6 }, (_, i) => ({ ...imported, urls: `turn:relay.example.com:${3478 + i}` }));
many.push({ ...imported, urls: 'turns:relay.example.com:443?transport=tcp' });
assert.equal((parseRelayImport(JSON.stringify(many)).urls as string[]).length, 4);
assert.equal((parseRelayImport(JSON.stringify(many)).urls as string[])[0], many.at(-1)!.urls);
for (const data of [null, {}, [null], [{ urls: 42 }], [{ urls: 'stun:example.com' }],
    [{ ...imported, urls: 'https://example.com' }], [{ ...imported, credentialType: 'oauth' }],
    [imported, { ...imported, credential: 'other' }], [{ ...imported, credential: {} }]]) {
    assert.throws(() => parseRelayImport(JSON.stringify(data)));
}
assert.throws(() => parseRelayImport('window.alert("not JSON")'), /valid ICE servers JSON/);
assert.throws(() => parseRelayImport(' '.repeat(65537)), /too large/);

assert.deepEqual(parseRelaySettings('turns:relay.example.com:443?transport=tcp\nturn:relay.example.com:3478?transport=udp', ' player ', ' token '), {
    urls: ['turns:relay.example.com:443?transport=tcp', 'turn:relay.example.com:3478?transport=udp'],
    username: 'player', credential: ' token ',
});
assert.deepEqual(parseRelaySettings('turn:[::1]:3478', 'u', 'p').urls, ['turn:[::1]:3478']);
for (const address of ['', 'https://relay.example.com', 'turn:me:secret@relay.example.com',
    'turn:relay.example.com/path', 'turn:relay.example.com:0', 'turn:relay.example.com:65536',
    'turns:relay.example.com?transport=udp', 'turn:relay.example.com#password',
    'turn:[::::]', 'turn:relay.example.com?transport=sctp', Array(5).fill('turn:example.com').join('\n')]) {
    assert.throws(() => parseRelaySettings(address, 'u', 'p'), /TURN|relay/);
}
assert.throws(() => parseRelaySettings('turn:example.com', '', 'p'), /username/);
assert.throws(() => parseRelaySettings('turn:example.com', 'u', ''), /password/);
assert.throws(() => parseRelaySettings('turn:example.com', 'u', 'x'.repeat(2049)), /password/);
assert.deepEqual(candidateCounts('a=candidate:1 1 udp 1 192.0.2.1 1000 typ host\r\n' +
    'a=candidate:2 1 udp 2 192.0.2.2 1001 typ srflx raddr 192.0.2.1\r\n' +
    'a=candidate:3 1 udp 3 192.0.2.3 1002 typ relay\r\n'), { host: 1, srflx: 1, relay: 1 });
const report = (local: string, remote: string): RTCStatsReport => new Map([
    ['transport', { type: 'transport', selectedCandidatePairId: 'selected' }],
    ['selected', { type: 'candidate-pair', localCandidateId: 'local', remoteCandidateId: 'remote' }],
    ['local', { candidateType: local }], ['remote', { candidateType: remote }],
] as [string, any][]) as unknown as RTCStatsReport;
assert.equal(selectedRoute(report('host', 'srflx')), 'direct');
assert.equal(selectedRoute(report('host', 'relay')), 'relay');
assert.equal(selectedRoute(report('relay', 'host')), 'relay');
assert.equal(selectedRoute(new Map() as unknown as RTCStatsReport), undefined);
console.log('Peer network validation and selected-route checks passed.');
