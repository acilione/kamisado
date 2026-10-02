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

async function main() {
  await fs.access(executable);
  const screenshots = path.join(root, 'out/browser-checks');
  await fs.mkdir(screenshots, { recursive: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'kamisado-packaged-'));
  const occupied = net.createServer(socket => socket.end());
  let app;
  let browser;
  const watchdog = setTimeout(() => {
    console.error('Packaged smoke exceeded its three-minute deadline.');
    app?.process().kill('SIGKILL');
    process.exit(1);
  }, 180000);
  try {
    await new Promise((resolve, reject) => {
      occupied.once('error', reject);
      occupied.listen(0, '0.0.0.0', resolve);
    });
    const occupiedPort = occupied.address().port;
    const env = { ...process.env, KAMISADO_DESKTOP_PORT: String(occupiedPort), KAMISADO_USER_DATA_DIR: profile };
    delete env.ELECTRON_RUN_AS_NODE;
    console.log('Packaged smoke: launching ' + executable);
    app = await electron.launch({ executablePath: executable, env, timeout: 30000 });
    const shell = await app.firstWindow();
    shell.setDefaultTimeout(15000);
    const errors = [];
    const requests = new Set();
    shell.on('request', request => requests.add(request.url()));
    shell.on('pageerror', error => errors.push(error.message));
    assert.equal(await app.evaluate(({ app }) => app.isPackaged), true, 'must test the packaged app');
    assert.equal(await app.evaluate(() => process.versions.electron), require('../package.json').devDependencies.electron, 'packaged runtime must match the pinned Electron version');
    await shell.locator('#lan-button').waitFor({ state: 'visible' });
    const initial = await shell.evaluate(() => window.kamisadoDesktop.getState());
    assert.equal(initial.status, 'idle');
    assert.equal(initial.port, 0, 'launching the app must not expose a server before hosting starts');

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
    console.log('Packaged smoke: render board modes and symbols');
    await host.locator('#game-board-view').selectOption('realistic-2d');
    await host.locator('#game-symbol-mode').check();
    assert.equal(await host.locator('#board .square-symbol').count(), 128, 'realistic symbol board must load its two markings per square');
    await host.locator('#game-board-view').selectOption('realistic-3d');
    await host.locator('#board-3d canvas:visible, #board:visible .realistic-tower').first().waitFor({ state: 'visible' });
    await shell.screenshot({ path: path.join(screenshots, 'packaged-board.png') });
    await host.locator('#game-board-view').selectOption('simple');

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
    await host.locator('.cell[data-r="0"][data-c="0"]').click();
    await host.locator('.cell[data-r="1"][data-c="0"]').click();
    await guest.locator('.cell[data-r="1"][data-c="0"] .piece.black').waitFor({ state: 'visible' });

    console.log('Packaged smoke: stop hosting and verify listener closes');
    await shell.locator('#hosting-settings').click();
    // The temporary loopback override refers to this server's port; restore automatic LAN selection for restart.
    await shell.locator('#advertised-origin').fill('');
    await shell.locator('#stop-hosting').click();
    await shell.locator('#confirm-stop').click();
    await shell.waitForFunction(async () => (await window.kamisadoDesktop.getState()).status === 'idle');
    await shell.locator('#lan-button').waitFor({ state: 'visible' });
    assert.equal(await canConnect(state.port), false, 'Stop must close the HTTP and Socket.IO listener');
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

    console.log('Packaged smoke: end network hosting and start an offline computer game');
    await shell.locator('#hosting-settings').click();
    await shell.locator('#stop-hosting').click();
    await shell.locator('#confirm-stop').click();
    await shell.locator('#computer-button').waitFor({ state: 'visible' });
    assert.equal(await canConnect(restarted.port), false);
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
    await solo.locator('#create-btn').click();
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
    assert.equal(await canConnect(offline.port), false);
    await shell.locator('#computer-button').click();
    await solo.locator('#create-btn').waitFor({ state: 'visible' });
    const offlineRestarted = await shell.evaluate(() => window.kamisadoDesktop.getState());
    assert.equal(offlineRestarted.localOnly, true);
    await solo.locator('#color-mode').selectOption('white');
    await solo.locator('#ai-level').selectOption('10');
    await solo.locator('#create-btn').click();
    await solo.locator('#computer-status').filter({ hasText: 'Thinking' }).waitFor({ state: 'visible' });
    await bounded(app.close(), 10000, 'quit while a packaged computer worker is searching');
    app = null;
    assert.equal(await canConnect(offlineRestarted.port), false, 'quitting must close the offline game listener and its search worker');

    const localOrigins = new Set([
      state.localOrigin, state.connectivity.publicOrigin, restarted.localOrigin, restarted.connectivity.publicOrigin,
      offline.localOrigin, offlineRestarted.localOrigin,
    ]);
    const externalRequests = [...requests].filter(value => {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) && !localOrigins.has(url.origin);
    });
    assert.deepEqual(externalRequests, [], 'LAN play, computer play, and board assets must not depend on external websites');
    assert.deepEqual(errors, [], 'packaged host and guest must not have uncaught browser errors');
    console.log('Packaged app checks passed: isolated profile, single window, port fallback, LAN invitation + QR, live connection changes, browser guest move, Stop/restart, offline computer move, ten levels, and quit during search.');
  } finally {
    console.log('Packaged smoke: cleanup');
    await bounded(browser?.close() || Promise.resolve(), 5000, 'close guest browser').catch(error => console.warn(error.message));
    await bounded(app?.close() || Promise.resolve(), 5000, 'close packaged app').catch(error => {
      console.warn(error.message);
      app?.process().kill('SIGKILL');
    });
    await new Promise(resolve => occupied.close(resolve));
    assert.equal(path.dirname(path.resolve(profile)), path.resolve(os.tmpdir()), 'cleanup must stay in the temporary directory');
    assert.ok(path.basename(profile).startsWith('kamisado-packaged-'), 'cleanup must target this test profile');
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(error => console.warn(error.message));
    clearTimeout(watchdog);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
