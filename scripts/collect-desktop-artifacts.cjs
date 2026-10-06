const fs = require('node:fs/promises');
const path = require('node:path');
const { prepareDestination, writeChecksums } = require('./release-files.cjs');

const platforms = { win32: 'Windows', linux: 'Linux', darwin: 'macOS' };

// Forge's ZIP includes the complete Electron runtime, not just the executable.
async function collectDownloads({ platform = process.platform, arch = process.arch,
  source, destination, application, version = require('../package.json').version } = {}) {
  const label = platforms[platform];
  if (!label) throw new Error(`Unsupported desktop platform: ${platform}`);
  if (!/^(x64|arm64)$/.test(arch) || !/^[\w.-]+$/.test(version)) throw new Error('Invalid architecture or version');
  source = path.resolve(source ?? `out/make/zip/${platform}/${arch}`);
  application = path.resolve(application ?? `out/Kamisado-${platform}-${arch}`);
  destination = path.resolve(destination ?? `out/release/${label}-desktop`);
  const archive = `Kamisado-${platform}-${arch}-${version}.zip`;
  const executable = platform === 'darwin' ? 'Kamisado.app/Contents/MacOS/Kamisado'
    : platform === 'win32' ? 'Kamisado.exe' : 'Kamisado';
  // Validate everything before creating output. Never collect stale installers.
  await fs.access(path.join(source, archive));
  await fs.access(path.join(application, executable));
  await fs.access(path.join(application, platform === 'darwin' ? 'Kamisado.app/Contents/Resources/app.asar' : 'resources/app.asar'));
  const guide = await fs.readFile(path.join(__dirname, '../desktop/START-HERE.txt'));
  await prepareDestination(destination, [source, application]);
  const downloadName = `Kamisado-${version}-${label}-${arch}-portable.zip`;
  const guideName = `START-HERE-${label}-${arch}.txt`;
  const checksumName = `SHA256SUMS-${label}-${arch}.txt`;
  await fs.copyFile(path.join(source, archive), path.join(destination, downloadName));
  await fs.cp(application, path.join(destination, 'Kamisado'), { recursive: true, verbatimSymlinks: true });
  const launch = `Kamisado/${platform === 'darwin' ? 'Kamisado.app' : executable}`;
  await fs.writeFile(path.join(destination, guideName),
    `Kamisado for ${label} (${arch})\n\nPlay now: open ${launch}\nShare: send ${downloadName}\nNo installation is required. Extract the whole ZIP before opening the app.\nKeep all files in the Kamisado folder together.\n\n${guide}`);
  await writeChecksums(destination, [downloadName, guideName], checksumName);
  return { downloads: 1, destination, downloadName, guideName, checksumName };
}

module.exports = { collectDownloads };

if (require.main === module) {
  const [source, destination, arch, ...extra] = process.argv.slice(2);
  if (extra.length) {
    console.error('Usage: node scripts/collect-desktop-artifacts.cjs [zip-directory] [destination] [x64|arm64]');
    process.exitCode = 1;
  } else collectDownloads({ source, destination, arch }).then(result => {
    console.log(`Portable application, ZIP, instructions, and checksums: ${result.destination}`);
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
