'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron, chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const productName = require('../package.json').productName;
const executable = process.env.KAMISADO_PACKAGED_EXECUTABLE || path.join(
  root, 'out', `${productName}-${process.platform}-${process.arch}`,
  process.platform === 'darwin' ? `${productName}.app/Contents/MacOS/${productName}` : `${productName}${process.platform === 'win32' ? '.exe' : ''}`,
);

async function bounded(promise, milliseconds, stage) {
  let timeout;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`Timed out: ${stage}`)), milliseconds);
    })]);
  } finally { clearTimeout(timeout); }
}

async function canConnect(port) {
  return new Promise(resolve => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const done = connected => { socket.destroy(); resolve(connected); };
    socket.setTimeout(1000, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

async function assertPortClosed(port, message) {
  const deadline = Date.now() + 3000;
  while (await canConnect(port)) {
    if (Date.now() >= deadline) {
      if (process.platform === 'win32') {
        const rows = require('node:child_process').execFileSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true });
        console.error('Remaining TCP listeners:', rows.split('\n').filter(row => row.includes(`:${port} `) && row.includes('LISTENING')).join('\n'));
      }
      assert.fail(`${message} (port ${port} still accepts TCP connections)`);
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

function useLocalIceCandidates() {
  // Exercise real packaged WebRTC and its iframe permissions without depending on public STUN.
  const NativeConnection = window.RTCPeerConnection;
  window.__packagedPeerConnections = [];
  window.RTCPeerConnection = class extends NativeConnection {
    constructor(configuration) {
      super({ ...configuration, iceServers: [] });
      window.__packagedPeerConnections.push(this);
    }
  };
}

async function peerDiagnostics() {
  const peers = [];
  for (const peer of window.__packagedPeerConnections || []) {
    const stats = await peer.getStats();
    peers.push({ connection: peer.connectionState, ice: peer.iceConnectionState,
      gathering: peer.iceGatheringState, signaling: peer.signalingState,
      candidates: [...stats.values()].filter(stat => ['candidate-pair', 'local-candidate', 'remote-candidate'].includes(stat.type)).map(stat => ({
        type: stat.type, state: stat.state, nominated: stat.nominated, protocol: stat.protocol,
        candidateType: stat.candidateType, address: stat.address, port: stat.port,
        bytesSent: stat.bytesSent, bytesReceived: stat.bytesReceived,
      })),
    });
  }
  return { url: location.href, status: document.getElementById('peer-status')?.textContent, peers };
}

async function main() {
  await fs.access(executable);
  if (process.platform !== 'darwin') {
    const guide = await fs.readFile(path.join(path.dirname(executable), 'START-HERE.txt'), 'utf8');
    assert.match(guide, /Share link/);
    assert.match(guide, /Host a LAN game/);
  }
  const screenshots = path.join(root, 'out/browser-checks');
  await fs.mkdir(screenshots, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'kamisado-packaged-'));
  const occupied = net.createServer(socket => socket.destroy());
  const occupiedLoopback = net.createServer(socket => socket.destroy());
  let app;
  let appProcess;
  let shell;
  let browser;
  let activePeerGuest;
  const watchdog = setTimeout(() => {
    console.error('Packaged smoke exceeded its three-minute deadline.');
    appProcess?.kill('SIGKILL');
    process.exit(1);
  }, 180000);
  try {
    await new Promise((resolve, reject) => {
      occupied.once('error', reject);
      occupied.listen(0, '0.0.0.0', resolve);
    });
    const occupiedPort = occupied.address().port;
    // Windows permits a wildcard and a loopback listener to share a port.
    // Reserve both scopes so LAN and local-only modes really hit EADDRINUSE,
    // and our reservation cannot be mistaken for a game listener after Stop.
    await new Promise((resolve, reject) => {
      occupiedLoopback.once('error', error => error.code === 'EADDRINUSE' ? resolve() : reject(error));
      occupiedLoopback.listen(occupiedPort, '127.0.0.1', resolve);
    });
    const env = { ...process.env, KAMISADO_DESKTOP_PORT: String(occupiedPort), KAMISADO_USER_DATA_DIR: profile };
    delete env.ELECTRON_RUN_AS_NODE;
    console.log('Packaged smoke: launching ' + executable);
    app = await electron.launch({ executablePath: executable, env, chromiumSandbox: true, timeout: 30000 });
    appProcess = app.process();
    shell = await app.firstWindow();
    shell.setDefaultTimeout(15000);
    const errors = [];
    const requests = new Set();
    shell.on('request', request => requests.add(request.url()));
    shell.on('pageerror', error => errors.push(error.message));
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), true, 'must test the packaged app');
    assert.equal(await app.evaluate(() => process.versions.electron), require('../package.json').devDependencies.electron, 'packaged runtime must match the pinned Electron version');
    await shell.frameLocator('#game-frame').locator('#create-btn').waitFor();
    await shell.frameLocator('#game-frame').locator('#join-peer-btn').waitFor();
    assert.equal(await shell.frameLocator('#game-frame').locator('#play-computer-btn').isVisible(), true, 'Game settings precede both play actions');
    assert.equal(await shell.frameLocator('#game-frame').locator('#join-peer-btn').isVisible(), true, 'Joining is available from the settings menu');
    await shell.locator('#hosting-settings').click();
    await shell.locator('#lan-button').waitFor({ state: 'visible' });
    assert.equal(await shell.locator('#join-invitation').isVisible(), true, 'a LAN guest can paste a complete invitation');
    assert.equal(await shell.locator('#online-button').isVisible(), false, 'the optional ngrok relay stays inside connection options');
    const initial = await shell.evaluate(() => window.kamisadoDesktop.getState());
    assert.equal(initial.status, 'ready');
    assert.equal(initial.localOnly, false, 'initial game settings prepare the reusable network server');
    assert.equal(initial.connectivity.mode, 'direct', 'opening settings must not start an Internet tunnel');

    console.log('Packaged smoke: waiting for host window to show');
    await bounded(app.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window.isVisible()) await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Host window did not become visible')), 10000);
        window.once('show', () => { clearTimeout(timeout); resolve(); });
      });
    }), 12000, 'show host window');
    await shell.waitForFunction(() => document.visibilityState === 'visible' && innerWidth > 0 && innerHeight > 0);
    console.log('Packaged smoke: capture launcher');
    await shell.screenshot({ path: path.join(screenshots, 'packaged-launcher.png') });
    console.log('Packaged smoke: load packaged ngrok native module');
    const nativeSdk = await bounded(app.evaluate(({ app }) => {
      const packagedRequire = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
      return typeof packagedRequire('@ngrok/ngrok').forward;
    }), 15000, 'load packaged ngrok module');
    assert.equal(nativeSdk, 'function', 'packaged ngrok native dependency must load without contacting the Internet');
    console.log('Packaged smoke: start LAN hosting');
    await shell.locator('#lan-button').click();
    const host = shell.frameLocator('#game-frame');
    await host.locator('#create-btn').waitFor({ state: 'visible' });
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1, 'hosting and game stay in one window');
    const state = await shell.evaluate(() => window.kamisadoDesktop.getState());
    assert.equal(state.status, 'ready');
    assert.notEqual(state.port, occupiedPort, 'occupied preferred port must fall back to a free port');
    assert.equal(await canConnect(state.port), true);

    console.log('Packaged smoke: create room and invitation');
    await host.locator('#color-mode').selectOption('black');
    await host.locator('#create-btn').click();
    await host.locator('#share-link').waitFor({ state: 'visible' });
    const invitation = await host.locator('#share-link').inputValue();
    assert.equal(new URL(invitation).origin, state.connectivity.publicOrigin, 'invitation must use the current advertised address');
    assert.match(new URL(invitation).pathname, /^\/game\/[a-f0-9]{12}$/i);
    await host.locator('#share-qr').waitFor({ state: 'visible' });
    assert.equal(await host.locator('#share-qr').evaluate(canvas => canvas.width > 0 && canvas.height > 0), true);

    await shell.screenshot({ path: path.join(screenshots, 'packaged-invitation.png') });
    assert.equal(await host.locator('#board-container').isVisible(), false, 'the lobby must show invitations without the board');

    console.log('Packaged smoke: reconfigure invitation without reloading the room');
    const gameDocument = shell.frames().find(frame => frame.url().startsWith(state.localOrigin + '/'));
    assert.ok(gameDocument, 'the embedded game frame must be loaded');
    await host.locator('body').evaluate(body => { body.dataset.packagedSmokeMarker = 'same-room'; });
    await shell.locator('#hosting-settings').click();
    await shell.locator('#advanced-options > summary').click();
    await shell.locator('#advertised-origin').fill(state.localOrigin);
    await shell.locator('#lan-button').click();
    await host.locator('#share-link').waitFor({ state: 'visible' });
    await gameDocument.waitForFunction(expectedOrigin => {
      const invitation = document.getElementById('share-link');
      return invitation && new URL(invitation.value).origin === expectedOrigin;
    }, state.localOrigin, { timeout: 15000 });
    const reconfigured = await shell.evaluate(() => window.kamisadoDesktop.getState());
    assert.equal(reconfigured.status, 'ready');
    assert.equal(reconfigured.port, state.port, 'reconfiguring must preserve the server and room');
    assert.equal(reconfigured.connectivity.publicOrigin, state.localOrigin);
    assert.equal(await host.locator('body').getAttribute('data-packaged-smoke-marker'), 'same-room', 'connection changes must preserve the iframe document');
    const updatedInvitation = await host.locator('#share-link').inputValue();
    assert.equal(new URL(updatedInvitation).pathname, new URL(invitation).pathname, 'reconfiguring must preserve the room ID');
    assert.equal(new URL(updatedInvitation).origin, state.localOrigin, 'existing invitations must reflect the changed address');

    console.log('Packaged smoke: join from guest browser and move');
    browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
      headless: true,
    });
    const guest = await browser.newPage();
    guest.on('pageerror', error => errors.push(error.message));
    guest.on('request', request => requests.add(request.url()));
    await guest.goto(invitation);
    await guest.locator('#board .cell').first().waitFor({ state: 'visible' });
    await host.locator('#turn-indicator').filter({ hasText: /Turn: BLACK/i }).waitFor({ state: 'visible' });
    assert.equal(await guest.locator('#board .cell').count(), 64, 'guest must load the bundled game from the invitation');
    console.log('Packaged smoke: render board modes and symbols');
    await host.locator('#game-board-view').selectOption('realistic-2d');
    await host.locator('#game-symbol-mode').check();
    assert.equal(await host.locator('#board .square-symbol').count(), 128, 'realistic symbol board must load its two markings per square');
    await host.locator('#game-board-view').selectOption('realistic-3d');
    await host.locator('#board-3d canvas:visible, #board:visible .realistic-tower').first().waitFor({ state: 'visible' });
    await shell.screenshot({ path: path.join(screenshots, 'packaged-board.png') });
    await host.locator('#game-board-view').selectOption('realistic-2d');
    await host.locator('.cell[data-r="0"][data-c="0"]').click();
    await host.locator('.cell[data-r="1"][data-c="0"]').click();
    await guest.locator('.cell[data-r="1"][data-c="0"] .piece.black').waitFor({ state: 'visible' });

    console.log('Packaged smoke: stop hosting and verify listener closes');
    await shell.locator('#hosting-settings').click();
    // The temporary loopback override refers to this server's port; restore automatic LAN selection for restart.
    await shell.locator('#advertised-origin').fill('');
    await shell.locator('#stop-hosting').click();
    await shell.locator('#confirm-stop').click();
    // This action is hidden throughout an active LAN session and appears after Stop completes.
    await shell.locator('#peer-host-button').waitFor({ state: 'visible' });
    await assertPortClosed(state.port, 'Stop must close the HTTP and Socket.IO listener');
    await guest.locator('#connection-notice').filter({ hasText: 'The host stopped this game.' }).waitFor({ state: 'visible' });
    assert.equal(await guest.locator('.cell.playable, .cell.selected, .cell.valid-move').count(), 0, 'stopped guests must not see playable moves');
    assert.equal((await shell.evaluate(() => window.kamisadoDesktop.getState())).status, 'idle');

    console.log('Packaged smoke: restart hosting');
    await shell.locator('#lan-button').click();
    await shell.frameLocator('#game-frame').locator('#create-btn').waitFor({ state: 'visible' });
    const restarted = await shell.evaluate(() => window.kamisadoDesktop.getState());
    assert.equal(restarted.status, 'ready', 'hosting can restart without relaunching the app');
    assert.equal(await canConnect(restarted.port), true);
    await shell.frameLocator('#game-frame').locator('#create-btn').click();
    await shell.frameLocator('#game-frame').locator('#share-link').waitFor({ state: 'visible' });
    const freshInvitation = await shell.frameLocator('#game-frame').locator('#share-link').inputValue();
    assert.equal(new URL(freshInvitation).origin, restarted.connectivity.publicOrigin);
    assert.notEqual(new URL(freshInvitation).pathname, new URL(invitation).pathname, 'restarting creates a new room');

    console.log('Packaged smoke: end LAN hosting and enter both direct Internet flows');
    await shell.locator('#hosting-settings').click();
    await shell.locator('#stop-hosting').click();
    await shell.locator('#confirm-stop').click();
    await shell.locator('#computer-button').waitFor({ state: 'visible' });
    await assertPortClosed(restarted.port, 'Ending LAN hosting must release its port');
    const peerOrigins = [];
    await shell.context().addInitScript(useLocalIceCandidates);
    for (const [button, role] of [['#peer-host-button', 'host'], ['#peer-join-button', 'guest']]) {
      await shell.locator(button).click();
      const peerPage = shell.frameLocator('#game-frame');
      await peerPage.locator(role === 'host' ? '#create-btn' : '#peer-panel').waitFor({ state: 'visible' });
      assert.equal(await peerPage.locator('#peer-title').textContent(), role === 'host' ? 'Host an Internet game' : 'Join an Internet game');
      assert.equal(await peerPage.locator('#peer-generate').isDisabled(), true, 'codes require a created game or a pasted invitation');
      assert.equal(await peerPage.locator('#peer-outgoing').inputValue(), '', 'starting a peer session must not contact STUN or generate a code automatically');
        assert.match(await peerPage.locator('#peer-code-help').textContent(), /Keep both apps open/);
      const peer = await shell.evaluate(() => window.kamisadoDesktop.getState());
      assert.equal(peer.status, 'ready');
      assert.equal(peer.localOnly, true, 'the bundled peer page must only listen on loopback');
      assert.equal(peer.peerMode, role);
      assert.deepEqual(peer.connectivity.reachableOrigins, [peer.localOrigin]);
      assert.equal(new URL(await shell.locator('#game-frame').getAttribute('src')).searchParams.get('peer'), role);
      assert.equal(await shell.locator('#connection-label').textContent(), 'Internet P2P');
      peerOrigins.push(peer.localOrigin);
      let peerGuest;
      if (role === 'host') {
        console.log('Packaged smoke: exchange direct invitation and reply with a browser peer');
        peerGuest = await browser.newPage();
        activePeerGuest = peerGuest;
        peerGuest.setDefaultTimeout(15000);
        peerGuest.on('pageerror', error => errors.push(error.message));
        peerGuest.on('request', request => requests.add(request.url()));
        const guestSocketRequests = [];
        peerGuest.on('request', request => {
          if (/\/socket\.io\/(?:\?|$)/.test(request.url())) guestSocketRequests.push(request.url());
        });
        peerGuest.on('websocket', socket => {
          if (/\/socket\.io\//.test(socket.url())) guestSocketRequests.push(socket.url());
        });
        await peerGuest.addInitScript(useLocalIceCandidates);
        await peerGuest.goto(peer.localOrigin + '/?peer=guest');
        await peerGuest.locator('#peer-panel').waitFor({ state: 'visible' });
        await peerPage.locator('#color-mode').selectOption('black');
        await peerPage.locator('#position-mode').selectOption('standard');
        await peerPage.locator('#board-view').selectOption('realistic-2d');
        await peerPage.locator('#create-btn').click();
        await peerPage.locator('#game-screen').waitFor({ state: 'visible' });
        for (const page of [peerPage, peerGuest]) {
          await page.locator('#peer-advanced > summary').click();
          await page.locator('#peer-method').selectOption('manual');
        }
        assert.equal(await peerPage.locator('#invite-panel').isVisible(), false, 'peer games share codes, not localhost links');
        await peerPage.locator('#peer-generate').click();
        const peerFrame = shell.frames().find(frame => frame.url().startsWith(peer.localOrigin + '/'));
        assert.ok(peerFrame);
        await peerFrame.waitForFunction(() => document.getElementById('peer-outgoing').value.length > 100);
        await peerGuest.locator('#peer-incoming').fill(await peerPage.locator('#peer-outgoing').inputValue());
        await peerGuest.locator('#peer-generate').click();
        await peerGuest.waitForFunction(() => document.getElementById('peer-outgoing').value.length > 100);
        await peerPage.locator('#peer-incoming').fill(await peerGuest.locator('#peer-outgoing').inputValue());
        await peerPage.locator('#peer-connect').click();
        await peerGuest.locator('#game-screen').waitFor({ state: 'visible' });
        await peerPage.locator('#turn-indicator').filter({ hasText: /Turn: BLACK/i }).waitFor();
        await peerPage.locator('.cell[data-r="0"][data-c="0"]').click();
        await peerPage.locator('.cell[data-r="1"][data-c="0"]').click();
        await peerGuest.locator('.cell[data-r="1"][data-c="0"] .piece.black').waitFor();
        await peerGuest.locator('.cell[data-r="7"][data-c="2"] .piece.playable').waitFor();
        await peerGuest.locator('.cell[data-r="7"][data-c="2"]').click();
        await peerGuest.locator('.cell[data-r="6"][data-c="2"]').click();
        await peerPage.locator('.cell[data-r="6"][data-c="2"] .piece.white').waitFor();
        assert.match(await peerPage.locator('#turn-indicator').textContent(), /BLACK.*YELLOW/);
        assert.deepEqual(guestSocketRequests, [], 'the browser peer must send moves through WebRTC, never Socket.IO');
        await shell.screenshot({ path: path.join(screenshots, 'packaged-peer-game.png') });
      }
      await shell.locator('#hosting-settings').click();
      assert.equal(await shell.locator('#setup-panel').isVisible(), role === 'guest', 'connection options are hidden during an active match');
      assert.match(await shell.locator('#status-description').textContent(), /directly to your friend/);
      await shell.locator('#stop-hosting').click();
      await shell.locator('#confirm-stop').click();
      await shell.locator('#peer-host-button').waitFor({ state: 'visible' });
      await assertPortClosed(peer.port, 'Ending a peer session must close its local page server');
      if (peerGuest) {
        await peerGuest.waitForFunction(() => document.getElementById('peer-panel').open
          && /disconnect|closed|lost|new invitation|interrupted|failed|timed out/i.test(document.getElementById('peer-status').textContent));
        await peerGuest.close();
        activePeerGuest = null;
      }
    }

    console.log('Packaged smoke: start an offline computer game');
    await shell.locator('#computer-button').click();
    const solo = shell.frameLocator('#game-frame');
    await solo.locator('#create-btn').waitFor({ state: 'visible' });
    const offline = await shell.evaluate(() => window.kamisadoDesktop.getState());
    assert.equal(offline.status, 'ready');
    assert.equal(offline.localOnly, true);
    assert.equal(offline.connectivity.publicOrigin, offline.localOrigin);
    assert.deepEqual(offline.connectivity.reachableOrigins, [offline.localOrigin]);
    assert.equal(await solo.locator('#opponent').inputValue(), 'computer', 'the desktop computer entry preselects the opponent');
    assert.equal(await solo.locator('#ai-level option').count(), 10, 'all ten difficulty levels must be available in the package');
    await solo.locator('#color-mode').selectOption('white');
    await solo.locator('#ai-level').selectOption('10');
    await solo.locator('#play-computer-btn').click();
    await solo.locator('#computer-status').filter({ hasText: 'Level 10' }).waitFor({ state: 'visible' });
    await solo.locator('.cell:not([data-r="0"]):not([data-r="7"]) .piece.black').first().waitFor({ state: 'visible' });
    assert.equal(await solo.locator('#share-link').isVisible(), false, 'computer games must not offer invitations');
    assert.equal(await solo.locator('#share-qr').isVisible(), false);
    assert.equal(await shell.locator('#connection-label').textContent(), 'Computer');
    await shell.screenshot({ path: path.join(screenshots, 'packaged-computer.png') });

    console.log('Packaged smoke: restart offline play and close while the computer thinks');
    await shell.locator('#hosting-settings').click();
    assert.equal(await shell.locator('#setup-panel').isVisible(), false, 'offline session settings hide connection controls');
    assert.equal(await shell.locator('.connection-details').isVisible(), false);
    await shell.locator('#stop-hosting').click();
    await shell.locator('#confirm-stop').click();
    await shell.locator('#computer-button').waitFor({ state: 'visible' });
    await assertPortClosed(offline.port, 'Ending computer play must release its port');
    await shell.locator('#computer-button').click();
    await solo.locator('#create-btn').waitFor({ state: 'visible' });
    const offlineRestarted = await shell.evaluate(() => window.kamisadoDesktop.getState());
    assert.equal(offlineRestarted.localOnly, true);
    await solo.locator('#color-mode').selectOption('white');
    await solo.locator('#ai-level').selectOption('10');
    await solo.locator('#play-computer-btn').click();
    await solo.locator('#computer-status').filter({ hasText: 'Thinking' }).waitFor({ state: 'visible' });
    await bounded(app.close(), 10000, 'quit while a packaged computer worker is searching');
    app = null;
    await assertPortClosed(offlineRestarted.port, 'Quitting must close the offline game listener and its search worker');

    const localOrigins = new Set([
      initial.localOrigin,
      state.localOrigin, state.connectivity.publicOrigin, restarted.localOrigin, restarted.connectivity.publicOrigin,
      offline.localOrigin, offlineRestarted.localOrigin,
      ...peerOrigins,
    ]);
    const externalRequests = [...requests].filter(value => {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) && !localOrigins.has(url.origin);
    });
    assert.deepEqual(externalRequests, [], 'LAN play, computer play, and board assets must not depend on external websites');
    assert.deepEqual(errors, [], 'packaged host and guest must not have uncaught browser errors');
    console.log('Packaged app checks passed: bundled quickstart, direct Internet entry flows, real WebRTC invitation/reply and bidirectional moves, peer disconnect, isolated profile, single window, port fallback, LAN invitation + QR, live connection changes, browser guest move, Stop/restart, offline computer move, ten levels, and quit during search.');
  } catch (error) {
    console.error('Packaged smoke failed:', error);
    for (const frame of shell?.frames() || []) {
      if (frame.parentFrame()) console.error('Host peer diagnostics:', await frame.evaluate(peerDiagnostics).catch(cause => String(cause)));
    }
    if (activePeerGuest) console.error('Guest peer diagnostics:', await activePeerGuest.evaluate(peerDiagnostics).catch(cause => String(cause)));
    throw error;
  } finally {
    console.log('Packaged smoke: cleanup');
    await bounded(browser?.close() || Promise.resolve(), 5000, 'close guest browser').catch(error => console.warn(error.message));
    await bounded(app?.close() || Promise.resolve(), 5000, 'close packaged app').catch(error => {
      console.warn(error.message);
      appProcess?.kill('SIGKILL');
    });
    for (const reservation of [occupiedLoopback, occupied]) {
      if (reservation.listening) await bounded(new Promise(resolve => reservation.close(resolve)), 5000, 'close reserved port')
        .catch(error => console.warn(error.message));
    }
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()), 'cleanup must stay in the temporary directory');
    assert.ok(path.basename(profile).startsWith('kamisado-packaged-'), 'cleanup must target this test profile');
    await bounded(fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }), 15000, 'remove test profile').catch(error => console.warn(error.message));
    clearTimeout(watchdog);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
