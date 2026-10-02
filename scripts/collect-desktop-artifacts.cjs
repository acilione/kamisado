const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function findDownloads(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findDownloads(file));
    else if (entry.isFile() && (/\.(exe|zip|deb|rpm|nupkg)$/i.test(entry.name) || entry.name === 'RELEASES')) files.push(file);
  }
  return files.sort();
}

async function collectDownloads({
  source = 'out/make',
  destination = 'out/release',
  platform = process.platform,
  arch = process.arch,
  formats,
} = {}) {
  source = path.resolve(source);
  destination = path.resolve(destination);
  const downloads = await findDownloads(source);
  const defaults = platform === 'win32' ? ['exe', 'zip'] : platform === 'linux' ? ['zip', 'deb', 'rpm'] : ['zip'];
  const requested = formats ?? defaults;
  if (!Array.isArray(requested) || !requested.length || requested.some(format => !['exe', 'zip', 'deb', 'rpm'].includes(format))) {
    throw new Error('Download formats must be a non-empty list of exe, zip, deb, or rpm');
  }
  const required = requested.map(format => `.${format}`);
  for (const extension of required) {
    if (!downloads.some(file => file.toLowerCase().endsWith(extension))) {
      throw new Error(`Missing ${extension} download in ${source}`);
    }
  }

  const guideName = `START-HERE-${platform}-${arch}.txt`;
  const checksumName = `SHA256SUMS-${platform}-${arch}.txt`;
  const names = new Set([guideName.toLowerCase(), checksumName.toLowerCase()]);
  for (const file of downloads) {
    const name = path.basename(file);
    if (names.has(name.toLowerCase())) throw new Error(`Duplicate download name: ${name}`);
    names.add(name.toLowerCase());
  }

  // Never silently mix older builds with this release's checksums.
  await fs.mkdir(destination, { recursive: true });
  if ((await fs.readdir(destination)).length) throw new Error(`Release output must be empty: ${destination}`);
  const checksums = [];
  for (const file of downloads) {
    const name = path.basename(file);
    const bytes = await fs.readFile(file);
    await fs.writeFile(path.join(destination, name), bytes);
    checksums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
  }
  const guide = await fs.readFile(path.join(__dirname, '..', 'desktop', 'START-HERE.txt'));
  await fs.writeFile(path.join(destination, guideName), guide);
  checksums.push(`${createHash('sha256').update(guide).digest('hex')}  ${guideName}`);
  await fs.writeFile(path.join(destination, checksumName), `${checksums.join('\n')}\n`);
  return { downloads: downloads.length, guideName, checksumName, destination };
}

module.exports = { collectDownloads };

if (require.main === module) {
  const [source, destination, formatsFlag, ...extra] = process.argv.slice(2);
  if (extra.length || (formatsFlag && !formatsFlag.startsWith('--formats='))) {
    console.error('Usage: node scripts/collect-desktop-artifacts.cjs [source] [destination] [--formats=zip,deb]');
    process.exitCode = 1;
  } else collectDownloads({ source, destination, formats: formatsFlag?.slice('--formats='.length).split(',') }).then(result => {
    console.log(`Collected ${result.downloads} downloads, ${result.guideName}, and ${result.checksumName} in ${result.destination}`);
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
