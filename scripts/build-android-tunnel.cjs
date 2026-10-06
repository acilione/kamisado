// Build the official Cloudflare source for Android; no Termux or runtime executable downloads.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const version = '2026.10.0';
const sourceHash = '60203c146da07015fda8b1c583939828913f1310d63716666124a89c0f86bd8c';
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', windowsHide: true, ...options });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} failed (${code})`)));
  });
}
async function main() {
  const ndk = process.env.ANDROID_NDK_HOME;
  if (!ndk) throw new Error('Set ANDROID_NDK_HOME to an Android NDK installation (26.1 or newer). Go 1.26 or newer must be on PATH.');
  const cache = path.resolve(process.env.KAMISADO_TUNNEL_BUILD_DIR || path.join(root, 'out/android-tunnel'));
  await fs.mkdir(cache, { recursive: true });
  const archive = path.join(cache, `cloudflared-${version}.tar.gz`);
  let data = await fs.readFile(archive).catch(() => null);
  if (!data || createHash('sha256').update(data).digest('hex') !== sourceHash) {
    const response = await fetch(`https://github.com/cloudflare/cloudflared/archive/refs/tags/${version}.tar.gz`, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error('Could not download Cloudflare source.');
    data = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(data).digest('hex') !== sourceHash) throw new Error('Cloudflare source verification failed.');
    await fs.writeFile(archive, data);
  }
  await run('tar', ['-xzf', archive, '-C', cache]);
  await fs.copyFile(path.join(__dirname, 'android-cloudflared-dns.go'),
    path.join(cache, `cloudflared-${version}/cmd/cloudflared/kamisado_android_dns.go`));
  const host = process.platform === 'win32' ? 'windows-x86_64' : process.platform === 'darwin' ? 'darwin-x86_64' : 'linux-x86_64';
  const bin = path.join(ndk, 'toolchains/llvm/prebuilt', host, 'bin');
  const targets = { 'arm64-v8a': ['arm64', 'aarch64-linux-android'], 'x86_64': ['amd64', 'x86_64-linux-android'] };
  for (const abi of (process.env.KAMISADO_ANDROID_ABIS || 'arm64-v8a,x86_64').split(',')) {
    if (!targets[abi]) throw new Error(`Unsupported ABI: ${abi}`);
    const [arch, target] = targets[abi];
    const output = path.join(root, 'mobile/android/app/src/main/jniLibs', abi, 'libcloudflared.so');
    await fs.mkdir(path.dirname(output), { recursive: true });
    const cc = path.join(bin, target + '24-clang' + (process.platform === 'win32' ? '.cmd' : ''));
    await run(process.env.GO_BINARY || 'go', ['build', '-mod=readonly', '-trimpath', '-ldflags', `-s -w -X main.Version=${version}`, '-o', output, './cmd/cloudflared'], {
      cwd: path.join(cache, `cloudflared-${version}`),
      env: { ...process.env, GOOS: 'android', GOARCH: arch, CGO_ENABLED: '1', CC: `"${cc}"`,
        CGO_LDFLAGS: '-Wl,-z,max-page-size=16384' },
    });
    console.log(`Built Android Cloudflare connector: ${abi}`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
