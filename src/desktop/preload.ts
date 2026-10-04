import { contextBridge, ipcRenderer } from 'electron';

import type { KamisadoDesktopApi, StartHostingRequest } from './contracts.js';

const api: KamisadoDesktopApi = {
    getState: () => ipcRenderer.invoke('hosting:get-state'),
    startHosting: (request: StartHostingRequest) => ipcRenderer.invoke('hosting:start', request),
    stopHosting: () => ipcRenderer.invoke('hosting:stop'),
    forgetNgrokToken: () => ipcRenderer.invoke('settings:forget-ngrok-token'),
    copyText: (value: string) => ipcRenderer.invoke('clipboard:write', value),
    joinGame: (url: string) => ipcRenderer.invoke('game:join-invitation', url),
    openExternal: (url: string) => ipcRenderer.invoke('external:open', url),
    takeInvitation: () => ipcRenderer.invoke('game:take-invitation'),
    onInvitation: callback => {
        const listener = (_event: Electron.IpcRendererEvent, invitation: string) => callback(invitation);
        ipcRenderer.on('game:invitation', listener);
        return () => ipcRenderer.removeListener('game:invitation', listener);
    },
};

if (process.isMainFrame) contextBridge.exposeInMainWorld('kamisadoDesktop', api);
