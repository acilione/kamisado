import type { ConnectivityDetails, ConnectivityMode } from './connectivity/types.js';

export interface DesktopState {
    status: 'idle' | 'starting' | 'ready' | 'error';
    localOrigin: string;
    port: number;
    localOnly: boolean;
    peerMode?: 'host' | 'guest';
    connectivity: ConnectivityDetails | null;
    hasSavedNgrokToken: boolean;
    hasSessionNgrokToken: boolean;
    canSaveNgrokToken: boolean;
    error?: string;
}

export interface StartHostingRequest {
    mode: ConnectivityMode;
    localOnly?: boolean;
    peerMode?: 'host' | 'guest';
    authToken?: string;
    rememberAuthToken?: boolean;
    advertisedOrigin?: string;
}

export interface KamisadoDesktopApi {
    getState(): Promise<DesktopState>;
    startHosting(request: StartHostingRequest): Promise<DesktopState>;
    stopHosting(): Promise<DesktopState>;
    forgetNgrokToken(): Promise<DesktopState>;
    copyText(value: string): Promise<void>;
    joinGame(url: string): Promise<void>;
    openExternal(url: string): Promise<void>;
}
