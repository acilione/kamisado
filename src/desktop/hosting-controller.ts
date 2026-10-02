import type { RunningServer, ServerStartOptions } from '../server/index.js';
import type { ConnectivityProviderManager } from './connectivity/provider-manager.js';
import type { DesktopState, StartHostingRequest } from './contracts.js';
import type { TokenVault } from './token-vault.js';

interface HostingDependencies {
    manager: Pick<ConnectivityProviderManager, 'start' | 'stop'>;
    startServer(options: ServerStartOptions): Promise<RunningServer>;
    setPublicOrigin(origin: string | null): void;
    port: number;
    vault?: Pick<TokenVault, 'save' | 'clear'> | null;
    savedToken?: string | null;
}

export function validateStartRequest(value: unknown): StartHostingRequest {
    if (!value || typeof value !== 'object') throw new Error('Invalid hosting request.');
    const request = value as Partial<StartHostingRequest>;
    if (request.mode !== 'direct' && request.mode !== 'ngrok') throw new Error('Unknown connectivity mode.');
    if (request.authToken !== undefined && (typeof request.authToken !== 'string' || request.authToken.length > 2048)) {
        throw new Error('Invalid ngrok token.');
    }
    if (request.rememberAuthToken !== undefined && typeof request.rememberAuthToken !== 'boolean') {
        throw new Error('Invalid token storage preference.');
    }
    if (request.advertisedOrigin !== undefined &&
        (typeof request.advertisedOrigin !== 'string' || request.advertisedOrigin.length > 2048)) {
        throw new Error('Invalid public address.');
    }
    return request as StartHostingRequest;
}

/** Owns the listener, tunnel and credentials for one desktop host. */
export class HostingController {
    private server: RunningServer | null = null;
    private savedToken: string | null;
    private sessionToken: string | null = null;
    private transition: Promise<unknown> = Promise.resolve();
    private state: DesktopState = {
        status: 'idle', localOrigin: '', port: 0, connectivity: null,
        hasSavedNgrokToken: false, hasSessionNgrokToken: false, canSaveNgrokToken: false,
    };

    constructor(private readonly dependencies: HostingDependencies) {
        this.savedToken = dependencies.savedToken || null;
    }

    getState(): DesktopState {
        return {
            ...this.state,
            hasSavedNgrokToken: this.savedToken !== null,
            hasSessionNgrokToken: this.sessionToken !== null,
            canSaveNgrokToken: !!this.dependencies.vault,
        };
    }

    start(request: StartHostingRequest): Promise<DesktopState> {
        return this.enqueue(() => this.startHosting(request));
    }

    stop(): Promise<DesktopState> {
        return this.enqueue(async () => {
            const failures = await this.releaseHosting();
            this.state = { ...this.state, status: failures.length ? 'error' : 'idle', error: failures[0] };
            return this.getState();
        });
    }

    forgetToken(): Promise<DesktopState> {
        return this.enqueue(async () => {
            // Retain the saved flag if deleting secure storage fails, so the UI can retry.
            await this.dependencies.vault?.clear();
            this.savedToken = null;
            this.sessionToken = null;
            return this.getState();
        });
    }

    private enqueue<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.transition.then(operation);
        this.transition = result.catch(() => undefined);
        return result;
    }

    private publicError(error: unknown, requestToken?: string): string {
        let message = error instanceof Error ? error.message : 'Unable to configure hosting.';
        for (const token of [requestToken, this.sessionToken, this.savedToken]) {
            if (token) message = message.split(token).join('[hidden]');
        }
        return message.replace(/authtoken\s*[=:]\s*\S+/gi, 'authtoken: [hidden]');
    }

    private async startHosting(request: StartHostingRequest): Promise<DesktopState> {
        const wasRunning = this.server !== null;
        this.state = { ...this.state, status: 'starting', error: undefined };
        try {
            if (!this.server) {
                try {
                    this.server = await this.dependencies.startServer({ port: this.dependencies.port, host: '0.0.0.0' });
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
                    this.server = await this.dependencies.startServer({ port: 0, host: '0.0.0.0' });
                }
                this.state = { ...this.state, port: this.server.port, localOrigin: `http://127.0.0.1:${this.server.port}` };
            }
            const authToken = request.authToken?.trim() || this.sessionToken || this.savedToken || undefined;
            const connectivity = await this.dependencies.manager.start(request.mode, {
                port: this.state.port, localOrigin: this.state.localOrigin,
            }, { authToken, advertisedOrigin: request.advertisedOrigin });
            let storageWarning: string | undefined;
            if (request.mode === 'ngrok' && authToken) {
                this.sessionToken = authToken;
                if (this.dependencies.vault && request.rememberAuthToken !== undefined) {
                    try {
                        if (request.rememberAuthToken) {
                            await this.dependencies.vault.save(authToken);
                            this.savedToken = authToken;
                        } else {
                            await this.dependencies.vault.clear();
                            this.savedToken = null;
                        }
                    } catch (error) {
                        storageWarning = `Hosting is ready, but secure token settings could not be updated: ${this.publicError(error, authToken)}`;
                    }
                }
            }
            this.dependencies.setPublicOrigin(connectivity.publicOrigin);
            this.state = { ...this.state, status: 'ready', connectivity, error: storageWarning };
        } catch (error) {
            const message = this.publicError(error, request.authToken?.trim());
            if (wasRunning && this.server) {
                // A tunnel failure must not destroy a match already running locally.
                try {
                    const connectivity = await this.dependencies.manager.start('direct', {
                        port: this.state.port, localOrigin: this.state.localOrigin,
                    });
                    this.dependencies.setPublicOrigin(connectivity.publicOrigin);
                    this.state = {
                        ...this.state, status: 'ready', connectivity,
                        error: `${message} Same Wi-Fi hosting is still available.`,
                    };
                    return this.getState();
                } catch {
                    // If even LAN recovery fails, release the listener and report an error.
                }
            }
            await this.releaseHosting();
            this.state = { ...this.state, status: 'error', error: message };
        }
        return this.getState();
    }

    private async releaseHosting(): Promise<string[]> {
        this.dependencies.setPublicOrigin(null);
        const server = this.server;
        this.server = null;
        const failures: string[] = [];
        // Keep the tunnel alive until guests receive the server's shutdown notice.
        // Always attempt both cleanups, even if the first one fails.
        for (const close of [() => server?.close(), () => this.dependencies.manager.stop()]) {
            try { await close(); }
            catch (error) { failures.push(this.publicError(error)); }
        }
        this.state = { ...this.state, localOrigin: '', port: 0, connectivity: null };
        return failures;
    }
}
