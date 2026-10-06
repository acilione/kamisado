import { app, BrowserWindow, clipboard, dialog, ipcMain, net, safeStorage, shell, type IpcMainInvokeEvent } from 'electron';
import squirrelStartup from 'electron-squirrel-startup';
import path from 'path';
import { pathToFileURL } from 'url';

import { setPublicOrigin, startServer } from '../server/index.js';
import { DirectConnectivityProvider } from './connectivity/direct-provider.js';
import { NgrokConnectivityProvider } from './connectivity/ngrok-provider.js';
import { CloudflareConnectivityProvider } from './connectivity/cloudflare-provider.js';
import { ConnectivityProviderManager } from './connectivity/provider-manager.js';
import { HostingController, validateStartRequest } from './hosting-controller.js';
import { TokenVault } from './token-vault.js';
import { normalizeGameInvitation } from '../shared/invitation-url.js';
import { normalizePeerInvitation } from '../shared/peer-invitation.js';
import { createMeteredCredential } from '../shared/turn-provider.js';

const DEFAULT_DESKTOP_PORT = 32145;
let controlWindow: BrowserWindow | null = null;
let hosting: HostingController | null = null;
let shutdownComplete = false;
let shutdownStarted = false;
let pendingInvitation: string | null = null;
let invitationListenerReady = false;

function receiveInvitation(value: unknown): void {
    if (typeof value !== 'string' || !value.startsWith('kamisado://')) return;
    try {
        const code = normalizePeerInvitation(value);
        if (invitationListenerReady && controlWindow) controlWindow.webContents.send('game:invitation', code);
        else pendingInvitation = code;
    } catch { /* Unknown schemes and malformed external input never navigate the renderer. */ }
}
for (const argument of process.argv) receiveInvitation(argument);
app.on('open-url', (event, url) => { event.preventDefault(); receiveInvitation(url); });

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
    ipcMain.handle('turn:create-credential', async (event, request: unknown) => {
        const controller = requireTrustedShell(event);
        if (controller.getState().peerMode !== 'host') throw new Error('Only the host can create relay credentials.');
        try {
            const relay = await createMeteredCredential(request, async input => {
                const response = await fetch(input.url, { method: input.method, redirect: 'error',
                    signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' },
                    ...(input.data ? { body: JSON.stringify(input.data) } : {}) });
                return { status: response.status, data: await response.text() };
            });
            return { success: true, relay };
        } catch (error) {
            // Expected provider failures are data, avoiding Electron's remote-method error wrapper.
            return { success: false, message: error instanceof Error ? error.message : 'Could not create TURN credentials.' };
        }
    });
    ipcMain.handle('game:take-invitation', event => {
        requireTrustedShell(event);
        invitationListenerReady = true;
        const value = pendingInvitation;
        pendingInvitation = null;
        return value;
    });
    ipcMain.handle('hosting:get-state', event => requireTrustedShell(event).getState());
    ipcMain.handle('hosting:start', (event, request: unknown) => requireTrustedShell(event).start(validateStartRequest(request)));
    ipcMain.handle('hosting:stop', event => requireTrustedShell(event).stop());
    ipcMain.handle('settings:forget-ngrok-token', event => requireTrustedShell(event).forgetToken());
    ipcMain.handle('clipboard:write', (event, value: unknown) => {
        requireTrustedShell(event);
        if (typeof value !== 'string' || value.length > 16384) throw new Error('Invalid clipboard value.');
        clipboard.writeText(value);
    });
    ipcMain.handle('external:open', async (event, value: unknown) => {
        requireTrustedShell(event);
        if (typeof value !== 'string') throw new Error('Invalid URL.');
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Only HTTPS links can be opened.');
        await shell.openExternal(url.href);
    });
    ipcMain.handle('game:join-invitation', async (event, value: unknown) => {
        requireTrustedShell(event);
        await shell.openExternal(normalizeGameInvitation(value));
    });
}

// Windows cannot launch Chromium's sandboxed subprocesses from the WSL/UNC share.
// Explain the remedy before creating a window, rather than crashing invisibly.
const windowsNetworkPath = process.platform === 'win32' &&
    process.execPath.startsWith('\\\\') && !/^\\\\\?\\[a-z]:\\/i.test(process.execPath);
if (windowsNetworkPath) {
    dialog.showErrorBox('Move Kamisado to a Windows folder',
        'Kamisado cannot start from a WSL or network folder.\n\n' +
        'Copy the entire Kamisado folder to your Windows Downloads or Desktop folder, then open Kamisado.exe there. ' +
        'If you have the portable ZIP, extract it there first. Keep all of its files together.\n\nNo installation is required.');
    app.quit();
} else if (squirrelStartup || !app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', (_event, argv) => {
        for (const argument of argv) receiveInvitation(argument);
        if (controlWindow?.isMinimized()) controlWindow.restore();
        controlWindow?.show();
        controlWindow?.focus();
    });

    app.whenReady().then(async () => {
        if (process.defaultApp && process.argv[1]) {
            app.setAsDefaultProtocolClient('kamisado', process.execPath, [path.resolve(process.argv[1])]);
        } else app.setAsDefaultProtocolClient('kamisado');
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
                cloudflare: () => new CloudflareConnectivityProvider(path.join(app.getPath('userData'), 'cloudflared'), () => {
                    void hosting?.stop().then(() => controlWindow?.webContents.send('hosting:tunnel-stopped'));
                }, (url, options) => net.fetch(url, options)),
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
