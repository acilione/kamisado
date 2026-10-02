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
      platforms: ['darwin', 'win32'],
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
