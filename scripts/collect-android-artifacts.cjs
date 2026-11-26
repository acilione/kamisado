const fs = require('node:fs/promises');
const path = require('node:path');
const { prepareDestination, writeChecksums } = require('./release-files.cjs');

async function collectAndroid({ source, variant = 'debug',
  destination = 'out/release/Android', version = require('../package.json').version } = {}) {
  if (!['debug', 'release'].includes(variant)) throw new Error('Invalid Android build variant');
  source ??= `mobile/android/app/build/outputs/apk/${variant}/app-${variant}.apk`;
  if (!/^[\w.-]+$/.test(version)) throw new Error('Invalid version');
  source = path.resolve(source);
  destination = path.resolve(destination);
  const apk = await fs.readFile(source);
  const name = `Kamisado-${version}-Android${variant === 'debug' ? '-test' : ''}.apk`;
  const guide = await fs.readFile(path.join(__dirname, '../docs/mobile.md'));
  await prepareDestination(destination, [source]);
  await fs.writeFile(path.join(destination, name), apk);
  await fs.writeFile(path.join(destination, 'START-HERE-Android.txt'),
    `Kamisado for Android\n\nTransfer ${name} to your phone and open it to install.\nAndroid may ask you to allow installation from your browser or file manager.\nOpen Kamisado from your apps after installation.\n\n${variant === 'debug' ? 'This is a development-signed test build.' : 'This is the optimized release build. A previously installed debug build uses a different signing key and must be uninstalled first; uninstalling removes its saved settings.'}\nAndroid requires installation; only the desktop versions run directly from an extracted folder.\nA 64-bit ARM or x86_64 device, Android 7 or newer, and Android System WebView 100 or newer are required.\nSee MOBILE-GUIDE.md for details.\n`);
  await fs.writeFile(path.join(destination, 'MOBILE-GUIDE.md'), guide);
  await writeChecksums(destination, [name, 'START-HERE-Android.txt', 'MOBILE-GUIDE.md'], 'SHA256SUMS-Android.txt');
  return { destination, downloadName: name };
}

module.exports = { collectAndroid };
if (require.main === module) {
  const args = process.argv.slice(2);
  const variant = args.includes('--release') ? 'release' : 'debug';
  const [source, destination, ...extra] = args.filter(arg => arg !== '--release');
  if (extra.length) {
    console.error('Usage: node scripts/collect-android-artifacts.cjs [--release] [apk] [destination]');
    process.exitCode = 1;
  } else collectAndroid({ source, destination, variant }).then(result => {
    console.log(`Android APK, instructions, and checksums: ${result.destination}`);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
