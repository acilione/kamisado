import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, shell, type IpcMainInvokeEvent } from 'electron';
import squirrelStartup from 'electron-squirrel-startup';
import path from 'path';
import { pathToFileURL } from 'url';

import { setPublicOrigin, startServer } from '../server/index.js';
import { DirectConnectivityProvider } from './connectivity/direct-provider.js';
import { NgrokConnectivityProvider } from './connectivity/ngrok-provider.js';
import { ConnectivityProviderManager } from './connectivity/provider-manager.js';
import { HostingController, validateStartRequest } from './hosting-controller.js';
import { TokenVault } from './token-vault.js';

const DEFAULT_DESKTOP_PORT = 32145;
let controlWindow: BrowserWindow | null = null;
let hosting: HostingController | null = null;
let shutdownComplete = false;
let shutdownStarted = false;

if (process.env.KAMISADO_USER_DATA_DIR) {
    app.setPath('userData', path.resolve(process.env.KAMISADO_USER_DATA_DIR));
}
if (process.platform === 'win32') app.setAppUserModelId('com.squirrel.Kamisado.Kamisado');

function desktopAsset(...segments: string[]): string {
    return path.resolve(__dirname, '../../desktop', ...segments);
}

function requestedPort(): number {
    const value = Number(process.env.KAMISADO_DESKTOP_PORT);
    return Number.isInteger(value) && value > 0 && value <= 65535 ? value : DEFAULT_DESKTOP_PORT;
}

async function createControlWindow(): Promise<void> {
    const window = new BrowserWindow({
        width: 1180,
        height: 900,
        minWidth: 760,
        minHeight: 640,
        title: 'Kamisado',
        backgroundColor: '#11151c',
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    controlWindow = window;
    window.removeMenu();
    window.once('ready-to-show', () => window.show());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-attach-webview', event => event.preventDefault());
    window.webContents.on('will-frame-navigate', event => {
        if (event.isMainFrame) {
            event.preventDefault();
            return;
        }
        // Only the embedded local game may navigate; it never receives the preload API.
        try {
            if (event.url !== 'about:blank' && new URL(event.url).origin !== hosting?.getState().localOrigin) {
                event.preventDefault();
            }
        } catch {
            event.preventDefault();
        }
    });
    window.on('closed', () => {
        controlWindow = null;
        app.quit();
    });
    await window.loadFile(desktopAsset('index.html'));
}

function canUseSecureTokenStorage(): boolean {
    if (!safeStorage.isEncryptionAvailable()) return false;
    return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text';
}

function requireTrustedShell(event: IpcMainInvokeEvent): HostingController {
    if (!hosting || !controlWindow || event.sender !== controlWindow.webContents ||
        event.senderFrame !== controlWindow.webContents.mainFrame ||
        event.senderFrame.url !== pathToFileURL(desktopAsset('index.html')).href) {
        throw new Error('This action is only available in the Kamisado desktop window.');
    }
    return hosting;
}

function registerIpcHandlers(): void {
    ipcMain.handle('hosting:get-state', event => requireTrustedShell(event).getState());
    ipcMain.handle('hosting:start', (event, request: unknown) => requireTrustedShell(event).start(validateStartRequest(request)));
    ipcMain.handle('hosting:stop', event => requireTrustedShell(event).stop());
    ipcMain.handle('settings:forget-ngrok-token', event => requireTrustedShell(event).forgetToken());
    ipcMain.handle('clipboard:write', (event, value: unknown) => {
        requireTrustedShell(event);
        if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid clipboard value.');
        clipboard.writeText(value);
    });
    ipcMain.handle('external:open', async (event, value: unknown) => {
        requireTrustedShell(event);
        if (typeof value !== 'string') throw new Error('Invalid URL.');
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Only HTTPS links can be opened.');
        await shell.openExternal(url.href);
    });
}

if (squirrelStartup || !app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (controlWindow?.isMinimized()) controlWindow.restore();
        controlWindow?.show();
        controlWindow?.focus();
    });

    app.whenReady().then(async () => {
        let vault: TokenVault | null = null;
        let savedToken: string | null = null;
        if (canUseSecureTokenStorage()) {
            vault = new TokenVault(path.join(app.getPath('userData'), 'secure-settings.json'), {
                encrypt: value => safeStorage.encryptString(value),
                decrypt: value => safeStorage.decryptString(value),
            });
            savedToken = await vault.load();
        }
        hosting = new HostingController({
            manager: new ConnectivityProviderManager({
                direct: () => new DirectConnectivityProvider(),
                ngrok: () => new NgrokConnectivityProvider(),
            }),
            startServer, setPublicOrigin, port: requestedPort(), vault, savedToken,
        });
        registerIpcHandlers();
        await createControlWindow();
    }).catch(error => {
        console.error('Unable to start Kamisado Desktop:', error);
        dialog.showErrorBox('Kamisado could not start', error instanceof Error ? error.message : 'Please try opening the app again.');
        app.quit();
    });

    app.on('before-quit', event => {
        if (shutdownComplete || !hosting) return;
        event.preventDefault();
        if (shutdownStarted) return;
        shutdownStarted = true;
        void hosting.stop().finally(() => {
            shutdownComplete = true;
            app.quit();
        });
    });
}
