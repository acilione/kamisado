import assert from 'node:assert/strict';
import { parseRelaySettings, candidateCounts, selectedRoute } from '../../src/client/peer-network.js';

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
