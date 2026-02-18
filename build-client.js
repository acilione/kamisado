const esbuild = require('esbuild');

esbuild.buildSync({
  entryPoints: ['src/client/client.ts'],
  bundle: true,
  outfile: 'public/client.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  external: [],
  // The `io` function is loaded via CDN script tag, so we treat the import as external
  // and strip it since our globals.d.ts handles the typing
  define: {},
});

console.log('Client built: public/client.js');
