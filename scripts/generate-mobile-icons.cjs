// Regenerate native artwork after editing mobile/icon.svg. Requires Playwright Chromium.
const { chromium } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
(async () => {
  const svg = await fs.readFile(path.join(root, 'mobile/icon.svg'), 'utf8');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    async function render(file, size) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent('<style>body{margin:0}svg{width:100vw;height:100vh;display:block}</style>' + svg);
      await page.screenshot({ path: path.join(root, file) });
    }
    await render('mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', 1024);
    for (const [density, size] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
      for (const name of ['ic_launcher', 'ic_launcher_round', 'ic_launcher_foreground']) {
        await render(`mobile/android/app/src/main/res/mipmap-${density}/${name}.png`, name.endsWith('foreground') ? size * 2 : size);
      }
    }
    // A plain launch background avoids showing template branding before the game loads.
    const png = await (async () => {
      await page.setViewportSize({ width: 16, height: 16 });
      await page.setContent('<style>html{background:#191c22}</style>');
      return page.screenshot();
    })();
    for (const dir of await fs.readdir(path.join(root, 'mobile/android/app/src/main/res'))) {
      if (dir.startsWith('drawable')) {
        const file = path.join(root, 'mobile/android/app/src/main/res', dir, 'splash.png');
        try { await fs.access(file); await fs.writeFile(file, png); } catch { /* Not every density has a splash. */ }
      }
    }
    for (const file of await fs.readdir(path.join(root, 'mobile/ios/App/App/Assets.xcassets/Splash.imageset'))) {
      if (file.endsWith('.png')) await fs.writeFile(path.join(root, 'mobile/ios/App/App/Assets.xcassets/Splash.imageset', file), png);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
