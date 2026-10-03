const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const express = require('express');
const { chromium, webkit } = require('playwright');
const { startServer } = require('../../dist/server/index.js');

async function pieces(page) {
  return page.locator('#board .piece').evaluateAll(nodes => nodes.map(node => ({
    row: node.parentElement.dataset.r, col: node.parentElement.dataset.c,
    color: node.dataset.color, side: node.classList.contains('black') ? 'black' : 'white',
  })).sort((a, b) => Number(a.row) - Number(b.row) || Number(a.col) - Number(b.col)));
}
async function playFirstMove(page) {
  await page.locator('.cell[data-r="0"][data-c="0"]').tap();
  await page.locator('.cell[data-r="1"][data-c="0"]').tap();
}
async function connect(host, guest) {
  await host.locator('#peer-generate').click();
  await host.waitForFunction(() => document.getElementById('peer-outgoing').value.startsWith('KAMISADO1.'));
  await guest.locator('#peer-incoming').fill(await host.locator('#peer-outgoing').inputValue());
  await guest.locator('#peer-generate').click();
  await guest.waitForFunction(() => document.getElementById('peer-outgoing').value.startsWith('KAMISADO1.'));
  await host.locator('#peer-incoming').fill(await guest.locator('#peer-outgoing').inputValue());
  await host.locator('#peer-connect').click();
  await guest.locator('#game-screen').waitFor();
  await host.waitForFunction(() => !document.getElementById('turn-indicator').textContent.includes('Waiting for opponent'));
}

async function run() {
  const app = express();
  app.use(express.static(path.resolve(__dirname, '../../out/mobile')));
  const assets = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  const origin = `http://127.0.0.1:${assets.address().port}`;
  const desktop = await startServer({ port: 0, host: '127.0.0.1' });
  const desktopOrigin = `http://127.0.0.1:${desktop.port}`;
  const screenshots = path.resolve(__dirname, '../../out/mobile-checks', process.env.MOBILE_BROWSER || 'chromium');
  await fs.mkdir(screenshots, { recursive: true });
  let browser;
  try {
    const engine = process.env.MOBILE_BROWSER === 'webkit' ? webkit : chromium;
    browser = await engine.launch({ headless: true });
    const errors = [];
    async function context() {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      await ctx.addInitScript(() => {
        window.mobileSearchResults = [];
        window.mobileWorkerErrors = [];
        const NativeWorker = window.Worker;
        window.Worker = class extends NativeWorker {
          constructor(...args) {
            super(...args);
            this.addEventListener('message', event => window.mobileSearchResults.push(event.data));
            this.addEventListener('error', event => window.mobileWorkerErrors.push(event.message));
          }
        };
        const Native = window.RTCPeerConnection;
        window.RTCPeerConnection = class extends Native {
          constructor(config) { super({ ...config, iceServers: [] }); }
        };
      });
      const page = await ctx.newPage();
      page.setDefaultTimeout(15000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => dialog.accept());
      return { ctx, page };
    }
    const solo = await context();
    const sockets = [];
    solo.page.on('request', request => { if (request.url().includes('/socket.io/')) sockets.push(request.url()); });
    await solo.page.goto(origin);
    await solo.page.locator('#mobile-home').waitFor();
    await solo.page.locator('#mobile-home details').click();
    await solo.page.locator('#mobile-invitation').fill('javascript:alert(1)');
    await solo.page.locator('#mobile-lan').click();
    assert.match(await solo.page.locator('#mobile-error').textContent(), /complete invitation/);
    await solo.page.screenshot({ path: path.join(screenshots, 'home.png'), fullPage: true });
    // Playwright WebKit's offline flag also blocks local blob: worker loading.
    // Block every HTTP request there; Chromium additionally disables its network stack.
    await solo.ctx.route(/^https?:/, route => route.abort());
    if (engine === chromium) await solo.ctx.setOffline(true);
    await solo.page.locator('#mobile-computer').tap();
    await solo.page.locator('#color-mode').selectOption('black');
    await solo.page.locator('#ai-level').selectOption('1');
    await solo.page.locator('#create-btn').tap();
    await solo.page.locator('#game-screen').waitFor();
    await playFirstMove(solo.page);
    await solo.page.waitForFunction(() => [...document.querySelectorAll('.piece.white')].some(p => p.parentElement.dataset.r !== '7'));
    assert.deepEqual(sockets, [], 'Offline mobile games must not request a Socket.IO server');
    await solo.page.locator('#game-symbol-mode').check();
    assert.equal(await solo.page.locator('#board .square-symbol').count(), 128);
    for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
      await solo.page.setViewportSize(viewport);
      assert.equal(await solo.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Board and controls fit the viewport');
    }
    await solo.page.setViewportSize({ width: 390, height: 844 });
    await solo.page.screenshot({ path: path.join(screenshots, 'offline-symbols.png'), fullPage: true });
    await solo.page.locator('#game-board-view').selectOption('realistic-3d');
    await solo.page.locator('#board-3d canvas:visible, #board:visible .realistic-tower').first().waitFor();
    await solo.page.screenshot({ path: path.join(screenshots, 'offline-3d.png'), fullPage: true });
    await solo.page.locator('#game-board-view').selectOption('realistic-2d');
    await solo.page.locator('#leave-computer-btn').tap();
    for (let level = 1; level <= 10; level++) {
      await solo.page.locator('#ai-level').selectOption(String(level));
      await solo.page.locator('#color-mode').selectOption('white');
      await solo.page.locator('#create-btn').tap();
      await solo.page.waitForFunction(() => [...document.querySelectorAll('.piece.black')].some(p => p.parentElement.dataset.r !== '0'));
      await solo.page.locator('#leave-computer-btn').tap();
    }
    const searches = await solo.page.evaluate(() => ({ results: mobileSearchResults, errors: mobileWorkerErrors }));
    assert.equal(searches.results.filter(result => result.move).length, 11,
      'Every offline move must come from the real AI worker, not the failure fallback: ' + JSON.stringify(searches));
    assert.deepEqual(await solo.page.evaluate(() => mobileWorkerErrors), []);
    console.log('Mobile: all ten offline levels returned real worker results.');

    // App switching cancels a running search and resumes without applying a stale move.
    await solo.page.locator('#timer').selectOption('60');
    await solo.page.locator('#create-btn').tap();
    await solo.page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const pausedBoard = await pieces(solo.page);
    await solo.page.waitForTimeout(300);
    assert.deepEqual(await pieces(solo.page), pausedBoard);
    await solo.page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await solo.page.waitForFunction(() => [...document.querySelectorAll('.piece.black')].some(p => p.parentElement.dataset.r !== '0'));
    await solo.ctx.close();
    console.log('Mobile: background cancellation and resume passed.');

    // Mobile hosts use the shared in-process match controller; desktop hosts use Socket.IO.
    for (const mobileHosts of [true, false]) {
      const host = await context();
      const guest = await context();
      await host.page.goto(mobileHosts ? origin : desktopOrigin + '/?peer=host');
      await guest.page.goto(mobileHosts ? desktopOrigin + '/?peer=guest' : origin);
      if (mobileHosts) await host.page.locator('#mobile-host').tap();
      else await guest.page.locator('#mobile-guest').tap();
      await host.page.locator('#color-mode').selectOption('black');
      await host.page.locator('#create-btn').tap();
      await connect(host.page, guest.page);
      await playFirstMove(host.page);
      await guest.page.locator('.cell[data-r="1"][data-c="0"] .piece.black').waitFor();
      await guest.page.locator('.cell[data-r="7"][data-c="2"]').tap();
      await guest.page.locator('.cell[data-r="6"][data-c="2"]').tap();
      await host.page.waitForFunction(() => [...document.querySelectorAll('.piece.white')].some(p => p.parentElement.dataset.r !== '7'));
      assert.deepEqual(await pieces(host.page), await pieces(guest.page), 'Mobile and desktop have identical boards');
      if (mobileHosts) {
        await host.page.locator('#mobile-home-button').tap();
        await guest.page.waitForFunction(() => document.getElementById('connection-notice').textContent.includes('host stopped'));
      }
      await host.ctx.close();
      await guest.ctx.close();
    }
    assert.deepEqual(errors, []);
    console.log('Mobile checks passed: offline AI at all ten levels, touch, symbols, 2D/3D, portrait/landscape, and P2P hosting/joining with desktop.');
  } finally {
    await browser?.close();
    await desktop.close();
    await new Promise(resolve => assets.close(resolve));
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
