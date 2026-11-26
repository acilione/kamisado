const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const release = process.argv.includes('--release');

const root = path.resolve(__dirname, '..');
const destination = path.join(root, 'out/mobile');
fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
// The mobile app uses the web page and styles directly; there is no second board UI.
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8').replace(/\r\n/g, '\n')
  .replace('    <script src="/socket.io/socket.io.js"></script>\n', '')
  .replace('    <script src="/runtime-config.js"></script>\n', '')
  .replace('/client.js', '/mobile.js');
fs.writeFileSync(path.join(destination, 'index.html'), html);
for (const file of ['style.css', 'realistic.css']) {
  const css = fs.readFileSync(path.join(root, 'public', file), 'utf8');
  fs.writeFileSync(path.join(destination, file), release
    ? esbuild.transformSync(css, { loader: 'css', minify: true, legalComments: 'inline' }).code : css);
}
fs.cpSync(path.join(root, 'public/licenses'), path.join(destination, 'licenses'), { recursive: true });
const common = { absWorkingDir: root, bundle: true, platform: 'browser', format: 'iife',
  target: ['chrome100', 'safari15.4'], minify: release, legalComments: 'inline' };
const worker = esbuild.buildSync({ ...common, entryPoints: ['src/mobile/ai-worker.ts'], write: false });
esbuild.buildSync({ ...common, entryPoints: ['src/mobile/main.ts'], outfile: path.join(destination, 'mobile.js'),
  define: { KAMISADO_AI_WORKER_SOURCE: JSON.stringify(worker.outputFiles[0].text) } });
console.log(`Mobile web assets built in out/mobile (${release ? 'optimized release' : 'debug'})`);
// Android serves the same board to browser guests, without exposing Capacitor assets or plugins.
const guestRoot = path.join(root, 'mobile/android/app/src/main/assets/tunnel');
fs.mkdirSync(guestRoot, { recursive: true });
fs.writeFileSync(path.join(guestRoot, 'index.html'), html.replace('/mobile.js', '/guest.js'));
for (const file of ['style.css', 'realistic.css']) fs.copyFileSync(path.join(destination, file), path.join(guestRoot, file));
esbuild.buildSync({ ...common, entryPoints: ['src/mobile/tunnel-guest.ts'], outfile: path.join(guestRoot, 'guest.js') });
