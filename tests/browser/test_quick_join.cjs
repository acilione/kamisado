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

async function configureRelay(page) {
  await page.locator('#peer-relay').evaluate(panel => { panel.open = true; });
  await page.locator('#peer-use-relay').check();
  await page.locator('#peer-relay-urls').fill(relay.urls);
  await page.locator('#peer-relay-username').fill(relay.username);
  await page.locator('#peer-relay-password').fill(relay.password);
}

async function run() {
  if (relay) assert(relay.username && relay.password, 'TURN test requires KAMISADO_TEST_TURN_USER and KAMISADO_TEST_TURN_PASSWORD');
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
      assert.equal(await host.locator('#peer-use-relay').isDisabled(), true);
      await host.locator('#color-mode').selectOption('black');
      await host.locator('#create-btn').click();
      await host.locator('#peer-quick-share').click();
      await host.waitForFunction(() => document.getElementById('peer-quick-outgoing').value.startsWith('kamisado://join/K2.'));
      const first = await host.locator('#peer-quick-outgoing').inputValue();
      assert.equal(first.length, 'kamisado://join/'.length + 25);
      await host.waitForFunction(link => window.lastSharedLink === link, first);
      await host.screenshot({ path: path.join(screenshots, `${engine.name()}-${mobileHosts ? 'mobile' : 'desktop'}-invitation.png`), fullPage: true });
      await host.locator('#peer-quick-create').click();
      await host.waitForFunction(old => document.getElementById('peer-quick-outgoing').value.length > 0 && document.getElementById('peer-quick-outgoing').value !== old, first);
      let invitation = await host.locator('#peer-quick-outgoing').inputValue();
      await guest.locator('#peer-quick-incoming').fill(first);
      await guest.locator('#peer-quick-join').click();
      await guest.waitForFunction(() => document.getElementById('peer-status').textContent.includes('no longer available'));
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
        await configureRelay(host);
        await host.locator('#peer-quick-create').click();
        await host.waitForFunction(() => document.getElementById('peer-quick-outgoing').value.startsWith('kamisado://join/K2R.'));
        invitation = await host.locator('#peer-quick-outgoing').inputValue();
        assert.notEqual(invitation.split('.')[1], directInvitation.split('.')[1], 'Relay retry must use a fresh invitation secret');
        await guest.locator('#peer-quick-incoming').fill(invitation);
        await configureRelay(guest);
      }
      await guest.evaluate(() => window.tamperProof = false);
      if (relay) await guest.locator('#peer-quick-join').click();
      else {
        await guest.goto((mobileHosts ? gameOrigin : mobileOrigin) + '/?peer=guest#' + invitation.slice('kamisado://join/'.length));
        await guest.waitForFunction(() => !location.hash);
      }
      await guest.locator('#game-screen').waitFor();
      for (const page of [host, guest]) await page.waitForFunction(expected =>
        document.getElementById('peer-status').textContent.includes(expected), relay ? 'Connected through an encrypted relay' : 'Connected directly');
      for (const code of [first, directInvitation, invitation]) {
        assert.equal(JSON.stringify(frames).includes(code.split('.')[1]), false, 'The invitation secret must not travel through signaling');
      }
      assert(signalingSockets.length >= 2, 'Both players must register with the signaling service');
      await Promise.all(signalingSockets.filter(socket => !socket.isClosed())
        .map(socket => socket.waitForEvent('close', { timeout: 15000 })));
      assert(signalingSockets.every(socket => socket.isClosed()), 'Signaling must disconnect before game moves are exchanged');
      for (const page of [host, guest]) {
        // PeerJS also constructs and immediately closes a capability probe without gathering ICE.
        const configurations = await page.evaluate(() => testPeers.filter(({config}) => config?.bundlePolicy === 'max-bundle').map(({config}) => config));
        const directConfigurations = configurations.filter(config => config.iceTransportPolicy !== 'relay');
        assert(directConfigurations.length > 0, 'Each player must attempt direct P2P before the relay fallback');
        assert(directConfigurations.every(config => config.iceServers.every(server => [].concat(server.urls).every(url => url.startsWith('stun:')))),
          'PeerJS default TURN servers must never enter the direct configuration');
        if (relay) {
          const connected = configurations.at(-1);
          assert.equal(connected.iceTransportPolicy, 'relay');
          assert.deepEqual(connected.iceServers, [{ urls: relay.urls.trim().split(/\s+/), username: relay.username, credential: relay.password }]);
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
    console.log(`Quick join passed: one invitation, real PeerServer/WebRTC, desktop/mobile hosting, proof rejection, ${relay ? 'explicit TURN fallback' : 'no TURN by default'}, signaling disconnected before moves, and transient recovery.`);
  } finally {
    await browser?.close();
    await game.close();
    await new Promise(resolve => server.close(resolve));
  }
}
// PeerServer 1.0.2 has housekeeping timers without a public stop method. Exit only after cleanup.
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
