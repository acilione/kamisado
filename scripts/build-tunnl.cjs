// The same connector is bundled in Electron and Android; players need no SSH tools.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
async function main() {
  const android = process.argv.includes('--android');
  const source = path.join(root, 'native/tunnl');
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'kamisado-tunnl-build-'));
  await fs.cp(source, cache, { recursive: true });
  if (android) await fs.copyFile(path.join(root, 'scripts/android-cloudflared-dns.go'), path.join(cache, 'android_dns.go'));
  const targets = android ? [['android', 'arm64', 'arm64-v8a'], ['android', 'amd64', 'x86_64']]
    : [[process.env.TUNNL_GOOS || ({ win32: 'windows', darwin: 'darwin', linux: 'linux' }[process.platform]),
      process.env.TUNNL_GOARCH || (process.arch === 'x64' ? 'amd64' : process.arch), '']];
  for (const [goos, goarch, abi] of targets) {
    if (android && process.env.KAMISADO_ANDROID_ABIS && !process.env.KAMISADO_ANDROID_ABIS.split(',').includes(abi)) continue;
    if (!['windows', 'linux', 'darwin', 'android'].includes(goos) || !['amd64', 'arm64'].includes(goarch)) throw new Error('Unsupported tunnl.gg connector target.');
    const platform = goos === 'windows' ? 'win32' : goos;
    const arch = goarch === 'amd64' ? 'x64' : goarch;
    const output = android ? path.join(root, 'mobile/android/app/src/main/jniLibs', abi, 'libtunnl.so')
      : path.join(root, 'desktop/connectors', `${platform}-${arch}`, goos === 'windows' ? 'tunnl.exe' : 'tunnl');
    await fs.mkdir(path.dirname(output), { recursive: true });
    const env = { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: android ? '1' : '0' };
    if (android) {
      if (!env.ANDROID_NDK_HOME) throw new Error('Set ANDROID_NDK_HOME to build Android connectors.');
      const host = process.platform === 'win32' ? 'windows-x86_64' : process.platform === 'darwin' ? 'darwin-x86_64' : 'linux-x86_64';
      const triple = goarch === 'arm64' ? 'aarch64-linux-android' : 'x86_64-linux-android';
      env.CC = '"' + path.join(env.ANDROID_NDK_HOME, 'toolchains/llvm/prebuilt', host, 'bin', triple + '24-clang' + (process.platform === 'win32' ? '.cmd' : '')) + '"';
      env.CGO_LDFLAGS = '-Wl,-z,max-page-size=16384';
    }
    await new Promise((resolve, reject) => {
      const child = spawn(env.GO_BINARY || 'go', ['build', '-mod=readonly', '-trimpath', '-ldflags=-s -w', '-o', output, '.'], { cwd: cache, env, stdio: 'inherit', windowsHide: true });
      child.once('error', () => reject(new Error('Install Go 1.26 or newer to build the bundled tunnl.gg connector.')));
      child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Connector build failed (${code}).`)));
    });
    console.log(`Built tunnl.gg connector for ${goos}/${goarch}`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
