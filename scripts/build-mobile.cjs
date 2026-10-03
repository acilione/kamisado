const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

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
  fs.copyFileSync(path.join(root, 'public', file), path.join(destination, file));
}
fs.cpSync(path.join(root, 'public/licenses'), path.join(destination, 'licenses'), { recursive: true });
const common = { absWorkingDir: root, bundle: true, platform: 'browser', format: 'iife', target: ['chrome100', 'safari15.4'] };
const worker = esbuild.buildSync({ ...common, entryPoints: ['src/mobile/ai-worker.ts'], write: false });
esbuild.buildSync({ ...common, entryPoints: ['src/mobile/main.ts'], outfile: path.join(destination, 'mobile.js'),
  define: { KAMISADO_AI_WORKER_SOURCE: JSON.stringify(worker.outputFiles[0].text) } });
console.log('Mobile web assets built in out/mobile');
