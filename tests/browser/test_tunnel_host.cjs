const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer } = require('../../dist/server');

async function run() {
  const server = await startServer({ port: 0, host: '127.0.0.1' });
  const origin = `http://127.0.0.1:${server.port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const parent = await browser.newPage();
    await parent.setContent(`<iframe src="${origin}/?hosting=tunnel" style="width:100%;height:850px"></iframe>`);
    await parent.evaluate(() => {
      window.requests = [];
      window.fail = true;
      addEventListener('message', event => {
        if (event.data?.type !== 'kamisado:start-tunnel') return;
        requests.push(event.data.request);
        event.source.postMessage({ type: 'kamisado:tunnel-result', requestId: event.data.requestId,
          success: !window.fail, message: 'Cloudflare is temporarily unavailable.', origin: 'https://private-match.trycloudflare.com' }, event.origin);
      });
    });
    const host = parent.frameLocator('iframe');
    await host.locator('#create-btn').waitFor();
    await host.locator('#color-mode').selectOption('black');
    await host.locator('#create-btn').click();
    await host.locator('#tunnel-status').filter({ hasText: 'temporarily unavailable' }).waitFor();
    assert.equal(await host.locator('#game-screen').isVisible(), false, 'Failure must leave settings available without a lobby or board');
    assert.equal(await host.locator('#create-btn').isEnabled(), true);
    await parent.evaluate(() => window.fail = false);
    await host.locator('#create-btn').click();
    await host.locator('#share-link').waitFor();
    const link = await host.locator('#share-link').inputValue();
    assert.match(link, /^https:\/\/private-match\.trycloudflare\.com\/game\/[a-f0-9]{12}$/);
    assert.equal(await host.locator('#board').isVisible(), false, 'Waiting lobby does not display the board');
    assert.deepEqual(await parent.evaluate(() => requests.map(r => r.mode)), ['cloudflare', 'cloudflare']);
    const guest = await browser.newPage();
    await guest.goto(link.replace('https://private-match.trycloudflare.com', origin));
    await guest.locator('#board').waitFor();
    await host.locator('.cell[data-r="0"][data-c="0"]').click();
    await host.locator('.cell[data-r="1"][data-c="0"]').click();
    await guest.locator('.cell[data-r="1"][data-c="0"] .piece').waitFor();
    // A second host uses the same settings panel for ngrok, with credentials sent only to its shell.
    const ngrokParent = await browser.newPage();
    await ngrokParent.setContent(`<iframe src="${origin}/?hosting=tunnel" style="width:100%;height:850px"></iframe>`);
    await ngrokParent.evaluate(() => {
      window.requests = [];
      addEventListener('message', event => {
        if (event.data?.type !== 'kamisado:start-tunnel') return;
        requests.push(event.data.request);
        event.source.postMessage({ type: 'kamisado:tunnel-result', requestId: event.data.requestId, success: true,
          origin: 'https://host.ngrok-free.app' }, event.origin);
      });
    });
    const ngrok = ngrokParent.frameLocator('iframe');
    await ngrok.locator('#tunnel-options summary').click();
    await ngrok.locator('#tunnel-provider').selectOption('ngrok');
    await ngrok.locator('#tunnel-token').fill('fake-host-only-token');
    await ngrok.locator('#create-btn').click();
    await ngrok.locator('#share-link').waitFor();
    assert.match(await ngrok.locator('#share-link').inputValue(), /^https:\/\/host\.ngrok-free\.app\/game\//);
    assert.equal(await ngrok.locator('#tunnel-token').inputValue(), '');
    assert.deepEqual(await ngrokParent.evaluate(() => requests), [{ mode: 'ngrok', authToken: 'fake-host-only-token' }]);
    console.log('Tunnel UI passed: default Cloudflare, retry, hidden lobby board, browser join and move, host-only ngrok token.');
  } finally { await browser.close(); await server.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
