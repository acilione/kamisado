// Connect to an Android debug WebView forwarded with adb; run with the app at its menu.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.connectOverCDP(process.env.MOBILE_CDP_URL || 'http://127.0.0.1:9223', { noDefaults: true });
  console.log('Connected to Android WebView.');
  try {
    const page = browser.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith('https://localhost'));
    assert.ok(page, 'Open the Kamisado debug app before running this check');
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('#menu-screen').waitFor();
    console.log('Native launcher is ready.');
    await page.evaluate(() => {
      window.nativeSearches = [];
      const NativeWorker = Worker;
      window.Worker = class extends NativeWorker {
        constructor(...args) { super(...args); this.addEventListener('message', event => nativeSearches.push(event.data)); }
      };
    });
    await page.locator('#ai-level').selectOption('10');
    await page.locator('#color-mode').selectOption('black');
    await page.locator('#play-computer-btn').click();
    await page.locator('.cell[data-r="0"][data-c="0"]').click();
    await page.locator('.cell[data-r="1"][data-c="0"]').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.piece.white')].some(piece => piece.parentElement.dataset.r !== '7'));
    assert.ok(await page.evaluate(() => nativeSearches.some(result => result.move)), 'Native WebView runs the real offline AI worker');
    console.log('Native AI worker returned a move.');
    await page.locator('#game-symbol-mode').check();
    assert.equal(await page.locator('#board .square-symbol').count(), 128);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const output = path.resolve(__dirname, '../out/mobile-checks/android');
    await fs.mkdir(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'native-offline.png') });
    await page.locator('#game-board-view').selectOption('realistic-3d');
    await page.locator('#board-3d canvas:visible, #board:visible .realistic-tower').first().waitFor();
    await page.screenshot({ path: path.join(output, 'native-3d.png') });
    await page.locator('#leave-computer-btn').click();
    await page.locator('#menu-screen').waitFor();
    assert.deepEqual(errors, []);
    console.log('Android WebView checks passed: native launcher, real level-10 AI worker, moves, symbols, 2D/3D, and ending the game.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
