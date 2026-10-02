import assert from 'assert';

import { HostingController, validateStartRequest } from '../../src/desktop/hosting-controller.js';
import type { ConnectivityDetails, ConnectivityMode, ProviderOptions } from '../../src/desktop/connectivity/types.js';

function fixture(options: { savedToken?: string; secureStorage?: boolean } = {}) {
    const events: string[] = [];
    const credentials: (string | undefined)[] = [];
    const origins: (string | null)[] = [];
    const boundHosts: (string | undefined)[] = [];
    let occupied = false;
    let failedMode: ConnectivityMode | null = null;
    let stopFails = false;
    let serverCloses = 0;
    let saved: string | null = options.savedToken || null;
    const controller = new HostingController({
        port: 32145,
        savedToken: options.savedToken,
        vault: options.secureStorage === false ? null : {
            async save(token) { saved = token; },
            async clear() { saved = null; },
        },
        async startServer({ port, host }) {
            events.push(`listen:${port}`);
            boundHosts.push(host);
            if (occupied && port !== 0) throw Object.assign(new Error('Port in use'), { code: 'EADDRINUSE' });
            return { port: port || 45678, async close() { serverCloses++; events.push('close'); } };
        },
        setPublicOrigin(origin) { origins.push(origin); },
        manager: {
            async start(mode: ConnectivityMode, _context, providerOptions?: ProviderOptions): Promise<ConnectivityDetails> {
                events.push(`start:${mode}`);
                credentials.push(providerOptions?.authToken);
                if (mode === failedMode) throw new Error(`authtoken=${providerOptions?.authToken || 'none'} rejected`);
                return { mode, publicOrigin: `https://${mode}.example.test`, reachableOrigins: [], title: mode, description: mode };
            },
            async stop() {
                events.push('stop');
                if (stopFails) throw new Error('Tunnel cleanup failed');
            },
        },
    });
    return {
        controller, events, credentials, origins, boundHosts,
        setOccupied(value: boolean) { occupied = value; },
        setFailedMode(value: ConnectivityMode | null) { failedMode = value; },
        setStopFails(value: boolean) { stopFails = value; },
        get serverCloses() { return serverCloses; },
        get saved() { return saved; },
    };
}

async function main(): Promise<void> {
    assert.throws(() => validateStartRequest({ mode: 'unknown' }), /Unknown connectivity/);
    assert.throws(() => validateStartRequest({ mode: 'ngrok', authToken: 42 }), /Invalid ngrok token/);
    assert.throws(() => validateStartRequest({ mode: 'direct', localOnly: 'true' }), /Invalid local play/);
    assert.throws(() => validateStartRequest({ mode: 'ngrok', localOnly: true }), /Computer play/);
    const host = fixture();
    assert.equal(host.controller.getState().status, 'idle');
    assert.equal(host.events.length, 0, 'Opening the app must not start a listener');
    host.setOccupied(true);
    const started = await host.controller.start({ mode: 'direct' });
    assert.equal(started.status, 'ready');
    assert.equal(started.port, 45678);
    assert.deepEqual(host.events, ['listen:32145', 'listen:0', 'start:direct']);
    assert.deepEqual(host.boundHosts, ['0.0.0.0', '0.0.0.0']);
    assert.equal(started.localOnly, false);
    const networkState = host.controller.getState();
    await assert.rejects(host.controller.start({ mode: 'direct', localOnly: true }), /End the current session/);
    assert.deepEqual(host.controller.getState(), networkState, 'Rejecting a scope change must preserve the running host');
    assert.equal(host.serverCloses, 0);
    await host.controller.start({ mode: 'ngrok', authToken: 'session-secret', rememberAuthToken: false });
    assert.equal(host.events.filter(event => event.startsWith('listen:')).length, 2, 'Changing connectivity must reuse the match server');
    assert.equal(host.controller.getState().hasSessionNgrokToken, true);
    assert.equal(host.controller.getState().hasSavedNgrokToken, false);
    assert.equal(host.saved, null);
    const stopped = await host.controller.stop();
    assert.deepEqual(host.events.slice(-2), ['close', 'stop'], 'The tunnel must remain available until the game server has notified guests');
    assert.equal(host.serverCloses, 1);
    assert.equal(stopped.localOrigin, '');
    assert.equal(stopped.port, 0);
    assert.equal(stopped.status, 'idle');
    await host.controller.start({ mode: 'ngrok' });
    assert.equal(host.credentials.at(-1), 'session-secret', 'An unremembered token lasts through stop/start in this app session');
    host.setFailedMode('ngrok');
    const recovered = await host.controller.start({ mode: 'ngrok', authToken: 'bad-secret' });
    assert.equal(recovered.status, 'ready');
    assert.equal(recovered.connectivity?.mode, 'direct');
    assert.match(recovered.error || '', /Same Wi-Fi/);
    assert.doesNotMatch(recovered.error || '', /bad-secret/);
    assert.equal(host.serverCloses, 1, 'A failed reconfiguration must preserve the match server');
    await host.controller.forgetToken();
    assert.equal(host.controller.getState().hasSessionNgrokToken, false);
    assert.equal(host.controller.getState().hasSavedNgrokToken, false);
    host.setStopFails(true);
    assert.equal((await host.controller.stop()).status, 'error');
    assert.equal(host.serverCloses, 2, 'Tunnel cleanup errors must not prevent closing the listener');

    const initialFailure = fixture();
    initialFailure.setFailedMode('ngrok');
    const failed = await initialFailure.controller.start({ mode: 'ngrok', authToken: 'bad-secret' });
    assert.equal(failed.status, 'error');
    assert.equal(failed.port, 0);
    assert.equal(initialFailure.serverCloses, 1, 'A failed first start must close its listener');
    initialFailure.setFailedMode(null);
    const queued = await Promise.all([
        initialFailure.controller.start({ mode: 'direct' }),
        initialFailure.controller.stop(),
        initialFailure.controller.start({ mode: 'direct' }),
    ]);
    assert.deepEqual(queued.map(state => state.status), ['ready', 'idle', 'ready']);
    assert.equal(initialFailure.controller.getState().status, 'ready', 'Concurrent IPC requests must finish in request order');
    await initialFailure.controller.stop();

    const secure = fixture({ savedToken: 'old-saved-secret' });
    await secure.controller.start({ mode: 'ngrok' });
    assert.equal(secure.credentials[0], 'old-saved-secret');
    await secure.controller.start({ mode: 'ngrok', authToken: 'new-secret', rememberAuthToken: false });
    assert.equal(secure.saved, null, 'Choosing session-only must remove a previously remembered token');
    await secure.controller.start({ mode: 'ngrok', rememberAuthToken: true });
    assert.equal(secure.saved, 'new-secret');
    await secure.controller.forgetToken();
    assert.equal(secure.saved, null);
    await secure.controller.stop();

    const noVault = fixture({ secureStorage: false });
    await noVault.controller.start({ mode: 'ngrok', authToken: 'temporary', rememberAuthToken: true });
    await noVault.controller.stop();
    await noVault.controller.start({ mode: 'ngrok' });
    assert.equal(noVault.credentials.at(-1), 'temporary');
    assert.equal(noVault.controller.getState().canSaveNgrokToken, false);
    assert.equal(noVault.controller.getState().hasSavedNgrokToken, false);
    await noVault.controller.stop();

    const local = fixture();
    local.setOccupied(true);
    const computer = await local.controller.start({ mode: 'direct', localOnly: true, advertisedOrigin: 'https://ignored.example.test' });
    assert.equal(computer.status, 'ready');
    assert.equal(computer.localOnly, true);
    assert.equal(computer.localOrigin, 'http://127.0.0.1:45678');
    assert.equal(computer.connectivity?.publicOrigin, computer.localOrigin, 'Offline sessions cannot advertise a network address');
    assert.deepEqual(computer.connectivity?.reachableOrigins, [computer.localOrigin]);
    assert.deepEqual(local.boundHosts, ['127.0.0.1', '127.0.0.1'], 'Port fallback must also keep offline sessions on loopback');
    assert.deepEqual(local.events, ['listen:32145', 'listen:0'], 'Offline play bypasses connectivity providers');
    await local.controller.start({ mode: 'direct', localOnly: true });
    assert.equal(local.boundHosts.length, 2, 'Reopening computer play must retain its live session');
    await assert.rejects(local.controller.start({ mode: 'direct' }), /End the current session/);
    await assert.rejects(local.controller.start({ mode: 'ngrok', authToken: 'secret' }), /End the current session/);
    assert.equal(local.controller.getState().localOnly, true);
    assert.equal(local.controller.getState().status, 'ready');
    assert.equal(local.serverCloses, 0, 'Rejected reconfiguration cannot destroy the offline match');
    assert.equal(local.events.some(event => event.startsWith('start:')), false, 'Reconfiguration cannot expose the offline server');
    const localStopped = await local.controller.stop();
    assert.equal(localStopped.localOnly, false);
    assert.equal(localStopped.status, 'idle');
    assert.equal(local.serverCloses, 1);
    const afterComputer = await local.controller.start({ mode: 'direct' });
    assert.equal(afterComputer.localOnly, false);
    assert.equal(afterComputer.status, 'ready');
    assert.equal(local.boundHosts.at(-1), '0.0.0.0', 'Hosting friends is available after ending an offline session');
    await local.controller.stop();
    console.log('Desktop hosting tests passed: serialized lifecycle, offline scope, port fallback, recovery, token storage.');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
