const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const QRCode = require('qrcode');
const { startServer, setPublicOrigin } = require('../../dist/server/index.js');

const screenshots = path.resolve(__dirname, '../../out/invitation-checks');

async function assertQrEncodes(page, url) {
  const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
  // Check the rendered pixels against the modules for this exact invitation,
  // including the quiet zone. This catches stale and blank QR canvases.
  await page.waitForFunction(({ size, data }) => {
    const canvas = document.getElementById('share-qr');
    if (!canvas || canvas.classList.contains('hidden')) return false;
    const context = canvas.getContext('2d');
    if (!context) return false;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const padded = size + 8;
    for (let row = 0; row < padded; row++) {
      for (let col = 0; col < padded; col++) {
        const x = Math.floor((col + 0.5) * canvas.width / padded);
        const y = Math.floor((row + 0.5) * canvas.height / padded);
        const dark = pixels[(y * canvas.width + x) * 4] < 128;
        const expected = row >= 4 && row < size + 4 && col >= 4 && col < size + 4
          ? Boolean(data[(row - 4) * size + col - 4]) : false;
        if (dark !== expected) return false;
      }
    }
    return true;
  }, { size: modules.size, data: Array.from(modules.data) });
}

async function assertInvitation(page, url) {
  await page.waitForFunction(url => document.getElementById('share-link').value === url, url);
  assert.equal(await page.locator('#share-link').getAttribute('readonly'), '');
  await assertQrEncodes(page, url);
}

async function assertCopyFallback(page) {
  await page.locator('#share-btn').click();
  await page.waitForFunction(() => document.getElementById('share-feedback').textContent.startsWith('Link selected.'));
  const selection = await page.locator('#share-link').evaluate(input => ({
    focused: document.activeElement === input,
    start: input.selectionStart,
    end: input.selectionEnd,
    length: input.value.length,
  }));
  assert.equal(selection.focused, true, 'manual copy must focus the readable link');
  assert.equal(selection.start, 0);
  assert.equal(selection.end, selection.length, 'manual copy must select the whole current invitation');
}

async function run() {
  await fs.mkdir(screenshots, { recursive: true });
  setPublicOrigin('http://192.168.50.3:32145');
  const server = await startServer({ port: 0, host: '127.0.0.1' });
  const localOrigin = `http://127.0.0.1:${server.port}`;
  let browser;
  const errors = [];
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
    });
    const host = await browser.newContext({ viewport: { width: 1000, height: 1000 } });
    host.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    await host.addInitScript(() => {
      window.__copyMode = 'ok';
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { async writeText(text) {
          if (window.__copyMode === 'blocked') throw new DOMException('Copy blocked', 'NotAllowedError');
          window.__copied = text;
        } },
      });
    });
    const page = await host.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(localOrigin);
    await page.locator('#color-mode').selectOption('black');
    await page.locator('#create-btn').click();
    await page.locator('#game-screen').waitFor({ state: 'visible' });
    const gamePath = new URL(page.url()).pathname;
    assert.match(gamePath, /^\/game\/[a-f0-9]{12}$/);
    assert.equal(await page.locator('#invite-panel').evaluate(panel => panel.open), true, 'new lobbies must show the invitation immediately');
    await assertInvitation(page, 'http://192.168.50.3:32145' + gamePath);
    await page.locator('#share-btn').click();
    await page.waitForFunction(url => window.__copied === url, 'http://192.168.50.3:32145' + gamePath);
    assert.equal(await page.locator('#share-feedback').textContent(), 'Invitation link copied.');
    await page.screenshot({ path: path.join(screenshots, 'invitation-desktop.png'), fullPage: true });

    // A running game must survive switching from LAN to a tunnel, then back.
    setPublicOrigin('https://new-invitation.example.test');
    await assertInvitation(page, 'https://new-invitation.example.test' + gamePath);
    assert.equal(new URL(page.url()).pathname, gamePath, 'updating a public origin must preserve the room');
    await page.locator('#share-btn').click();
    await page.waitForFunction(url => window.__copied === url, 'https://new-invitation.example.test' + gamePath);
    await page.evaluate(() => { window.__copyMode = 'blocked'; });
    await assertCopyFallback(page);
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }); });
    await assertCopyFallback(page);

    await page.setViewportSize({ width: 320, height: 740 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'invitation controls must fit a narrow phone');
    await page.screenshot({ path: path.join(screenshots, 'invitation-mobile.png'), fullPage: true });
    setPublicOrigin(null);
    const invitation = localOrigin + gamePath;
    await assertInvitation(page, invitation);

    const guest = await browser.newContext();
    guest.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    const guestPage = await guest.newPage();
    // Pasting a full invitation must use its host, not silently treat the path
    // as a room on the menu's current origin. Both names reach this test server,
    // but are distinct browser origins with separate storage and connections.
    await guestPage.goto(`http://localhost:${server.port}`);
    await guestPage.waitForFunction(() => !document.getElementById('join-btn').disabled);
    assert.equal(new URL(guestPage.url()).hostname, 'localhost');
    await guestPage.locator('#join-id').fill(invitation);
    await Promise.all([
      guestPage.waitForURL(invitation),
      guestPage.locator('#join-btn').click(),
    ]);
    await guestPage.locator('#game-screen').waitFor({ state: 'visible' });
    assert.equal(new URL(guestPage.url()).origin, localOrigin, 'A pasted invitation must navigate to the advertised host');
    await page.waitForFunction(() => document.getElementById('turn-indicator').textContent.startsWith('Turn:'));
    assert.equal(await page.locator('#invite-panel').evaluate(panel => panel.open), false, 'invitation must fold away when the opponent joins');
    await page.locator('#invite-title').click();
    await assertInvitation(page, invitation);
    assert.match(await page.locator('#invite-help').textContent(), /watch this game/);

    // Move over real sockets to establish that joining starts an interactive game.
    await page.locator('.cell[data-r="0"][data-c="0"]').click();
    await page.locator('.cell[data-r="1"][data-c="0"]').click();
    await guestPage.locator('.cell[data-r="1"][data-c="0"] .piece.black').waitFor();
    await guestPage.locator('.cell[data-r="7"][data-c="2"] .piece.playable').waitFor();
    await guestPage.locator('.cell[data-r="7"][data-c="2"]').click();
    await guestPage.locator('.cell[data-r="6"][data-c="2"]').click();
    await page.locator('.cell[data-r="6"][data-c="2"] .piece.white.red').waitFor();
    await page.locator('.cell[data-r="0"][data-c="4"] .piece.playable').waitFor();
    await page.locator('.cell[data-r="0"][data-c="4"]').click();
    await page.locator('.cell[data-r="1"][data-c="4"]').click();
    await guestPage.locator('.cell[data-r="1"][data-c="4"] .piece.black.yellow').waitFor();
    assert.equal(await page.locator('#invite-panel').evaluate(panel => panel.open), true, 'a later game update must preserve an explicitly expanded invitation');
    const invalid = await browser.newContext();
    const invalidPage = await invalid.newPage();
    const rejectedInvitations = [];
    invalidPage.on('pageerror', error => errors.push(error.message));
    invalidPage.on('dialog', dialog => {
      rejectedInvitations.push(dialog.message());
      void dialog.accept();
    });
    await invalidPage.goto(localOrigin + '/game/000000000000');
    await invalidPage.waitForFunction(() => location.pathname === '/' && !document.getElementById('create-btn').disabled);
    assert.equal(await invalidPage.locator('#menu-screen').isVisible(), true, 'an invalid invitation must return to the menu');
    assert.equal(await invalidPage.locator('#game-screen').isVisible(), false);
    assert.equal(await invalidPage.locator('#join-btn').isDisabled(), false);
    assert.equal(await invalidPage.locator('#invite-panel').isVisible(), false);
    assert.equal(rejectedInvitations.length, 1, 'the invalid invitation must be explained once');
    await invalidPage.locator('#create-btn').click();
    await invalidPage.locator('#game-screen').waitFor({ state: 'visible' });
    assert.match(new URL(invalidPage.url()).pathname, /^\/game\/[a-f0-9]{12}$/);
    await invalid.close();
    const playableCell = await guestPage.locator('.piece.playable').first().evaluate(piece => ({
      r: piece.parentElement.dataset.r, c: piece.parentElement.dataset.c,
    }));
    await server.close();
    for (const playerPage of [page, guestPage]) {
      await playerPage.waitForFunction(() => document.getElementById('connection-notice').textContent ===
        'The host stopped this game. Ask them for a new invitation.');
      assert.equal(await playerPage.locator('#connection-notice').isVisible(), true);
      assert.equal(await playerPage.locator('#invite-panel').isVisible(), false, 'stopped games must not advertise invalid invitations');
      assert.equal(await playerPage.locator('.piece.playable').count(), 0, 'stopped boards must not suggest moves are playable');
      assert.equal(await playerPage.locator('#turn-indicator').textContent(), 'Game stopped', 'stopping must not invent a winner');
      assert.equal(await playerPage.locator('#create-btn').isDisabled(), true);
      assert.equal(await playerPage.locator('#join-btn').isDisabled(), true);
    }
    await guestPage.locator(`.cell[data-r="${playableCell.r}"][data-c="${playableCell.c}"]`).click();
    assert.equal(await guestPage.locator('.cell.selected').count(), 0, 'clicking a stopped board must not select a move');
    assert.deepEqual(errors, [], 'sharing must not produce uncaught browser errors');
    console.log('Invitation browser checks passed: pasted cross-origin invitation and bidirectional play, QR content, live origins, clipboard failure/absence, mobile layout, invalid-invitation recovery and host-stop feedback.');
    console.log('Screenshots: ' + screenshots);
  } finally {
    // Closing the server first prevents a disconnect-grace timer keeping this
    // test process alive after intentionally closing both players.
    await server.close();
    if (browser) await browser.close();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
