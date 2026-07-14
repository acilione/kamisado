import { contextBridge, ipcRenderer } from 'electron';

import type { KamisadoDesktopApi, StartHostingRequest } from './contracts.js';

const api: KamisadoDesktopApi = {
    getState: () => ipcRenderer.invoke('hosting:get-state'),
    startHosting: (request: StartHostingRequest) => ipcRenderer.invoke('hosting:start', request),
    stopHosting: () => ipcRenderer.invoke('hosting:stop'),
    openGame: () => ipcRenderer.invoke('game:open'),
    copyText: (value: string) => ipcRenderer.invoke('clipboard:write', value),
    openExternal: (url: string) => ipcRenderer.invoke('external:open', url),
};

contextBridge.exposeInMainWorld('kamisadoDesktop', api);
