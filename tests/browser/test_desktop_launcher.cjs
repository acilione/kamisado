const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

async function run() {
  // Exercise the actual launcher with a desktop API stub. Native URL validation
  // and IPC sender checks are covered by the desktop unit/packaged tests.
  const files = new Map(await Promise.all(['index.html', 'renderer.js', 'style.css'].map(async name => [
    '/desktop/' + name, await fs.readFile(path.resolve(__dirname, '../../desktop', name)),
  ])));
  const server = http.createServer((request, response) => {
    const body = files.get(request.url);
    if (body) {
      response.setHeader('Content-Type', request.url.endsWith('.js') ? 'text/javascript'
        : request.url.endsWith('.css') ? 'text/css' : 'text/html');
      response.end(body);
    } else {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html><body>Local game fixture</body></html>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const invitation = 'http://192.168.1.80:32145/game/abcdef123456';
  let browser;
  try {
    browser = await chromium.launch({ headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    });
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ origin }) => {
      if (window !== window.top) return;
      const idle = {
        status: 'idle', localOrigin: '', port: 0, localOnly: false, connectivity: null,
        hasSavedNgrokToken: false, hasSessionNgrokToken: false, canSaveNgrokToken: true,
      };
      window.__state = { ...idle };
      window.__starts = [];
      window.__joins = [];
      window.__copied = [];
      window.__noNetwork = false;
      window.kamisadoDesktop = {
        async getState() { return structuredClone(window.__state); },
        async startHosting(request) {
          window.__starts.push(request);
          const addresses = request.localOnly || window.__noNetwork
            ? [origin] : ['http://192.168.1.80:32145', 'http://10.0.0.80:32145', origin];
          const publicOrigin = request.advertisedOrigin || addresses[0];
          window.__state = {
            ...idle, status: 'ready', localOrigin: origin, port: new URL(origin).port,
            localOnly: Boolean(request.localOnly), peerMode: request.peerMode,
            connectivity: {
              mode: request.mode, publicOrigin, reachableOrigins: addresses,
              title: window.__noNetwork ? 'No network found' : 'LAN game ready',
              description: window.__noNetwork ? 'Only this computer can connect.' : 'Other devices on your network can join.',
              warning: window.__noNetwork ? 'Connect to Wi-Fi or Ethernet, then try again.' : undefined,
            },
          };
          return structuredClone(window.__state);
        },
        async stopHosting() { window.__state = { ...idle }; return structuredClone(window.__state); },
        async forgetNgrokToken() { return structuredClone(window.__state); },
        async copyText(value) { window.__copied.push(value); },
        async openExternal() {},
        async joinGame(url) {
          if (typeof url !== 'string' || !/^https?:\/\/[^/]+\/game\/[a-f0-9]{12}$/.test(url)) {
            throw new Error('Paste a full Kamisado invitation link ending in /game/ followed by its game code.');
          }
          window.__joins.push(url);
        },
      };
    }, { origin });
    await page.goto(origin + '/desktop/index.html');
    await page.waitForFunction(() => !document.getElementById('lan-button').disabled);
    assert.match(await page.locator('#lan-button').textContent(), /Wi-Fi or Ethernet/);
    assert.equal(await page.locator('#internet-options').getAttribute('open'), null);
    assert.equal(await page.locator('#token-setup').isVisible(), false);
    assert.equal(await page.locator('#game-frame').getAttribute('src'), null);

    await page.locator('#join-invitation').fill('not an invitation');
    await page.locator('#join-invitation').press('Enter');
    await page.locator('#join-result.error').waitFor();
    assert.match(await page.locator('#join-result').textContent(), /full Kamisado invitation/);
    assert.equal(await page.locator('#join-invitation').getAttribute('aria-invalid'), 'true');
    await page.locator('#join-invitation').fill('  ' + invitation + '  ');
    await page.locator('#join-button').click();
    await page.waitForFunction(() => window.__joins.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__joins), [invitation]);
    assert.equal(await page.locator('#game-frame').getAttribute('src'), null, 'Joining must use the browser, not the privileged launcher frame');
    assert.deepEqual(await page.evaluate(() => window.__starts), [], 'Joining must not start a server');

    await page.locator('#lan-button').click();
    await page.locator('#game-panel').waitFor();
    assert.equal(await page.locator('#game-frame').getAttribute('src'), origin);
    const game = page.frames().find(frame => frame !== page.mainFrame());
    await game.waitForLoadState();
    await game.evaluate(() => { window.__preserved = true; });
    await page.locator('#hosting-settings').click();
    await page.locator('.connection-details summary').click();
    assert.match(await page.locator('#status-description').textContent(), /Other devices on your network/);
    assert.equal(await page.getByRole('button', { name: 'Selected invitation address http://192.168.1.80:32145', exact: true }).isDisabled(), true);
    const loopbackRow = page.locator('.origin-row').filter({ hasText: 'This computer only' });
    assert.equal(await loopbackRow.locator('button').count(), 1, 'Loopback is copy-only');
    await page.getByRole('button', { name: 'Use http://10.0.0.80:32145 for invitation', exact: true }).click();
    await page.locator('#game-panel').waitFor();
    assert.equal(await game.evaluate(() => window.__preserved), true, 'Changing the invitation address must preserve the game frame');
    assert.equal(await page.evaluate(() => window.__starts.at(-1).advertisedOrigin), 'http://10.0.0.80:32145');

    // Only messages from the live local game frame can invoke the desktop API.
    await page.evaluate(({ origin, invitation }) => {
      const data = { type: 'kamisado:join-invitation', requestId: 1, url: invitation };
      window.dispatchEvent(new MessageEvent('message', { source: window, origin, data }));
      window.dispatchEvent(new MessageEvent('message', {
        source: document.getElementById('game-frame').contentWindow, origin: 'https://untrusted.example', data,
      }));
    }, { origin, invitation });
    await game.evaluate(invitation => {
      window.__responses = [];
      window.addEventListener('message', event => window.__responses.push(event.data));
      window.parent.postMessage({ type: 'kamisado:join-invitation', requestId: 2, url: invitation }, '*');
    }, invitation);
    await game.waitForFunction(() => window.__responses.some(result => result.requestId === 2));
    assert.equal(await page.evaluate(() => window.__joins.length), 2);
    assert.equal(await game.evaluate(() => window.__responses.find(result => result.requestId === 2).success), true);
    await game.evaluate(() => window.parent.postMessage({ type: 'kamisado:join-invitation', requestId: 3, url: 'file:///tmp/bad' }, '*'));
    await game.waitForFunction(() => window.__responses.some(result => result.requestId === 3));
    assert.equal(await game.evaluate(() => window.__responses.find(result => result.requestId === 3).success), false);
    assert.equal(await page.evaluate(() => window.__joins.length), 2);

    await page.locator('#hosting-settings').click();
    await page.setViewportSize({ width: 320, height: 740 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Launcher must fit narrow windows');
    await page.locator('#join-invitation').fill(invitation);
    await page.locator('#join-button').click();
    await page.waitForFunction(() => document.getElementById('join-result').textContent.includes('still running'));
    await page.locator('#stop-hosting').click();
    await page.locator('#confirm-stop').click();
    await page.waitForFunction(() => document.getElementById('game-frame').getAttribute('src') === null);

    // No LAN must keep the warning visible instead of promising a shareable game.
    await page.evaluate(() => { window.__noNetwork = true; });
    await page.locator('#lan-button').click();
    await page.locator('#warning').waitFor();
    assert.equal(await page.locator('#game-panel').isVisible(), false);
    assert.match(await page.locator('#status-title').textContent(), /No network/);
    assert.match(await page.locator('#status-description').textContent(), /Only this computer/);
    assert.match(await page.locator('#warning').textContent(), /Connect to Wi-Fi or Ethernet/);
    await page.locator('#return-to-game').click();
    await page.locator('#game-panel').waitFor();
    await page.locator('#hosting-settings').click();
    await page.locator('#stop-hosting').click();
    await page.locator('#confirm-stop').click();

    for (const [button, mode] of [['#peer-host-button', 'host'], ['#peer-join-button', 'guest']]) {
      await page.locator(button).click();
      await page.locator('#game-panel').waitFor();
      assert.equal(await page.locator('#game-frame').getAttribute('src'), origin + '/?peer=' + mode);
      assert.deepEqual(await page.evaluate(() => window.__starts.at(-1)), { mode: 'direct', localOnly: true, peerMode: mode });
      assert.equal(await page.locator('#connection-label').textContent(), 'Internet P2P');
      await page.locator('#hosting-settings').click();
      assert.equal(await page.locator('#setup-panel').isVisible(), false);
      assert.equal(await page.locator('#stop-hosting').textContent(), 'End session');
      assert.match(await page.locator('#status-description').textContent(), /no central game server/);
      await page.locator('#stop-hosting').click();
      await page.locator('#confirm-stop').click();
    }

    await page.locator('#computer-button').click();
    await page.locator('#game-panel').waitFor();
    assert.equal(await page.locator('#game-frame').getAttribute('src'), origin + '/?opponent=computer');
    await page.locator('#hosting-settings').click();
    assert.equal(await page.locator('#setup-panel').isVisible(), false);
    assert.equal(await page.locator('#stop-hosting').textContent(), 'End session');
    await page.locator('#stop-hosting').click();
    await page.locator('#confirm-stop').click();
    await page.locator('#internet-options summary').click();
    await page.locator('#online-button').click();
    await page.locator('#token-setup').waitFor();
    assert.equal(await page.locator('.quick-actions').isVisible(), false);
    await page.locator('#token-back').click();
    assert.equal(await page.locator('#lan-button').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log('Desktop launcher checks passed: Internet P2P host/join, LAN steps, browser joins, invitation addresses, frame isolation, no-network help, offline AI, and relay setup.');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
