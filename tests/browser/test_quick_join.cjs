const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { ExpressPeerServer } = require('peer');
const { chromium, webkit } = require('playwright');
const { startServer } = require('../../dist/server/index.js');

const relay = process.env.KAMISADO_TEST_TURN_URL ? {
  urls: process.env.KAMISADO_TEST_TURN_URL,
  username: process.env.KAMISADO_TEST_TURN_USER,
  password: process.env.KAMISADO_TEST_TURN_PASSWORD,
} : null;
const relayDirect = process.env.KAMISADO_TEST_TURN_DIRECT;
const generateRelay = process.env.KAMISADO_TEST_TURN_GENERATE === '1';

async function configureRelay(page) {
  await page.locator('#peer-relay').evaluate(panel => { panel.open = true; });
  await page.locator('#peer-use-relay').check();
  await page.locator('#peer-relay-import').evaluate(input => { input.closest('details').open = true; });
  await page.locator('#peer-relay-import').fill(JSON.stringify([
    { urls: 'stun:example.invalid' },
    { urls: relay.urls.trim().split(/\s+/), username: relay.username, credential: relay.password },
  ]));
  await page.locator('#peer-relay-import-btn').click();
  assert.equal(await page.locator('#peer-relay-import').inputValue(), '');
  assert.equal(await page.locator('#peer-relay-username').inputValue(), relay.username);
  assert.equal(await page.locator('#peer-relay-password').inputValue(), relay.password);
}

async function run() {
  if (relay) assert(relay.username && relay.password, 'TURN test requires KAMISADO_TEST_TURN_USER and KAMISADO_TEST_TURN_PASSWORD');
  if (relayDirect) assert(relay && ['host', 'guest'].includes(relayDirect));
  const engine = process.env.MOBILE_BROWSER === 'webkit' ? webkit : chromium;
  const screenshots = path.resolve(__dirname, '../../out/quick-checks');
  await fs.mkdir(screenshots, { recursive: true });
  const game = await startServer({ port: 0, host: '127.0.0.1' });
  const app = express();
  const server = http.createServer(app);
  const signaling = ExpressPeerServer(server, { path: '/', key: 'kamisado-test', allow_discovery: false });
  app.use('/signal', signaling);
  app.use(express.static(path.resolve(__dirname, '../../out/mobile')));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const mobileOrigin = `http://127.0.0.1:${server.address().port}`;
  const gameOrigin = `http://127.0.0.1:${game.port}`;
  let browser;
  try {
    browser = await engine.launch({ headless: true });
    const errors = [];
    const frames = [];
    for (const mobileHosts of [false, true]) {
      const signalingSockets = [];
      const hostContext = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
      const guestContext = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
      if (generateRelay) await hostContext.addInitScript(relay => {
        window.generatedTurnRequests = [];
        window.__KAMISADO_CREATE_TURN__ = async request => {
          window.generatedTurnRequests.push(request);
          return { server: { urls: relay.urls.trim().split(/\s+/), username: relay.username, credential: relay.password },
            expiresAt: Date.now() + request.lifetimeSeconds * 1000, readyAt: Date.now() + 7000 };
        };
      }, relay);
      for (const context of [hostContext, guestContext]) await context.addInitScript(config => {
        window.__KAMISADO_SIGNALING__ = config;
        window.__KAMISADO_SHARE__ = async link => { window.lastSharedLink = link; return 'shared'; };
        const Native = RTCPeerConnection;
        window.testPeers = [];
        window.RTCPeerConnection = class extends Native {
          constructor(config) {
            super({ ...config, iceServers: config?.iceTransportPolicy === 'relay' ? config.iceServers : [] });
            window.testPeers.push({ peer: this, config });
          }
          addIceCandidate(candidate) {
            // Simulate two networks that cannot exchange direct packets while leaving TURN real.
            if (window.blockDirect && this.getConfiguration().iceTransportPolicy !== 'relay') return Promise.resolve();
            return super.addIceCandidate(candidate);
          }
        };
        const send = RTCDataChannel.prototype.send;
        RTCDataChannel.prototype.send = function(data) {
          if (window.tamperProof && typeof data === 'string' && data.includes('kamisado-auth')) {
            const frame = JSON.parse(data);
            frame.proof = (frame.proof[0] === 'A' ? 'B' : 'A') + frame.proof.slice(1);
            return send.call(this, JSON.stringify(frame));
          }
          return send.call(this, data);
        };
      }, { host: '127.0.0.1', port: server.address().port, path: '/signal', secure: false, key: 'kamisado-test' });
      const host = await hostContext.newPage();
      const guest = await guestContext.newPage();
      for (const page of [host, guest]) {
        page.setDefaultTimeout(15000);
        page.on('pageerror', e => errors.push(e.message));
        page.on('websocket', socket => {
          socket.on('framesent', frame => frames.push(String(frame.payload)));
          if (new URL(socket.url()).pathname.startsWith('/signal/')) signalingSockets.push(socket);
        });
      }
      await host.goto(mobileHosts ? mobileOrigin : gameOrigin + '/?peer=host');
      await guest.goto(mobileHosts ? gameOrigin + '/?peer=guest' : mobileOrigin);
      if (!mobileHosts) await guest.locator('#join-peer-btn').click();
      assert.equal(await host.locator('#peer-panel').isVisible(), false, 'Settings precede invitation controls');
      assert.equal(await host.locator('#peer-steps').isVisible(), false, 'Manual signaling stays out of the quick flow');
      assert.equal(await host.locator('#peer-use-relay').isEnabled(), true);
      await host.locator('#color-mode').selectOption('black');
      if (generateRelay) {
        await host.locator('#turn-provider > summary').click();
        await host.locator('#turn-provider-enabled').check();
        await host.locator('#turn-provider-domain').fill('test.metered.live');
        await host.locator('#turn-provider-secret').fill('host-account-secret-test-only');
        await host.locator('#turn-provider-lifetime').selectOption('7200');
      }
      await host.locator('#create-btn').click();
      await host.locator('#game-screen').waitFor();
      if (generateRelay) {
        host.on('dialog', dialog => dialog.accept());
        await host.locator('#cancel-game-btn').click();
        await host.locator('#create-btn').click();
        await host.locator('#game-screen').waitFor();
        assert.equal(await host.evaluate(() => generatedTurnRequests.length), 2, 'Every new multiplayer game requests fresh credentials');
      }
      assert.equal(await host.locator('#board-container').isVisible(), false, 'desktop and mobile hosts wait without a board');
      assert.equal(await host.locator('#board-options').isVisible(), false);
      assert.equal(await host.locator('#peer-relay-mode').isVisible(), true, 'Connection choice is visible before opening relay settings');
      assert.match(await host.locator('#peer-relay-readiness').textContent(), generateRelay ? /Access expires at/ : /P2P only until/);
      if (generateRelay) assert.equal(await host.evaluate(() => generatedTurnRequests[0].lifetimeSeconds), 7200);
      if (relay) {
        if (!generateRelay) await configureRelay(host);
        if (relayDirect) await (relayDirect === 'host' ? host : guest).locator('#peer-relay-mode').selectOption('always');
      }
      await host.locator('#peer-quick-share').click();
      await host.waitForFunction(prefix => document.getElementById('peer-quick-outgoing').value.startsWith(prefix),
        relay ? 'kamisado://join/K3.' : 'kamisado://join/K2.');
      const first = await host.locator('#peer-quick-outgoing').inputValue();
      if (!relay) assert.equal(first.length, 'kamisado://join/'.length + 25);
      if (generateRelay) assert.equal(Buffer.from(first.split('K3.')[1], 'base64url').toString().includes('host-account-secret'), false);
      await host.waitForFunction(link => window.lastSharedLink === link, first);
      await host.screenshot({ path: path.join(screenshots, `${engine.name()}-${mobileHosts ? 'mobile' : 'desktop'}-invitation.png`), fullPage: true });
      await host.locator('#peer-relay').evaluate(panel => { panel.open = true; });
      await host.locator('#peer-use-relay').uncheck();
      assert.equal(await host.locator('#peer-quick-outgoing').inputValue(), '',
        'Changing relay settings must close the previous invitation and its standby registration');
      await host.locator('#peer-use-relay').check();
      if (relayDirect === 'host') await host.locator('#peer-relay-mode').selectOption('always');
      await host.locator('#peer-quick-create').click();
      await host.waitForFunction(old => document.getElementById('peer-quick-outgoing').value.length > 0 && document.getElementById('peer-quick-outgoing').value !== old, first);
      let invitation = await host.locator('#peer-quick-outgoing').inputValue();
      if (relay) {
        const expired = JSON.parse(Buffer.from(invitation.split('K3.')[1], 'base64url').toString());
        expired.expiresAt = Date.now() - 1000;
        delete expired.readyAt;
        await guest.locator('#peer-quick-incoming').fill('kamisado://join/K3.' + Buffer.from(JSON.stringify(expired)).toString('base64url'));
        await guest.locator('#peer-quick-join').click();
        await guest.waitForFunction(() => document.getElementById('peer-status').textContent.includes('relay access has expired'));
        assert.equal(await guest.locator('#game-screen').isVisible(), false);
      }
      await guest.locator('#peer-quick-incoming').fill(first);
      if (relay) {
        assert.equal(await guest.locator('#peer-relay-password').inputValue(), '', 'Guest never types or displays the shared credential');
        assert.equal(await guest.locator('#peer-relay-fields').isVisible(), false);
        assert.match(await guest.locator('#peer-relay-readiness').textContent(), /supplied by the host/);
      }
      if (relayDirect === 'host') {
        assert.equal(await guest.locator('#peer-relay-mode').inputValue(), 'always', 'Invitation overrides the guest P2P-first choice');
        assert.equal(await guest.locator('#peer-relay-mode').isDisabled(), true);
        assert.equal(await guest.locator('#peer-use-relay').isChecked(), true);
        assert.match(await guest.locator('#peer-relay-help').textContent(), /invitation selects this automatically/);
      }
      await guest.locator('#peer-quick-join').click();
      await guest.waitForFunction(() => /no longer available|TURN.*unavailable/.test(document.getElementById('peer-status').textContent));
      assert.equal(await guest.locator('#game-screen').isVisible(), false);
      await guest.locator('#peer-quick-incoming').fill(invitation);
      await guest.evaluate(() => window.tamperProof = true);
      await guest.locator('#peer-quick-join').click();
      await host.waitForFunction(() => !document.getElementById('peer-use-relay').disabled);
      await guest.waitForFunction(() => !document.getElementById('peer-quick-join').disabled);
      assert.equal(await guest.locator('#game-screen').isVisible(), false, 'Unauthenticated callers must not join the game');
      assert.equal(await host.locator('#peer-quick-outgoing').inputValue(), invitation, 'A bad proof must not destroy the host invitation');
      const directInvitation = invitation;
      if (relay) {
        for (const page of [host, guest]) {
          if (!relayDirect) assert.equal(await page.evaluate(() => testPeers.some(({ config }) => config?.iceTransportPolicy === 'relay')), false,
            'Neither standby signaling nor a rejected authentication should allocate TURN');
          await page.evaluate(() => window.blockDirect = true);
        }
      }
      await guest.evaluate(() => window.tamperProof = false);
      if (relayDirect === 'guest') await guest.locator('#peer-quick-join').click();
      else {
        if (relay) await guestContext.addInitScript(() => { window.blockDirect = true; });
        await guest.goto((mobileHosts ? gameOrigin : mobileOrigin) + '/?peer=guest#' + invitation.slice('kamisado://join/'.length));
        await guest.waitForFunction(() => !location.hash);
      }
      await guest.locator('#game-screen').waitFor({ timeout: 60000 });
      assert.equal(await host.locator('#peer-quick-outgoing').inputValue(), directInvitation,
        'Automatic fallback preserves the shared invitation');
      for (const page of [host, guest]) await page.waitForFunction(expected =>
        document.getElementById('peer-status').textContent.includes(expected), relay ? 'Connected through an encrypted relay' : 'Connected directly');
      for (const code of [first, directInvitation, invitation]) {
        assert.equal(JSON.stringify(frames).includes(code.split('.')[1]), false, 'The invitation secret must not travel through signaling');
      }
      if (relay) {
        assert.equal(JSON.stringify(frames).includes(relay.password), false, 'Shared TURN password must not travel through signaling');
        const payload = JSON.parse(Buffer.from(invitation.split('K3.')[1], 'base64url').toString());
        assert.equal(JSON.stringify(frames).includes(payload.invitation.split('.')[1]), false, 'Inner invitation secret must not travel through signaling');
      }
      assert(signalingSockets.length >= 2, 'Both players must register with the signaling service');
      await Promise.all(signalingSockets.filter(socket => !socket.isClosed())
        .map(socket => socket.waitForEvent('close', { timeout: 15000 })));
      assert(signalingSockets.every(socket => socket.isClosed()), 'Signaling must disconnect before game moves are exchanged');
      for (const page of [host, guest]) {
        // PeerJS also constructs and immediately closes a capability probe without gathering ICE.
        const configurations = await page.evaluate(() => testPeers.filter(({config}) => config?.bundlePolicy === 'max-bundle').map(({config}) => config));
        const directConfigurations = configurations.filter(config => config.iceTransportPolicy !== 'relay');
        if (relayDirect) assert.equal(directConfigurations.length, 0, 'TURN directly must not create a direct P2P connection');
        else assert(directConfigurations.length > 0, 'Each player must attempt direct P2P before the relay fallback');
        assert(directConfigurations.every(config => config.iceServers.every(server => [].concat(server.urls).every(url => url.startsWith('stun:')))),
          'PeerJS default TURN servers must never enter the direct configuration');
        if (relay) {
          const connected = configurations.at(-1);
          assert.equal(connected.iceTransportPolicy, 'relay');
          assert.deepEqual(connected.iceServers, [{ urls: relay.urls.trim().split(/\s+/), username: relay.username, credential: relay.password }]);
          assert.equal(await page.evaluate(secret => JSON.stringify({ ...localStorage, ...sessionStorage }).includes(secret), relay.password), false);
        } else assert.equal(configurations.some(config => config.iceTransportPolicy === 'relay'), false, 'The normal quick flow must not allocate a relay');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
      await host.locator('.cell[data-r="0"][data-c="0"]').tap();
      await host.locator('.cell[data-r="1"][data-c="0"]').tap();
      await guest.locator('.cell[data-r="1"][data-c="0"] .piece.black').waitFor();
      await host.evaluate(() => {
        const peer = testPeers.at(-1).peer;
        Object.defineProperty(peer, 'connectionState', { configurable: true, value: 'disconnected' });
        peer.dispatchEvent(new Event('connectionstatechange'));
      });
      assert.equal(await host.evaluate(() => testPeers.at(-1).peer.signalingState === 'closed'), false,
        'A temporary disconnection must preserve the automatic channel for recovery');
      await host.evaluate(() => {
        const peer = testPeers.at(-1).peer;
        delete peer.connectionState;
        peer.dispatchEvent(new Event('connectionstatechange'));
      });
      await guest.locator('.cell[data-r="7"][data-c="2"]').tap();
      await guest.locator('.cell[data-r="6"][data-c="2"]').tap();
      await host.locator('.cell[data-r="6"][data-c="2"] .piece.white').waitFor();
      await host.screenshot({ path: path.join(screenshots, `${engine.name()}-${mobileHosts ? 'mobile' : 'desktop'}-game.png`), fullPage: true });
      await hostContext.close();
      await guestContext.close();
    }
    assert.deepEqual(errors, []);
    console.log(`Quick join passed: one invitation, real PeerServer/WebRTC, desktop/mobile hosting, proof rejection, ${relayDirect ? 'TURN directly (' + relayDirect + ')' : relay ? 'automatic TURN fallback' : 'no TURN by default'}, signaling disconnected before moves, and transient recovery.`);
  } finally {
    await browser?.close();
    await game.close();
    await new Promise(resolve => server.close(resolve));
  }
}
// PeerServer 1.0.2 has housekeeping timers without a public stop method. Exit only after cleanup.
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
