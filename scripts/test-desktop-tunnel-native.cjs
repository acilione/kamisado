const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron, chromium } = require('playwright');
(async () => {
  const executablePath = process.argv[2];
  if (!executablePath) throw new Error('Pass the packaged Kamisado executable path.');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'kamisado-tunnel-check-'));
  let app, browser;
  try {
    const env = { ...process.env, KAMISADO_USER_DATA_DIR: profile };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath, env, args: process.env.KAMISADO_ELECTRON_APP ? [process.env.KAMISADO_ELECTRON_APP] : [], chromiumSandbox: true, timeout: 40000 });
    const shell = await app.firstWindow();
    const host = shell.frameLocator('#game-frame');
    await host.locator('#color-mode').selectOption('black');
    await host.locator('#create-btn').click();
    const frame = shell.frames().find(f => f !== shell.mainFrame());
    await frame.waitForFunction(() => document.getElementById('share-link').value.startsWith('https://') ||
      (!document.getElementById('create-btn').disabled && document.getElementById('tunnel-status').textContent), null, { timeout: 250000 });
    if (!await host.locator('#share-link').isVisible()) throw new Error(await host.locator('#tunnel-status').textContent());
    const link = await host.locator('#share-link').inputValue();
    assert.match(link, /^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/game\/[a-f0-9]{12}$/);
    browser = await chromium.launch({ headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
    const guest = await browser.newPage();
    await guest.goto(link);
    await guest.locator('#board').waitFor();
    await host.locator('.cell[data-r="0"][data-c="0"]').click();
    await host.locator('.cell[data-r="1"][data-c="0"]').click();
    await guest.locator('.cell[data-r="1"][data-c="0"] .piece.black').waitFor();
    await guest.locator('.cell[data-r="7"][data-c="2"]').click();
    await guest.locator('.cell[data-r="6"][data-c="2"]').click();
    await host.locator('.cell[data-r="6"][data-c="2"] .piece.white').waitFor();
    await shell.locator('#hosting-settings').click();
    await shell.locator('#stop-hosting').click();
    await shell.locator('#confirm-stop').click();
    await shell.waitForFunction(() => !document.getElementById('game-frame').hasAttribute('src'));
    console.log('Packaged desktop Cloudflare passed: verified connector download, native IPC, HTTPS invitation, moves both ways, stop hosting.');
  } catch (error) {
    const shell = app ? await app.firstWindow().catch(() => null) : null;
    if (shell) console.error('Tunnel status:', await shell.frameLocator('#game-frame').locator('#tunnel-status').textContent({ timeout: 1000 }).catch(() => 'unavailable'));
    throw error;
  } finally { await browser?.close(); await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
