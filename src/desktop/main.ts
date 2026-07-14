import { app, BrowserWindow, clipboard, ipcMain, shell } from 'electron';
import path from 'path';

import { setPublicOrigin, startServer, type RunningServer } from '../server/index.js';
import { DirectConnectivityProvider } from './connectivity/direct-provider.js';
import { NgrokConnectivityProvider } from './connectivity/ngrok-provider.js';
import { ConnectivityProviderManager } from './connectivity/provider-manager.js';
import type { ConnectivityMode } from './connectivity/types.js';
import type { DesktopState, StartHostingRequest } from './contracts.js';

const DEFAULT_DESKTOP_PORT = 32145;
const manager = new ConnectivityProviderManager({
    direct: () => new DirectConnectivityProvider(),
    ngrok: () => new NgrokConnectivityProvider(),
});

let controlWindow: BrowserWindow | null = null;
let gameWindow: BrowserWindow | null = null;
let runningServer: RunningServer | null = null;
let state: DesktopState = {
    status: 'idle',
    localOrigin: '',
    port: 0,
    connectivity: null,
};

function desktopAsset(...segments: string[]): string {
    return path.resolve(__dirname, '../../desktop', ...segments);
}

function requestedPort(): number {
    const value = Number.parseInt(process.env.KAMISADO_DESKTOP_PORT || '', 10);
    return Number.isInteger(value) && value > 0 && value <= 65535 ? value : DEFAULT_DESKTOP_PORT;
}

async function startLocalServer(): Promise<RunningServer> {
    try {
        return await startServer({ port: requestedPort(), host: '0.0.0.0' });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
        return startServer({ port: 0, host: '0.0.0.0' });
    }
}

function createControlWindow(): void {
    controlWindow = new BrowserWindow({
        width: 600,
        height: 760,
        minWidth: 520,
        minHeight: 680,
        title: 'Kamisado Host',
        backgroundColor: '#11151c',
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });

    controlWindow.removeMenu();
    void controlWindow.loadFile(desktopAsset('index.html'));
    controlWindow.once('ready-to-show', () => controlWindow?.show());
    controlWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    controlWindow.on('closed', () => {
        controlWindow = null;
        if (!gameWindow) app.quit();
    });
}

async function openGameWindow(): Promise<void> {
    if (!state.localOrigin) throw new Error('The local game server is not ready.');

    if (gameWindow && !gameWindow.isDestroyed()) {
        gameWindow.show();
        gameWindow.focus();
        return;
    }

    gameWindow = new BrowserWindow({
        width: 1180,
        height: 900,
        minWidth: 760,
        minHeight: 640,
        title: 'Kamisado',
        backgroundColor: '#15171c',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });

    gameWindow.removeMenu();
    gameWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://')) void shell.openExternal(url);
        return { action: 'deny' };
    });
    gameWindow.webContents.on('will-navigate', (event, url) => {
        if (!url.startsWith(state.localOrigin)) event.preventDefault();
    });
    gameWindow.on('closed', () => {
        gameWindow = null;
        if (!controlWindow) app.quit();
    });

    await gameWindow.loadURL(state.localOrigin);
}

function validateStartRequest(value: unknown): StartHostingRequest {
    if (!value || typeof value !== 'object') throw new Error('Invalid hosting request.');
    const request = value as Partial<StartHostingRequest>;
    if (request.mode !== 'direct' && request.mode !== 'ngrok') throw new Error('Unknown connectivity mode.');
    if (request.authToken !== undefined && (typeof request.authToken !== 'string' || request.authToken.length > 2048)) {
        throw new Error('Invalid ngrok token.');
    }
    if (request.advertisedOrigin !== undefined &&
        (typeof request.advertisedOrigin !== 'string' || request.advertisedOrigin.length > 2048)) {
        throw new Error('Invalid public address.');
    }
    return request as StartHostingRequest;
}

function publicError(error: unknown): string {
    if (error instanceof Error) return error.message.replace(/authtoken\s*[=:]\s*\S+/gi, 'authtoken: [hidden]');
    return 'Unable to configure connectivity.';
}

function registerIpcHandlers(): void {
    ipcMain.handle('hosting:get-state', () => state);
    ipcMain.handle('hosting:start', async (_event, rawRequest: unknown) => {
        try {
            const request = validateStartRequest(rawRequest);
            state = { ...state, status: 'starting', connectivity: null, error: undefined };
            const connectivity = await manager.start(request.mode as ConnectivityMode, {
                port: state.port,
                localOrigin: state.localOrigin,
            }, {
                authToken: request.authToken,
                advertisedOrigin: request.advertisedOrigin,
            });
            setPublicOrigin(connectivity.publicOrigin);
            state = { ...state, status: 'ready', connectivity, error: undefined };
            await openGameWindow();
        } catch (error) {
            setPublicOrigin(null);
            state = { ...state, status: 'error', connectivity: null, error: publicError(error) };
        }
        return state;
    });
    ipcMain.handle('hosting:stop', async () => {
        try {
            await manager.stop();
            setPublicOrigin(null);
            state = { ...state, status: 'idle', connectivity: null, error: undefined };
        } catch (error) {
            state = { ...state, status: 'error', connectivity: null, error: publicError(error) };
        }
        return state;
    });
    ipcMain.handle('game:open', () => openGameWindow());
    ipcMain.handle('clipboard:write', (_event, value: unknown) => {
        if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid clipboard value.');
        clipboard.writeText(value);
    });
    ipcMain.handle('external:open', async (_event, value: unknown) => {
        if (typeof value !== 'string') throw new Error('Invalid URL.');
        const url = new URL(value);
        if (url.protocol !== 'https:') throw new Error('Only HTTPS links can be opened.');
        await shell.openExternal(url.href);
    });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        const window = controlWindow || gameWindow;
        if (window?.isMinimized()) window.restore();
        window?.show();
        window?.focus();
    });

    app.whenReady().then(async () => {
        registerIpcHandlers();
        runningServer = await startLocalServer();
        state = {
            status: 'idle',
            localOrigin: `http://127.0.0.1:${runningServer.port}`,
            port: runningServer.port,
            connectivity: null,
        };
        createControlWindow();

        app.on('activate', () => {
            if (!controlWindow && !gameWindow) createControlWindow();
        });
    }).catch(error => {
        console.error('Unable to start Kamisado Desktop:', error);
        app.quit();
    });

    app.on('before-quit', () => {
        void manager.stop().catch(() => undefined);
        void runningServer?.close().catch(() => undefined);
    });
}
