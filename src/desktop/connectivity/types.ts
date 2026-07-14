export type ConnectivityMode = 'direct' | 'ngrok';

export interface ProviderContext {
    port: number;
    localOrigin: string;
}

export interface ProviderOptions {
    authToken?: string;
    advertisedOrigin?: string;
}

export interface ConnectivityDetails {
    mode: ConnectivityMode;
    publicOrigin: string;
    reachableOrigins: string[];
    title: string;
    description: string;
    warning?: string;
}

export interface ConnectivityProvider {
    readonly mode: ConnectivityMode;
    start(context: ProviderContext, options: ProviderOptions): Promise<ConnectivityDetails>;
    stop(): Promise<void>;
}

export type ProviderFactory = () => ConnectivityProvider;
