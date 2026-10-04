const fs = require('node:fs/promises');
const path = require('node:path');
const { prepareDestination, writeChecksums } = require('./release-files.cjs');

async function collectAndroid({ source = 'mobile/android/app/build/outputs/apk/debug/app-debug.apk',
  destination = 'out/release/Android', version = require('../package.json').version } = {}) {
  if (!/^[\w.-]+$/.test(version)) throw new Error('Invalid version');
  source = path.resolve(source);
  destination = path.resolve(destination);
  const apk = await fs.readFile(source);
  // This command collects debug APKs; signed distribution needs a separate release process.
  const name = `Kamisado-${version}-Android-test.apk`;
  const guide = await fs.readFile(path.join(__dirname, '../docs/mobile.md'));
  await prepareDestination(destination, [source]);
  await fs.writeFile(path.join(destination, name), apk);
  await fs.writeFile(path.join(destination, 'START-HERE-Android.txt'),
    `Kamisado for Android\n\nTransfer ${name} to your phone and open it to install.\nAndroid may ask you to allow installation from your browser or file manager.\nOpen Kamisado from your apps after installation.\n\nThis is a development-signed test build. Android requires installation;\nonly the desktop versions run directly from an extracted folder.\nAndroid 7 or newer and Android System WebView 100 or newer are required.\nSee MOBILE-GUIDE.md for details.\n`);
  await fs.writeFile(path.join(destination, 'MOBILE-GUIDE.md'), guide);
  await writeChecksums(destination, [name, 'START-HERE-Android.txt', 'MOBILE-GUIDE.md'], 'SHA256SUMS-Android.txt');
  return { destination, downloadName: name };
}

module.exports = { collectAndroid };
if (require.main === module) {
  const [source, destination, ...extra] = process.argv.slice(2);
  if (extra.length) {
    console.error('Usage: node scripts/collect-android-artifacts.cjs [debug-apk] [destination]');
    process.exitCode = 1;
  } else collectAndroid({ source, destination }).then(result => {
    console.log(`Android APK, instructions, and checksums: ${result.destination}`);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
