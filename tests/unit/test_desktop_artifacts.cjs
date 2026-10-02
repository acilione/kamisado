'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { collectDownloads } = require('../../scripts/collect-desktop-artifacts.cjs');
const forge = require('../../forge.config');

async function fixture(t, names) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kamisado-artifacts-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('kamisado-artifacts-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const source = path.join(directory, 'make');
  const destination = path.join(directory, 'release');
  await fs.mkdir(source);
  for (const name of names) {
    const file = path.join(source, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `test download: ${name}\n`);
  }
  return { source, destination };
}

test('Linux release includes ZIP, installers, readable quickstart, and correct checksums', async t => {
  const directories = await fixture(t, ['zip/Kamisado-linux-x64-1.0.0.zip', 'deb/kamisado.deb', 'rpm/kamisado.rpm', 'ignored.log']);
  const result = await collectDownloads({ ...directories, platform: 'linux', arch: 'x64' });
  assert.equal(result.downloads, 3);
  assert.equal(result.guideName, 'START-HERE-linux-x64.txt');
  const guide = await fs.readFile(path.join(result.destination, result.guideName), 'utf8');
  assert.match(guide, /Host a LAN game/);
  assert.match(guide, /No Node.js, terminal, or development tools/);
  const entries = (await fs.readFile(path.join(result.destination, result.checksumName), 'utf8')).trim().split('\n');
  assert.equal(entries.length, 4);
  for (const entry of entries) {
    const [expected, name] = entry.split('  ');
    assert.equal(expected, createHash('sha256').update(await fs.readFile(path.join(result.destination, name))).digest('hex'));
  }
  assert.equal((await fs.readdir(result.destination)).length, 5, 'exclude unrelated build files');
});

test('release collection requires a portable ZIP on Linux and Windows', async t => {
  for (const [platform, downloads] of [['linux', ['kamisado.deb', 'kamisado.rpm']], ['win32', ['Setup.exe']]]) {
    const directories = await fixture(t, downloads);
    await assert.rejects(collectDownloads({ ...directories, platform }), /Missing \.zip download/);
    await assert.rejects(fs.access(directories.destination), { code: 'ENOENT' }, 'failed validation must not create a partial release');
  }
});

test('Windows release preserves Squirrel installer and update files', async t => {
  const directories = await fixture(t, ['Setup.exe', 'Kamisado-win32-x64.zip', 'RELEASES', 'kamisado-full.nupkg']);
  const result = await collectDownloads({ ...directories, platform: 'win32', arch: 'x64' });
  assert.equal(result.downloads, 4);
  await fs.access(path.join(result.destination, 'RELEASES'));
  await fs.access(path.join(result.destination, 'START-HERE-win32-x64.txt'));
});

test('an explicit format list supports local ZIP/DEB builds without weakening release defaults', async t => {
  const directories = await fixture(t, ['Kamisado.zip', 'kamisado.deb']);
  await assert.rejects(collectDownloads({ ...directories, platform: 'linux' }), /Missing \.rpm download/);
  await assert.rejects(collectDownloads({ ...directories, formats: [] }), /Download formats/);
  await assert.rejects(collectDownloads({ ...directories, formats: ['zip', 'unknown'] }), /Download formats/);
  const result = await collectDownloads({ ...directories, platform: 'linux', formats: ['zip', 'deb'] });
  assert.equal(result.downloads, 2);
});

test('release collection refuses duplicate asset names or older output', async t => {
  const duplicate = await fixture(t, ['one/Kamisado.zip', 'two/kamisado.zip']);
  await assert.rejects(collectDownloads({ ...duplicate, platform: 'darwin' }), /Duplicate download name/);

  const existing = await fixture(t, ['Kamisado.zip']);
  await fs.mkdir(existing.destination);
  await fs.writeFile(path.join(existing.destination, 'older-build.zip'), 'keep this');
  await assert.rejects(collectDownloads({ ...existing, platform: 'darwin' }), /Release output must be empty/);
  assert.equal(await fs.readFile(path.join(existing.destination, 'older-build.zip'), 'utf8'), 'keep this');
});

test('packaged ZIP directory contains a quickstart beside the executable', async t => {
  const { destination } = await fixture(t, []);
  await fs.mkdir(destination);
  await fs.writeFile(path.join(destination, 'Kamisado'), 'fake executable');
  await forge.hooks.postPackage(forge, { outputPaths: [destination], platform: 'linux', arch: 'x64' });
  assert.equal(await fs.readFile(path.join(destination, 'START-HERE.txt'), 'utf8'),
    await fs.readFile(path.join(__dirname, '../../desktop/START-HERE.txt'), 'utf8'));
  assert.equal(await fs.readFile(path.join(destination, 'Kamisado'), 'utf8'), 'fake executable');
  assert.ok(forge.makers.find(maker => maker.name === '@electron-forge/maker-zip').platforms.includes('linux'));
});
