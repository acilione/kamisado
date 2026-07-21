import type {
    ConnectivityDetails,
    ConnectivityMode,
    ConnectivityProvider,
    ProviderContext,
    ProviderFactory,
    ProviderOptions,
} from './types.js';

export class ConnectivityProviderManager {
    private activeProvider: ConnectivityProvider | null = null;
    private transitionInProgress = false;

    constructor(private readonly providers: Record<ConnectivityMode, ProviderFactory>) {}

    async start(
        mode: ConnectivityMode,
        context: ProviderContext,
        options: ProviderOptions = {},
    ): Promise<ConnectivityDetails> {
        if (this.transitionInProgress) throw new Error('A connectivity change is already in progress.');
        this.transitionInProgress = true;

        try {
            await this.stopActiveProvider();
            const provider = this.providers[mode]();
            try {
                const details = await provider.start(context, options);
                this.activeProvider = provider;
                return details;
            } catch (error) {
                await provider.stop().catch(() => undefined);
                throw error;
            }
        } finally {
            this.transitionInProgress = false;
        }
    }

    async stop(): Promise<void> {
        if (this.transitionInProgress) throw new Error('A connectivity change is already in progress.');
        this.transitionInProgress = true;
        try {
            await this.stopActiveProvider();
        } finally {
            this.transitionInProgress = false;
        }
    }

    private async stopActiveProvider(): Promise<void> {
        const provider = this.activeProvider;
        this.activeProvider = null;
        if (provider) await provider.stop();
    }
}
