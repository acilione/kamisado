const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
(async () => {
 const env = { ...process.env, KAMISADO_USER_DATA_DIR: await fs.mkdtemp(path.join(os.tmpdir(), 'kamisado-turn-native-')) };
 delete env.ELECTRON_RUN_AS_NODE;
 let app;
 try {
  app = await electron.launch({ executablePath: process.env.KAMISADO_PACKAGED_EXECUTABLE || path.resolve(__dirname, '../out', 'Kamisado-' + process.platform + '-' + process.arch, process.platform === 'win32' ? 'Kamisado.exe' : 'Kamisado'), env, args: ['--no-sandbox'], timeout: 30000 });
  await app.evaluate(() => {
   globalThis.turnTestCalls = [];
   globalThis.fetch = async (url, options) => {
    turnTestCalls.push({ url, options });
    if (new URL(url).hostname !== 'native-test.metered.live') throw new Error('Unexpected provider host');
    const data = options.method === 'POST'
     ? { apiKey: 'scoped-test-key', expiryInSeconds: JSON.parse(options.body).expiryInSeconds }
     : [{ urls: 'turns:example.invalid:443?transport=tcp', username: 'session-user', credential: 'session-password' }];
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
   };
  });
  const shell = await app.firstWindow();
  const game = shell.frameLocator('#game-frame');
  await game.locator('#create-btn').waitFor();
  await game.locator('#turn-provider > summary').click();
  await game.locator('#turn-provider-enabled').check();
  await game.locator('#turn-provider-domain').fill('native-test.metered.live');
  await game.locator('#turn-provider-secret').fill('fake-host-account-secret');
  await game.locator('#create-btn').click();
  await game.locator('#peer-relay-mode').waitFor();
  assert.equal(await game.locator('#peer-relay-username').inputValue(), 'session-user');
  assert.match(await game.locator('#peer-relay-readiness').textContent(), /Access expires at/);
  assert.deepEqual(await app.evaluate(() => turnTestCalls.map(c => ({ method: c.options.method, redirect: c.options.redirect, lifetime: c.options.body ? JSON.parse(c.options.body).expiryInSeconds : null }))),
   [{ method: 'POST', redirect: 'error', lifetime: 14400 }, { method: 'GET', redirect: 'error', lifetime: null }]);
  assert.equal(await game.locator('body').evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).includes('fake-host-account-secret')), false);
  const forged = await game.locator('body').evaluate(() => typeof window.kamisadoDesktop);
  assert.equal(forged, 'undefined', 'Embedded game receives no direct native API');
  await assert.rejects(shell.evaluate(() => window.kamisadoDesktop.createTurnCredential({ domain: 'evil.example', secretKey: 'fake-key', lifetimeSeconds: 3600 })), /metered.live/);
  assert.equal(await app.evaluate(() => turnTestCalls.length), 2, 'Invalid provider hosts must be rejected before any network call');
  await app.evaluate(() => {
   globalThis.fetch = async () => new Response(JSON.stringify({ message: 'Invalid request. Not subscribed to any turn server plan' }),
    { status: 400, headers: { 'Content-Type': 'application/json' } });
  });
  const providerError = await shell.evaluate(async () => {
   try { await window.kamisadoDesktop.createTurnCredential({ domain: 'native-test.metered.live', secretKey: 'fake-host-account-secret', lifetimeSeconds: 3600 }); }
   catch (error) { return error.message; }
  });
  assert.match(providerError, /create temporary credentials.*HTTP 400.*Not subscribed/);
  assert.ok(!providerError.includes('Error invoking remote method'), 'Expected provider errors must be readable across the IPC boundary');
  assert.ok(!providerError.includes('fake-host-account-secret'));
  console.log('Packaged native TURN generation passed: trusted IPC, provider request/response, expiry estimate, domain restrictions, and no secret storage. Provider HTTP was mocked; no real account was used.');
 } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
