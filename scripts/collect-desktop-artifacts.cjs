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

async function main() {
  const source = path.resolve(process.argv[2] || 'out/make');
  const destination = path.resolve(process.argv[3] || 'out/release');
  const downloads = await findDownloads(source);
  const required = process.platform === 'win32' ? ['.exe', '.zip'] : process.platform === 'linux' ? ['.deb', '.rpm'] : ['.zip'];
  for (const extension of required) {
    if (!downloads.some(file => file.toLowerCase().endsWith(extension))) {
      throw new Error(`Missing ${extension} download in ${source}`);
    }
  }

  const names = new Set();
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
  const checksumName = `SHA256SUMS-${process.platform}-${process.arch}.txt`;
  await fs.writeFile(path.join(destination, checksumName), `${checksums.join('\n')}\n`);
  console.log(`Collected ${downloads.length} downloads and ${checksumName} in ${destination}`);
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
