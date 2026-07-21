import type {
    ConnectivityDetails,
    ConnectivityProvider,
    ProviderContext,
    ProviderOptions,
} from './types.js';

interface NgrokListener {
    url(): string | null;
    close(): Promise<void>;
}

export class NgrokConnectivityProvider implements ConnectivityProvider {
    readonly mode = 'ngrok' as const;
    private listener: NgrokListener | null = null;

    async start(context: ProviderContext, options: ProviderOptions): Promise<ConnectivityDetails> {
        const authToken = options.authToken?.trim() || process.env.NGROK_AUTHTOKEN?.trim();
        if (!authToken) throw new Error('Enter an ngrok authtoken to create an internet room.');

        const ngrok = await import('@ngrok/ngrok');
        this.listener = await ngrok.forward({
            addr: context.port,
            authtoken: authToken,
        }) as NgrokListener;

        const publicOrigin = this.listener.url();
        if (!publicOrigin) {
            await this.stop();
            throw new Error('ngrok started without returning a public URL.');
        }

        return {
            mode: this.mode,
            publicOrigin,
            reachableOrigins: [publicOrigin],
            title: 'Internet room ready',
            description: 'Share the HTTPS invitation link. The other player only needs a browser.',
        };
    }

    async stop(): Promise<void> {
        const listener = this.listener;
        this.listener = null;
        if (listener) await listener.close();
    }
}
