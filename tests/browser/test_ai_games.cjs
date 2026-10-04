const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer } = require('../../dist/server/index.js');

async function run() {
  const server = await startServer({ port: 0, host: '127.0.0.1' });
  const origin = `http://127.0.0.1:${server.port}`;
  const screenshots = path.resolve(__dirname, '../../out/ai-checks');
  await fs.mkdir(screenshots, { recursive: true });
  let browser;
  const errors = [];
  try {
    browser = await chromium.launch({ headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    });
    const context = await browser.newContext({ viewport: { width: 1000, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', async dialog => { errors.push(dialog.message()); await dialog.accept(); });
    const remoteRequests = [];
    page.on('request', request => {
      if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) remoteRequests.push(request.url());
    });
    await page.goto(origin);
    assert.equal(await page.locator('#computer-options').isVisible(), true);
    assert.equal(await page.locator('#computer-options').isVisible(), true);
    assert.equal(await page.locator('#ai-level option').count(), 10);
    assert.equal(await page.locator('#play-computer-btn').textContent(), 'Play with computer');
    await page.locator('#ai-level').selectOption('1');
    await page.locator('#color-mode').selectOption('black');
    await page.screenshot({ path: path.join(screenshots, 'computer-menu.png'), fullPage: true });
    await page.locator('#play-computer-btn').click();
    await page.locator('#game-screen').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#invite-panel').isVisible(), false);
    assert.match(await page.locator('#computer-status').textContent(), /Level 1/);
    await page.locator('.cell[data-r="0"][data-c="0"]').click();
    await page.locator('.cell[data-r="1"][data-c="0"]').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.piece.white')]
      .some(piece => piece.parentElement.dataset.r !== '7'));
    await page.waitForFunction(() => !document.getElementById('computer-status').textContent.includes('Thinking'));
    const gameUrl = page.url();
    await page.reload();
    await page.locator('#game-screen').waitFor({ state: 'visible' });
    assert.equal(page.url(), gameUrl, 'Reload must restore the same private game');
    assert.equal(await page.locator('#invite-panel').isVisible(), false);
    assert.match(await page.locator('#computer-status').textContent(), /Level 1/);

    await page.locator('#game-board-view').selectOption('realistic-2d');
    await page.locator('#game-symbol-mode').check();
    assert.equal(await page.locator('#board .square-symbol').count(), 128);
    await page.screenshot({ path: path.join(screenshots, 'computer-realistic-2d.png'), fullPage: true });
    await page.locator('#game-board-view').selectOption('realistic-3d');
    await page.locator('#board-3d canvas:visible, #board:visible .realistic-tower').first().waitFor();
    await page.screenshot({ path: path.join(screenshots, 'computer-realistic-3d.png'), fullPage: true });
    await page.locator('#game-board-view').selectOption('realistic-2d');
    await page.setViewportSize({ width: 320, height: 740 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(screenshots, 'computer-mobile.png'), fullPage: true });
    await page.locator('#leave-computer-btn').click();
    await page.locator('#menu-screen').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#opponent').inputValue(), 'human', 'Returning to settings clears the previous game action');
    assert.equal(await page.locator('#ai-level').inputValue(), '1');
    await page.locator('#ai-level').selectOption('10');
    await page.reload();
    await page.locator('#menu-screen').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#ai-level').inputValue(), '10', 'Difficulty preference must survive reload');
    await page.locator('#color-mode').selectOption('white');
    await page.locator('#play-computer-btn').click();
    await page.locator('#game-screen').waitFor({ state: 'visible' });
    await page.waitForFunction(() => [...document.querySelectorAll('.piece.black')]
      .some(piece => piece.parentElement.dataset.r !== '0'));
    assert.match(await page.locator('#computer-status').textContent(), /Level 10/);
    await page.locator('#leave-computer-btn').click();
    await page.locator('#menu-screen').waitFor({ state: 'visible' });

    // Leave immediately during a new high-level search, then start a human lobby.
    // No stale worker update may reopen the abandoned board or overwrite that room.
    await page.locator('#play-computer-btn').click();
    await page.locator('#leave-computer-btn').click();
    await page.locator('#menu-screen').waitFor({ state: 'visible' });
    await page.locator('#create-btn').click();
    await page.locator('#invite-panel').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#computer-status').isVisible(), false);
    await page.waitForTimeout(2500);
    assert.match(await page.locator('#turn-indicator').textContent(), /Waiting for opponent/);
    assert.deepEqual(remoteRequests, [], 'Computer play and board assets must work entirely on the local server');
    assert.deepEqual(errors, []);
    console.log('Computer browser checks passed: ten levels, both sides, persistence, reconnect, all views, mobile, and cancellation.');
  } finally {
    await browser?.close();
    await server.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
