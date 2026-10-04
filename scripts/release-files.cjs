const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

async function prepareDestination(destination, sources) {
  for (const source of sources) {
    const relative = path.relative(path.resolve(source), destination);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
      throw new Error('Release destination must be outside its source');
    }
  }
  await fs.mkdir(destination, { recursive: true });
  if ((await fs.readdir(destination)).length) throw new Error(`Release output must be empty: ${destination}. Move the previous build elsewhere first.`);
}

async function writeChecksums(directory, names, filename) {
  const entries = [];
  for (const name of names) {
    const bytes = await fs.readFile(path.join(directory, name));
    entries.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`);
  }
  await fs.writeFile(path.join(directory, filename), `${entries.join('\n')}\n`);
}

module.exports = { prepareDestination, writeChecksums };
