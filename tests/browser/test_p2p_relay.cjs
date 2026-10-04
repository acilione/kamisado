// Requires a test TURN service; credentials come from the environment, never the bundle.
const assert = require('node:assert/strict');
const path = require('node:path');
const express = require('express');
const { chromium } = require('playwright');
const { startServer } = require('../../dist/server/index.js');

async function run() {
  const urls = process.env.KAMISADO_TEST_TURN_URL;
  const username = process.env.KAMISADO_TEST_TURN_USER;
  const password = process.env.KAMISADO_TEST_TURN_PASSWORD;
  assert.ok(urls && username && password, 'Set KAMISADO_TEST_TURN_URL, KAMISADO_TEST_TURN_USER and KAMISADO_TEST_TURN_PASSWORD');
  const server = await startServer({ port: 0, host: '127.0.0.1' });
  const assets = express();
  assets.use(express.static(path.resolve(__dirname, '../../out/mobile')));
  const mobile = await new Promise(resolve => { const listener = assets.listen(0, '127.0.0.1', () => resolve(listener)); });
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const desktopContext = await browser.newContext();
    const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    for (const context of [desktopContext, phoneContext]) await context.addInitScript(() => {
      const Native = RTCPeerConnection;
      window.testPeers = [];
      window.RTCPeerConnection = class extends Native {
        constructor(config) {
          // Direct setup is local-only in this test; relay setup uses the actual TURN service.
          super(config.iceTransportPolicy === 'relay' ? config : { ...config, iceServers: [] });
          window.testPeers.push({ peer: this, config });
        }
      };
    });
    const host = await desktopContext.newPage();
    const guest = await phoneContext.newPage();
    const errors = [];
    for (const page of [host, guest]) {
      page.setDefaultTimeout(30000);
      page.on('pageerror', error => errors.push(error.message));
    }
    await host.goto(`http://127.0.0.1:${server.port}/?peer=host`);
    await guest.goto(`http://127.0.0.1:${mobile.address().port}`);
    await guest.locator('#join-peer-btn').click();
    await host.locator('#color-mode').selectOption('black');
    await host.locator('#create-btn').click();
    for (const page of [host, guest]) {
      await page.locator('#peer-advanced > summary').click();
      await page.locator('#peer-method').selectOption('manual');
    }
    assert.equal(await host.locator('#peer-use-relay').isDisabled(), true);
    await host.locator('#peer-generate').click();
    await host.waitForFunction(() => document.getElementById('peer-outgoing').value.startsWith('KAMISADO1.'));
    assert.equal(await host.evaluate(() => testPeers[0].config.iceServers.every(s => [].concat(s.urls).every(u => u.startsWith('stun:')))), true,
      'The first attempt must never contact a TURN service');
    // Trigger the same browser event that a failed Internet path produces.
    await host.evaluate(() => {
      const peer = testPeers.at(-1).peer;
      Object.defineProperty(peer, 'connectionState', { value: 'failed' });
      peer.dispatchEvent(new Event('connectionstatechange'));
    });
    assert.equal(await host.locator('#peer-use-relay').isEnabled(), true);
    await host.locator('#peer-use-relay').check();
    await host.locator('#peer-generate').click();
    assert.match(await host.locator('#peer-status').textContent(), /TURN addresses/);
    assert.equal(await host.evaluate(() => testPeers.length), 1, 'Missing credentials must not create a new connection');
    const fill = async page => {
      await page.locator('#peer-relay-urls').fill(urls);
      await page.locator('#peer-relay-username').fill(username);
      await page.locator('#peer-relay-password').fill(password);
    };
    await fill(host);
    await host.locator('#peer-relay-password').fill('intentionally-invalid-test-credential');
    await host.locator('#peer-generate').click();
    await host.waitForFunction(() => document.getElementById('peer-status').textContent.includes('The relay did not provide an address'));
    assert.equal(await host.locator('#peer-outgoing').inputValue(), '', 'Rejected relay credentials must not produce an unusable code');
    await host.locator('#peer-relay-password').fill(password);
    await host.locator('#peer-generate').click();
    await host.waitForFunction(() => document.getElementById('peer-outgoing').value.startsWith('KAMISADO1.'));
    const offer = await host.locator('#peer-outgoing').inputValue();
    const decode = code => JSON.parse(Buffer.from(code.slice('KAMISADO1.'.length), 'base64url').toString('utf8'));
    assert.equal(decode(offer).relay, true);
    await guest.locator('#peer-incoming').fill(offer);
    await guest.locator('#peer-relay > summary').click();
    assert.equal(await guest.locator('#peer-use-relay').isEnabled(), true, 'A relay invitation unlocks fallback for the guest');
    await guest.locator('#peer-use-relay').check();
    await fill(guest);
    await guest.locator('#peer-generate').click();
    await guest.waitForFunction(() => document.getElementById('peer-outgoing').value.startsWith('KAMISADO1.'));
    const answer = await guest.locator('#peer-outgoing').inputValue();
    for (const code of [offer, answer]) {
      const raw = JSON.stringify(decode(code));
      assert.equal(raw.includes(password), false, 'Signaling must not contain relay passwords');
      assert.equal(raw.includes(username), false, 'Signaling must not contain relay usernames');
      assert.match(decode(code).sdp, / typ relay/);
      assert.doesNotMatch(decode(code).sdp, / typ (host|srflx)/, 'Explicit fallback must actually use relay-only ICE');
    }
    await host.locator('#peer-incoming').fill(answer);
    await host.locator('#peer-connect').click();
    await guest.locator('#game-screen').waitFor();
    for (const page of [host, guest]) {
      await page.waitForFunction(() => document.getElementById('peer-status').textContent.includes('Connected through an encrypted relay'));
      assert.equal(await page.evaluate(secret => JSON.stringify({ ...localStorage, ...sessionStorage }).includes(secret), password), false);
    }
    await host.locator('.cell[data-r="0"][data-c="0"]').click();
    await host.locator('.cell[data-r="1"][data-c="0"]').click();
    await guest.locator('.cell[data-r="1"][data-c="0"] .piece.black').waitFor();
    await guest.locator('.cell[data-r="7"][data-c="2"]').tap();
    await guest.locator('.cell[data-r="6"][data-c="2"]').tap();
    await host.locator('.cell[data-r="6"][data-c="2"] .piece.white').waitFor();
    assert.deepEqual(errors, []);
    console.log('TURN fallback passed: direct first, explicit retry, private credentials, actual relayed connection, desktop/mobile moves.');
  } finally {
    await browser?.close();
    await new Promise(resolve => mobile.close(resolve));
    await server.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
