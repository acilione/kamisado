import assert from 'assert';

import { DirectConnectivityProvider, normalizeAdvertisedOrigin } from '../../src/desktop/connectivity/direct-provider.js';
import { ConnectivityProviderManager } from '../../src/desktop/connectivity/provider-manager.js';
import type {
    ConnectivityDetails,
    ConnectivityProvider,
    ProviderContext,
} from '../../src/desktop/connectivity/types.js';

const context: ProviderContext = { port: 32145, localOrigin: 'http://127.0.0.1:32145' };

async function testDirectProvider(): Promise<void> {
    assert.equal(normalizeAdvertisedOrigin('example.test:4567'), 'http://example.test:4567');
    assert.equal(normalizeAdvertisedOrigin('https://example.test'), 'https://example.test');
    assert.throws(() => normalizeAdvertisedOrigin('ftp://example.test'), /HTTP\(S\)/);
    assert.throws(() => normalizeAdvertisedOrigin('https://example.test/path'), /host and optional port/);

    const details = await new DirectConnectivityProvider().start(context, {
        advertisedOrigin: 'https://play.example.test',
    });
    assert.equal(details.mode, 'direct');
    assert.equal(details.publicOrigin, 'https://play.example.test');
    assert.equal(details.reachableOrigins[0], 'https://play.example.test');
}

class FakeProvider implements ConnectivityProvider {
    stopped = false;

    constructor(
        readonly mode: 'direct' | 'ngrok',
        private readonly shouldFail = false,
    ) {}

    async start(): Promise<ConnectivityDetails> {
        if (this.shouldFail) throw new Error('expected failure');
        return {
            mode: this.mode,
            publicOrigin: `https://${this.mode}.example.test`,
            reachableOrigins: [`https://${this.mode}.example.test`],
            title: 'ready',
            description: 'test',
        };
    }

    async stop(): Promise<void> {
        this.stopped = true;
    }
}

async function testProviderLifecycle(): Promise<void> {
    const created: FakeProvider[] = [];
    let failNgrok = false;
    const manager = new ConnectivityProviderManager({
        direct: () => {
            const provider = new FakeProvider('direct');
            created.push(provider);
            return provider;
        },
        ngrok: () => {
            const provider = new FakeProvider('ngrok', failNgrok);
            created.push(provider);
            return provider;
        },
    });

    await manager.start('direct', context);
    await manager.start('ngrok', context);
    assert.equal(created[0].stopped, true, 'switching provider must stop the previous one');

    failNgrok = true;
    await assert.rejects(() => manager.start('ngrok', context), /expected failure/);
    assert.equal(created[1].stopped, true, 'replacing provider must close its tunnel');
    assert.equal(created[2].stopped, true, 'failed providers must clean up partial resources');

    await manager.stop();
}

async function main(): Promise<void> {
    await testDirectProvider();
    await testProviderLifecycle();
    console.log('Connectivity provider tests passed.');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
