const esbuild = require('esbuild');

esbuild.buildSync({
  entryPoints: ['src/client/client.ts'],
  bundle: true,
  outfile: 'public/client.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  external: [],
  // Socket.IO is served locally by the host; globals.d.ts types its `io` function.
  define: {},
});

console.log('Client built: public/client.js');
