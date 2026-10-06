'use strict';

const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { collectDownloads } = require('../../scripts/collect-desktop-artifacts.cjs');
const { collectAndroid } = require('../../scripts/collect-android-artifacts.cjs');
const forge = require('../../forge.config');

async function fixture(t, platform = 'linux') {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kamisado-artifacts-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('kamisado-artifacts-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const source = path.join(directory, 'zip');
  const application = path.join(directory, 'app');
  const destination = path.join(directory, 'release');
  const executable = platform === 'win32' ? 'Kamisado.exe' : 'Kamisado';
  await fs.mkdir(source);
  await fs.mkdir(path.join(application, 'resources'), { recursive: true });
  await fs.writeFile(path.join(application, executable), 'executable', { mode: 0o755 });
  await fs.writeFile(path.join(application, 'resources/app.asar'), 'game code');
  await fs.writeFile(path.join(application, 'runtime.dat'), 'required runtime');
  await fs.writeFile(path.join(source, `Kamisado-${platform}-x64-1.0.0.zip`), 'portable ZIP');
  return { source, application, destination, platform, arch: 'x64', version: '1.0.0' };
}

async function verifyChecksums(directory, filename) {
  const entries = (await fs.readFile(path.join(directory, filename), 'utf8')).trim().split('\n');
  for (const entry of entries) {
    const [expected, name] = entry.split('  ');
    assert.equal(expected, createHash('sha256').update(await fs.readFile(path.join(directory, name))).digest('hex'));
  }
  return entries.length;
}

test('portable Windows and Linux outputs include the complete runtime, ZIP, guide, and checksums', async t => {
  for (const platform of ['win32', 'linux']) {
    const fixtureFiles = await fixture(t, platform);
    // Old installer and ZIP versions must never enter the new release.
    await fs.writeFile(path.join(fixtureFiles.source, 'Setup.exe'), 'old installer');
    await fs.writeFile(path.join(fixtureFiles.source, `Kamisado-${platform}-x64-0.9.0.zip`), 'old ZIP');
    const result = await collectDownloads(fixtureFiles);
    const label = platform === 'win32' ? 'Windows' : 'Linux';
    assert.equal(result.downloadName, `Kamisado-1.0.0-${label}-x64-portable.zip`);
    assert.equal(await fs.readFile(path.join(result.destination, result.downloadName), 'utf8'), 'portable ZIP');
    assert.equal(await fs.readFile(path.join(result.destination, 'Kamisado/resources/app.asar'), 'utf8'), 'game code');
    assert.equal(await fs.readFile(path.join(result.destination, 'Kamisado/runtime.dat'), 'utf8'), 'required runtime');
    assert.match(await fs.readFile(path.join(result.destination, result.guideName), 'utf8'), /No installation is required/);
    assert.equal(await verifyChecksums(result.destination, result.checksumName), 2);
    assert.equal((await fs.readdir(result.destination)).length, 4);
    if (platform === 'linux' && process.platform !== 'win32') {
      assert.equal((await fs.stat(path.join(result.destination, 'Kamisado/Kamisado'))).mode & 0o111, 0o111);
    }
  }
});

test('missing ZIP or runtime fails before creating a release', async t => {
  for (const missing of ['zip', 'runtime']) {
    const files = await fixture(t);
    await fs.unlink(missing === 'zip' ? path.join(files.source, 'Kamisado-linux-x64-1.0.0.zip') : path.join(files.application, 'resources/app.asar'));
    await assert.rejects(collectDownloads(files), { code: 'ENOENT' });
    await assert.rejects(fs.access(files.destination), { code: 'ENOENT' });
  }
});

test('release collection preserves older output and rejects recursive destinations', async t => {
  const files = await fixture(t);
  await fs.mkdir(files.destination);
  await fs.writeFile(path.join(files.destination, 'older-build.zip'), 'keep this');
  await assert.rejects(collectDownloads(files), /Release output must be empty/);
  assert.equal(await fs.readFile(path.join(files.destination, 'older-build.zip'), 'utf8'), 'keep this');
  await assert.rejects(collectDownloads({ ...files, destination: path.join(files.application, 'nested') }), /outside its source/);
  await assert.rejects(collectDownloads({ ...files, arch: '../x64' }), /Invalid architecture/);
});

test('Android collection names the test APK and includes installation instructions and checksums', async t => {
  const files = await fixture(t);
  const source = path.join(files.source, 'app-debug.apk');
  await fs.writeFile(source, 'test APK');
  const result = await collectAndroid({ source, destination: files.destination, version: '1.0.0' });
  assert.equal(result.downloadName, 'Kamisado-1.0.0-Android-test.apk');
  assert.equal(await fs.readFile(path.join(result.destination, result.downloadName), 'utf8'), 'test APK');
  assert.match(await fs.readFile(path.join(result.destination, 'START-HERE-Android.txt'), 'utf8'), /open it to install/);
  assert.equal(await verifyChecksums(result.destination, 'SHA256SUMS-Android.txt'), 3);
  await assert.rejects(collectAndroid({ source, destination: result.destination }), /Release output must be empty/);
});

test('packaged ZIP includes a quickstart beside the executable and only portable makers are enabled', async t => {
  const files = await fixture(t);
  await forge.hooks.postPackage(forge, { outputPaths: [files.application], platform: 'linux', arch: 'x64' });
  assert.equal(await fs.readFile(path.join(files.application, 'START-HERE.txt'), 'utf8'),
    await fs.readFile(path.join(__dirname, '../../desktop/START-HERE.txt'), 'utf8'));
  assert.deepEqual(forge.makers.map(maker => maker.name), ['@electron-forge/maker-zip']);
});
