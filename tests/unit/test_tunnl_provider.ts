import assert from 'node:assert/strict';
import { tunnlOrigin } from '../../src/desktop/connectivity/tunnl-provider.js';
import { validateStartRequest } from '../../src/desktop/hosting-controller.js';

assert.equal(tunnlOrigin('READY https://quiet-board-1234abcd.tunnl.gg\r'), 'https://quiet-board-1234abcd.tunnl.gg');
for (const line of ['READY https://quiet-board.tunnl.gg.evil.test', 'READY http://quiet-board.tunnl.gg',
    'https://quiet-board.tunnl.gg', 'READY https://user:secret@quiet-board.tunnl.gg', 'READY https://quiet-board.tunnl.gg/path']) {
    assert.equal(tunnlOrigin(line), null);
}
assert.deepEqual(validateStartRequest({ mode: 'tunnl' }), { mode: 'tunnl' });
assert.throws(() => validateStartRequest({ mode: 'tunnl', localOnly: true }));
console.log('tunnl.gg invitation parsing and host request validation passed.');
