// Isolated browser smoke checks: no live sessions or saved games are touched.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { KamisadoGame } = require('../../dist/server/game.js');
const { BOARD_COLORS } = require('../../dist/shared/constants.js');
const { COLOR_CHARACTER_PATHS, REALISTIC_COLORS } = require('../../dist/client/realistic-art.js');

const root = path.resolve(__dirname, '../..');
const publicRoot = path.join(root, 'public');
const screenshots = path.join(root, 'out/browser-checks');
const fixture = new KamisadoGame('b0a4d1234567', { timer: '0', matchType: '3' });
fixture.startGame();
fixture.board[0][0].sumo = 2;
const initialState = fixture.toJson();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

// Mock only the socket transport, exercising the real bundled application.
const socketFixture = '(' + function bootstrap(state) {
  const query = new URLSearchParams(location.search);
  const spectator = query.get('spectator') === '1';
  const color = query.get('player') === 'white' ? 'white' : 'black';
  const listeners = new Map();
  const dispatch = (name, data) => (listeners.get(name) || []).forEach(fn => fn(data));
  window.__boardFixture = { moves: [], dispatch };
  window.io = () => {
    setTimeout(() => dispatch('connect'), 0);
    return {
      on(name, handler) {
        listeners.set(name, [...(listeners.get(name) || []), handler]);
        return this;
      },
      emit(name, data, callback) {
        if (name === 'checkActiveSession') callback({ active: false });
        if (name === 'joinGame' || name === 'createGame') callback({
          success: true, gameId: state.id, color: spectator ? undefined : color,
          isSpectator: spectator, gameState: structuredClone(state),
        });
        if (name === 'makeMove') window.__boardFixture.moves.push(data);
        return this;
      },
    };
  };
}.toString() + ')(' + JSON.stringify(initialState) + ');';

async function fixtureServer() {
  const server = http.createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/socket.io/socket.io.js' || pathname === '/runtime-config.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript' });
        response.end(pathname.includes('socket.io') ? socketFixture : 'window.__KAMISADO_RUNTIME_CONFIG__ = {};');
        return;
      }
      if (pathname === '/favicon.ico') {
        response.writeHead(204).end();
        return;
      }
      const file = pathname === '/' || /^\/game\/[a-z0-9]+$/i.test(pathname)
        ? path.join(publicRoot, 'index.html')
        : path.resolve(publicRoot, '.' + decodeURIComponent(pathname));
      if (!file.startsWith(publicRoot + path.sep)) {
        response.writeHead(403).end();
        return;
      }
      const content = await fs.readFile(file);
      response.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      response.end(content);
    } catch (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, origin: 'http://127.0.0.1:' + server.address().port };
}

async function assert2DBoard(page, symbols) {
  const cells = await page.locator('#board .cell').evaluateAll(elements => elements.map(cell => {
    const bounds = cell.getBoundingClientRect();
    const piece = cell.querySelector('.piece');
    return {
      r: Number(cell.dataset.r), c: Number(cell.dataset.c), classes: [...cell.classList],
      background: getComputedStyle(cell).backgroundColor,
      squareSymbols: [...cell.querySelectorAll('.square-symbol')].map(symbol => {
        const rect = symbol.getBoundingClientRect();
        return {
          color: symbol.dataset.color, path: symbol.querySelector('svg path')?.getAttribute('d'),
          classes: [...symbol.classList],
          dx: rect.x + rect.width / 2 - bounds.x - bounds.width / 2,
          dy: rect.y + rect.height / 2 - bounds.y - bounds.height / 2,
        };
      }),
      piece: piece ? {
        color: piece.dataset.color, classes: [...piece.classList],
        hasTower: !!piece.querySelector('.realistic-tower'),
        markings: [...piece.querySelectorAll('.realistic-tower path')].map(mark => ({
          path: mark.getAttribute('d'), ink: mark.getAttribute('fill'),
        })),
      } : null,
    };
  }));
  assert.equal(cells.length, 64, 'the 2D board must contain all 64 canonical squares');
  assert.equal(new Set(cells.map(cell => cell.r + ',' + cell.c)).size, 64);
  const towerInks = { black: new Set(), white: new Set() };
  for (const cell of cells) {
    const squareColor = BOARD_COLORS[cell.r][cell.c];
    assert.ok(cell.classes.includes(squareColor), 'wrong square color at ' + cell.r + ',' + cell.c);
    const rgb = REALISTIC_COLORS[squareColor].slice(1).match(/../g).map(channel => parseInt(channel, 16));
    assert.equal(cell.background, 'rgb(' + rgb.join(', ') + ')', 'realistic symbol mode must retain the physical square colors');
    assert.equal(cell.squareSymbols.length, symbols ? 2 : 0, 'each marked physical square must have two corner kanji');
    if (symbols) {
      for (const symbol of cell.squareSymbols) {
        assert.equal(symbol.color, squareColor, 'square symbols must retain the canonical color mapping');
        assert.equal(symbol.path, COLOR_CHARACTER_PATHS[squareColor], 'realistic square markings must match the physical kanji');
        assert.ok(symbol.classes.includes('realistic-square-symbol'));
      }
      assert.equal(cell.squareSymbols.filter(symbol => symbol.classes.includes('opposite-symbol')).length, 1);
      const [first, opposite] = cell.squareSymbols;
      assert.ok(first.dx * opposite.dx < 0 && first.dy * opposite.dy < 0, 'the kanji must occupy diagonally opposite corners');
    }
    const piece = initialState.board[cell.r][cell.c];
    if (piece) {
      assert.ok(cell.piece?.hasTower, 'missing realistic tower at ' + cell.r + ',' + cell.c);
      assert.equal(cell.piece.color, piece.color);
      assert.ok(cell.piece.classes.includes(piece.player), 'tower ownership must remain visible');
      const marking = cell.piece.markings.find(mark => mark.path === COLOR_CHARACTER_PATHS[piece.color]);
      assert.ok(marking, 'tower tops must keep their matching kanji with symbols enabled or disabled');
      assert.ok(marking.ink && marking.ink !== 'none', 'tower kanji must remain colored');
      towerInks[piece.player].add(marking.ink);
    } else {
      assert.equal(cell.piece, null);
    }
  }
  assert.equal(new Set(cells.map(cell => cell.background)).size, 8, 'realistic views must retain all eight square colors');
  for (const player of ['black', 'white']) {
    assert.equal(towerInks[player].size, 8, player + ' towers must keep eight distinct colored kanji inks');
  }
  assert.equal(await page.locator('#board .realistic-tower').count(), 16);
  assert.equal(await page.locator('#board .sumo-rank').textContent(), '2');
}

async function assertSymbolLabels(page, requiredColor = null) {
  const expected = color => COLOR_CHARACTER_PATHS[color];
  const legend = await page.locator('#symbol-legend .color-symbol').evaluateAll(symbols => symbols.map(symbol => ({
    color: symbol.dataset.color, path: symbol.querySelector('svg path')?.getAttribute('d'),
  })));
  assert.equal(legend.length, 8);
  assert.equal(new Set(legend.map(symbol => symbol.color)).size, 8);
  for (const symbol of legend) {
    assert.equal(symbol.path, expected(symbol.color), 'the symbol key must match the active board view');
  }
  const required = page.locator('#turn-indicator .required-symbol');
  if (requiredColor) {
    assert.equal(await required.isVisible(), true, 'the required-move symbol must remain visible');
    assert.equal(await required.getAttribute('data-color'), requiredColor);
    assert.equal(await required.locator('svg path').getAttribute('d'), expected(requiredColor));
    assert.ok((await page.locator('#turn-indicator').textContent()).includes('Must move ' + requiredColor.toUpperCase()),
      'the move instruction must use the name belonging to the active symbols');
  } else {
    assert.equal(await required.count(), 0);
  }
}

async function assertWebGLCanvas(page, filename) {
  const canvas = page.locator('#board-3d canvas');
  await canvas.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#board-3d canvas');
    return canvas && canvas.width > 100 && canvas.height > 100;
  });
  // Capture compositor output: WebGL's drawing buffer may clear between frames.
  // Decode with the browser's native PNG codec, avoiding extra dependencies.
  const png = await canvas.screenshot({ path: path.join(screenshots, filename) });
  const tones = await page.evaluate(async base64 => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + base64;
    await img.decode();
    const sample = document.createElement('canvas');
    sample.width = sample.height = 64;
    const context = sample.getContext('2d');
    context.drawImage(img, 0, 0, 64, 64);
    const data = context.getImageData(0, 0, 64, 64).data;
    const colors = new Set();
    for (let i = 0; i < data.length; i += 4) {
      colors.add([data[i] >> 4, data[i + 1] >> 4, data[i + 2] >> 4].join(','));
    }
    return colors.size;
  }, png.toString('base64'));
  assert.ok(tones > 20, '3D canvas must contain geometry, found only ' + tones + ' color tones');
  assert.equal(await page.locator('#board-3d canvas').count(), 1, 'switching views must not accumulate canvases');
}

async function assertFitsViewport(page) {
  const dimensions = await page.evaluate(() => ({
    width: innerWidth, document: document.documentElement.scrollWidth,
    board: document.getElementById('board-container').getBoundingClientRect().toJSON(),
  }));
  if (dimensions.document > dimensions.width + 1) {
    await page.screenshot({ path: path.join(screenshots, 'layout-overflow-' + dimensions.width + '.png'), fullPage: true });
  }
  assert.ok(dimensions.document <= dimensions.width + 1, 'board options must not create horizontal overflow: ' + JSON.stringify(dimensions));
  assert.ok(dimensions.board.left >= -1 && dimensions.board.right <= dimensions.width + 1, 'board must fit the viewport');
}

// Project a cell in the documented default camera view, then exercise the real
// pointer/raycast path. No renderer internals or application test hooks are used.
async function click3DCell(page, r, c, black, tower) {
  const { PerspectiveCamera, Vector3 } = await import('three');
  const box = await page.locator('#board-3d canvas').boundingBox();
  assert.ok(box, 'the 3D board must be visible for pointer input');
  const camera = new PerspectiveCamera(38, box.width / box.height, 0.1, 100);
  camera.position.set(0, 10.8, 11.8);
  camera.lookAt(0, 0.2, 0);
  camera.updateMatrixWorld();
  const facing = black ? -1 : 1;
  const point = new Vector3((c - 3.5) * facing, tower ? 0.727 : 0.239, (r - 3.5) * facing).project(camera);
  await page.mouse.click(box.x + (point.x + 1) * box.width / 2, box.y + (1 - point.y) * box.height / 2);
}

async function assert3DInput(browser, origin, errors, color) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/game/' + initialState.id + '?player=' + color);
  const state = structuredClone(initialState);
  state.turn = color;
  await page.evaluate(state => window.__boardFixture.dispatch('gameStateUpdate', state), state);
  await page.locator('#game-board-view').selectOption('realistic-3d');
  const canvas = page.locator('#board-3d canvas');
  await canvas.waitFor({ state: 'visible' });
  await page.mouse.move(0, 0);
  const original = await canvas.screenshot();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.55, { steps: 12 });
  await page.mouse.up();
  await page.mouse.move(0, 0);
  const rotated = await canvas.screenshot({ path: path.join(screenshots, 'realistic-3d-rotated-' + color + '.png') });
  assert.equal(original.equals(rotated), false, 'dragging must rotate the rendered board');
  assert.deepEqual(await page.evaluate(() => window.__boardFixture.moves), [], 'dragging must not submit a move');
  await page.locator('#reset-camera').click();

  const black = color === 'black';
  const fromR = black ? 0 : 7;
  const toR = black ? 1 : 6;
  await click3DCell(page, fromR, 3, black, true);
  await click3DCell(page, toR, 3, black, false);
  assert.deepEqual(await page.evaluate(() => window.__boardFixture.moves), [{
    gameId: initialState.id, move: { fromR, fromC: 3, toR, toC: 3 },
  }], color + ' must select a 3D tower and move using canonical coordinates');

  // Recreate the view to start keyboard navigation on the home-row corner.
  await page.evaluate(state => {
    window.__boardFixture.moves.length = 0;
    window.__boardFixture.dispatch('gameStateUpdate', state);
  }, state);
  await page.locator('#game-board-view').selectOption('realistic-2d');
  await page.locator('#game-board-view').selectOption('realistic-3d');
  await canvas.focus();
  await canvas.press('Enter');
  await canvas.press('ArrowUp');
  await canvas.press('Enter');
  assert.deepEqual(await page.evaluate(() => window.__boardFixture.moves), [{
    gameId: initialState.id, move: { fromR, fromC: black ? 7 : 0, toR, toC: black ? 7 : 0 },
  }], color + ' must be able to select and move a 3D tower with the keyboard');
  await canvas.evaluate(canvas => canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })));
  await page.locator('#view-notice').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#game-board-view').inputValue(), 'realistic-2d', 'losing WebGL must restore the playable 2D view');
  assert.equal(await page.locator('#board-3d canvas').count(), 0, 'the failed renderer must be removed');
  assert.equal(await page.locator('#board').isVisible(), true);
  await context.close();
  console.log('3D input and context-loss checks passed for ' + color + '.');
}

async function run() {
  await fs.mkdir(screenshots, { recursive: true });
  const { server, origin } = await fixtureServer();
  let browser;
  const errors = [];
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce' });
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    const page = await context.newPage();
    await page.goto(origin);
    assert.equal(await page.locator('#board-view').inputValue(), 'realistic-2d', 'new players must start in the realistic 2D view');
    for (const selector of ['#board-view', '#game-board-view']) {
      assert.deepEqual(await page.locator(selector + ' option').evaluateAll(options => options.map(option => option.value)),
        ['realistic-2d', 'realistic-3d'], 'only the realistic 2D and 3D views must be offered');
    }
    await page.evaluate(() => localStorage.setItem('kamisado_boardView', 'simple'));
    await page.reload();
    assert.equal(await page.locator('#board-view').inputValue(), 'realistic-2d', 'a legacy Simple preference must restore the realistic 2D view');
    assert.equal(await page.evaluate(() => localStorage.getItem('kamisado_boardView')), 'realistic-2d', 'the migrated preference must be saved');
    await page.locator('#symbol-mode').check();
    assert.equal(await page.locator('#game-board-view').inputValue(), 'realistic-2d');
    assert.equal(await page.locator('#game-symbol-mode').isChecked(), true);
    await page.reload();
    assert.equal(await page.locator('#board-view').inputValue(), 'realistic-2d', 'board preference must survive a reload');
    assert.equal(await page.locator('#symbol-mode').isChecked(), true, 'symbol preference must survive a reload');
    await page.screenshot({ path: path.join(screenshots, 'menu-desktop.png'), fullPage: true });
    await page.locator('#create-btn').click();
    await page.locator('#game-screen').waitFor({ state: 'visible' });
    await assert2DBoard(page, true);
    await assertSymbolLabels(page);
    await page.screenshot({ path: path.join(screenshots, 'realistic-2d-symbols-desktop.png'), fullPage: true });
    assert.deepEqual(await page.locator('#board .cell').first().evaluate(cell => [cell.dataset.r, cell.dataset.c]), ['7', '7'], 'black must see its home row at the bottom');
    await page.locator('#game-symbol-mode').uncheck();
    await assert2DBoard(page, false);
    assert.equal(await page.locator('#symbol-mode').isChecked(), false);
    await page.screenshot({ path: path.join(screenshots, 'realistic-2d-desktop.png'), fullPage: true });

    await page.locator('.cell[data-r="0"][data-c="0"]').click();
    assert.equal(await page.locator('.cell.selected').count(), 1);
    await page.locator('#game-board-view').selectOption('realistic-3d');
    await assertWebGLCanvas(page, 'realistic-3d-desktop.png');
    await page.locator('#reset-camera').click();
    await page.locator('#game-symbol-mode').check();
    await assertSymbolLabels(page);
    await assertWebGLCanvas(page, 'realistic-3d-symbols-desktop.png');
    await page.locator('#game-board-view').selectOption('realistic-2d');
    assert.equal(await page.locator('.cell[data-r="0"][data-c="0"]').evaluate(cell => cell.classList.contains('selected')), true, 'changing view must preserve a selected tower');
    await page.locator('.cell[data-r="1"][data-c="0"]').click();
    assert.deepEqual(await page.evaluate(() => window.__boardFixture.moves), [{
      gameId: initialState.id, move: { fromR: 0, fromC: 0, toR: 1, toC: 0 },
    }], 'switching views must preserve canonical move coordinates');
    const afterMove = new KamisadoGame(initialState.id, { timer: '0' });
    afterMove.startGame();
    afterMove.makeMove(0, 0, 1, 0, 'black');
    await page.evaluate(state => window.__boardFixture.dispatch('gameStateUpdate', state), afterMove.toJson());
    assert.equal(await page.locator('.cell[data-r="1"][data-c="0"] .piece').count(), 1);
    assert.equal(await page.locator('.cell.selected').count(), 0);
    await assertSymbolLabels(page, afterMove.requiredColor);
    await page.locator('#game-board-view').selectOption('realistic-3d');
    await assertSymbolLabels(page, afterMove.requiredColor);
    await assertWebGLCanvas(page, 'realistic-3d-after-move.png');
    await page.locator('#game-board-view').selectOption('realistic-2d');
    assert.equal(await page.locator('#board').isVisible(), true);
    assert.equal(await page.locator('#board-3d').isVisible(), false);
    assert.equal(await page.locator('#board .realistic-tower').count(), 16);
    assert.equal(await page.evaluate(() => localStorage.getItem('kamisado_boardView')), 'realistic-2d');
    await assertSymbolLabels(page, afterMove.requiredColor);

    for (const role of ['white', 'spectator']) {
      const roleContext = await browser.newContext({ viewport: { width: 1000, height: 1000 } });
      const rolePage = await roleContext.newPage();
      rolePage.on('pageerror', error => errors.push(error.message));
      await rolePage.goto(origin + '/game/' + initialState.id + '?' + (role === 'white' ? 'player=white' : 'spectator=1'));
      await rolePage.locator('#game-board-view').selectOption('realistic-2d');
      await assert2DBoard(rolePage, false);
      assert.deepEqual(await rolePage.locator('#board .cell').first().evaluate(cell => [cell.dataset.r, cell.dataset.c]), ['0', '0']);
      await rolePage.locator('.cell[data-r="7"][data-c="7"]').click();
      assert.equal(await rolePage.locator('.cell.selected').count(), 0, role + ' must not act on black\'s turn');
      assert.deepEqual(await rolePage.evaluate(() => window.__boardFixture.moves), []);
      await rolePage.locator('#game-board-view').selectOption('realistic-3d');
      await assertWebGLCanvas(rolePage, 'realistic-3d-' + role + '.png');
      await roleContext.close();
    }

    await assert3DInput(browser, origin, errors, 'black');
    await assert3DInput(browser, origin, errors, 'white');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#game-board-view').selectOption('realistic-2d');
    await assertFitsViewport(page);
    await page.screenshot({ path: path.join(screenshots, 'realistic-2d-symbols-mobile.png'), fullPage: true });
    await page.locator('#game-board-view').selectOption('realistic-3d');
    await assertFitsViewport(page);
    await assertWebGLCanvas(page, 'realistic-3d-symbols-mobile.png');
    await page.screenshot({ path: path.join(screenshots, 'realistic-3d-mobile-page.png'), fullPage: true });
    await page.setViewportSize({ width: 320, height: 700 });
    await assertFitsViewport(page);
    await page.screenshot({ path: path.join(screenshots, 'realistic-3d-narrow-mobile.png'), fullPage: true });
    await page.locator('#game-board-view').selectOption('realistic-2d');
    await assertFitsViewport(page);
    await page.screenshot({ path: path.join(screenshots, 'realistic-2d-narrow-mobile.png'), fullPage: true });
    await context.close();

    const fallback = await browser.newContext();
    await fallback.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
        if (String(kind).includes('webgl')) return null;
        return original.call(this, kind, ...args);
      };
      localStorage.setItem('kamisado_boardView', 'realistic-3d');
    });
    const fallbackPage = await fallback.newPage();
    fallbackPage.on('pageerror', error => errors.push(error.message));
    await fallbackPage.goto(origin + '/game/' + initialState.id);
    await fallbackPage.locator('#view-notice').waitFor({ state: 'visible' });
    assert.equal(await fallbackPage.locator('#game-board-view').inputValue(), 'realistic-2d');
    assert.equal(await fallbackPage.locator('#board').isVisible(), true);
    await assert2DBoard(fallbackPage, false);
    await fallbackPage.screenshot({ path: path.join(screenshots, 'webgl-fallback.png'), fullPage: true });
    await fallback.close();
    assert.deepEqual(errors, [], 'board views must not produce uncaught browser errors');
    console.log('Board-view browser checks passed (desktop, mobile, player/spectator, persistence, pointer/keyboard moves, drag controls, WebGL fallback).');
    console.log('Screenshots: ' + path.relative(root, screenshots));
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
