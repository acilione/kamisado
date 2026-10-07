import { contextBridge, ipcRenderer } from 'electron';

import type { KamisadoDesktopApi, StartHostingRequest } from './contracts.js';

const api: KamisadoDesktopApi = {
    onTunnelStatus: callback => {
        const listener = (_event: Electron.IpcRendererEvent, value: boolean) => callback(value === true);
        ipcRenderer.on('hosting:tunnel-status', listener);
        return () => ipcRenderer.removeListener('hosting:tunnel-status', listener);
    },
    onHostingStopped: callback => {
        const listener = () => callback();
        ipcRenderer.on('hosting:tunnel-stopped', listener);
        return () => ipcRenderer.removeListener('hosting:tunnel-stopped', listener);
    },
    createTurnCredential: async request => {
        const result = await ipcRenderer.invoke('turn:create-credential', request);
        if (!result.success) throw new Error(result.message);
        return result.relay;
    },
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
