import assert from 'node:assert/strict';
import { normalizeGameInvitation } from '../../src/shared/invitation-url.js';

assert.equal(normalizeGameInvitation('  http://192.168.1.12:32145/game/ABCDEF123456/  '),
    'http://192.168.1.12:32145/game/abcdef123456');
assert.equal(normalizeGameInvitation('https://friend.example/game/123456abcdef'),
    'https://friend.example/game/123456abcdef');
assert.equal(normalizeGameInvitation('http://[fd00::1]:32145/game/123456abcdef'),
    'http://[fd00::1]:32145/game/123456abcdef');
for (const value of [
    null, {}, 123, '', '123456abcdef', '//friend/game/123456abcdef',
    'file:///game/123456abcdef', 'javascript:alert(1)', 'mailto:friend@example.com',
    'https://user:password@friend/game/123456abcdef', 'http://friend:99999/game/123456abcdef',
    'http://friend/game/not-a-room', 'http://friend/another-page',
    'http://friend/game/123456abcdef?redirect=file:///', 'http://friend/game/123456abcdef#fragment',
    'http://friend\\game\\123456abcdef', 'http://friend/ga\nme/123456abcdef',
    'http://' + 'a'.repeat(2050) + '/game/123456abcdef',
]) assert.throws(() => normalizeGameInvitation(value), /full invitation link/);
console.log('Invitation URL checks passed: LAN, HTTPS, IPv6, and unsupported or malformed links.');
