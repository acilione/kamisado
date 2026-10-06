// The phone must be unlocked, with Kamisado open and its WebView forwarded via adb.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const phone = await chromium.connectOverCDP(process.env.MOBILE_CDP_URL || 'http://127.0.0.1:9223', { noDefaults: true });
  const host = phone.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith('https://localhost'));
  if (!host) throw new Error('Open Kamisado on the unlocked phone.');
  const screenshots = path.resolve(__dirname, '../out/tunnel-mobile-checks');
  await fs.mkdir(screenshots, { recursive: true });
  let guestBrowser;
  try {
    guestBrowser = await chromium.launch({ headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
    host.setDefaultTimeout(20000);
    host.on('dialog', dialog => dialog.accept());
    const documentStarted = await host.evaluate(() => performance.timeOrigin);
    await host.locator('#mobile-home-button').click();
    await host.waitForFunction(previous => performance.timeOrigin !== previous, documentStarted);
    await host.waitForFunction(() => !document.getElementById('create-btn').disabled);
    await host.locator('#color-mode').selectOption('black');
    await host.locator('#match-type').selectOption('1');
    await host.locator('#timer').selectOption('0');
    await host.locator('#create-btn').click();
    await host.waitForFunction(() => document.getElementById('share-link').value.startsWith('https://') ||
      (!document.getElementById('create-btn').disabled && document.getElementById('tunnel-status').textContent), null, { timeout: 150000 });
    const link = await host.locator('#share-link').inputValue();
    if (!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/game\/[a-f0-9]{12}$/.test(link)) {
      throw new Error('Phone tunnel: ' + await host.locator('#tunnel-status').textContent());
    }
    assert.equal(await host.locator('#board').isVisible(), false);
    const guest = await guestBrowser.newPage();
    guest.setDefaultTimeout(30000);
    for (let attempt = 0; ; attempt++) {
      try { await guest.goto(link, { timeout: 15000 }); break; }
      catch (error) { if (attempt >= 10) throw error; await new Promise(r => setTimeout(r, 2000)); }
    }
    await guest.locator('#board').waitFor();
    await host.locator('#turn-indicator').filter({ hasText: /Turn: BLACK/ }).waitFor();
    await host.locator('.cell[data-r="0"][data-c="0"]').scrollIntoViewIfNeeded();
    await host.waitForTimeout(300);
    await host.locator('.cell[data-r="0"][data-c="0"]').click();
    await host.locator('.cell[data-r="0"][data-c="0"].selected').waitFor();
    await host.locator('.cell[data-r="1"][data-c="0"]').click();
    await guest.locator('.cell[data-r="1"][data-c="0"] .piece.black').waitFor();
    await guest.locator('.cell[data-r="7"][data-c="2"]').click();
    await guest.locator('.cell[data-r="6"][data-c="2"]').click();
    await host.locator('.cell[data-r="6"][data-c="2"] .piece.white').waitFor();
    await guest.reload();
    await guest.locator('.cell[data-r="6"][data-c="2"] .piece.white').waitFor();
    await host.screenshot({ path: path.join(screenshots, 'android-host.png') });
    await guest.screenshot({ path: path.join(screenshots, 'desktop-guest.png') });
    // The remote endpoint cannot access the native host's bundle or create another game.
    assert.equal((await guest.request.get(new URL('/mobile.js', link).href)).status(), 404);
    assert.equal((await guest.request.get(new URL('/capacitor.config.json', link).href)).status(), 404);
    console.log('Android Cloudflare check passed: HTTPS invitation, desktop browser join, moves both ways, guest refresh, private host assets.');
    await host.locator('#mobile-home-button').click();
  } catch (error) {
    console.error('Host board:', await host.evaluate(() => ({
      turn: document.getElementById('turn-indicator').textContent,
      message: document.getElementById('message').textContent,
      selected: document.querySelectorAll('.selected').length,
      moved: !!document.querySelector('.cell[data-r="1"][data-c="0"] .piece.black'),
    })).catch(() => 'unavailable'));
    throw error;
  } finally { await guestBrowser?.close(); await phone.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
