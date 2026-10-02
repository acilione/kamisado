const fs = require('node:fs/promises');
const path = require('node:path');

module.exports = {
  packagerConfig: {
    asar: {
      unpack: '**/*.node',
    },
    executableName: 'Kamisado',
    ignore: [
      /^\/\.git($|\/)/,
      /^\/\.github($|\/)/,
      /^\/src($|\/)/,
      /^\/tests($|\/)/,
      /^\/ref_imgs($|\/)/,
      /^\/scripts($|\/)/,
      /^\/out($|\/)/,
    ],
  },
  hooks: {
    postPackage: async (_config, { outputPaths }) => {
      // Keep the offline guide beside the executable so ZIP users see it before launching.
      // The source copy also remains inside app.asar for installed applications.
      await Promise.all(outputPaths.map(directory => fs.copyFile(
        path.join(__dirname, 'desktop', 'START-HERE.txt'),
        path.join(directory, 'START-HERE.txt'),
      )));
    },
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: {
        name: 'Kamisado',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'win32', 'linux'],
      config: {},
    },
    {
      name: '@electron-forge/maker-deb',
      platforms: ['linux'],
      config: { options: { bin: 'Kamisado', categories: ['Game', 'BoardGame'] } },
    },
    {
      name: '@electron-forge/maker-rpm',
      platforms: ['linux'],
      config: { options: { bin: 'Kamisado', categories: ['Game', 'BoardGame'] } },
    },
  ],
};
