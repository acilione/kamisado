import assert from 'assert';
import type { NetworkInterfaceInfo } from 'os';

import { DirectConnectivityProvider, listDirectOrigins, normalizeAdvertisedOrigin } from '../../src/desktop/connectivity/direct-provider.js';
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

    const details = await new DirectConnectivityProvider(() => ({})).start(context, {
        advertisedOrigin: 'https://play.example.test',
    });
    assert.equal(details.mode, 'direct');
    assert.equal(details.publicOrigin, 'https://play.example.test');
    assert.equal(details.reachableOrigins[0], 'https://play.example.test');
    assert.equal(details.warning, undefined, 'an explicit public address is usable even without automatic LAN discovery');
}

function ipv4(address: string, internal = false): NetworkInterfaceInfo {
    return { address, internal, family: 'IPv4', netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: `${address}/24` };
}

async function testNetworkSelection(): Promise<void> {
    const origins = listDirectOrigins(context.port, {
        'vEthernet (WSL)': [ipv4('172.23.240.1')],
        docker0: [ipv4('172.17.0.1')],
        Tailscale: [ipv4('100.64.8.3')],
        'Wi-Fi': [ipv4('192.168.1.20')],
        'Ethernet 2': [ipv4('169.254.35.109')],
        lo: [ipv4('127.0.0.1', true)],
    });
    assert.equal(origins[0], 'http://192.168.1.20:32145', 'the physical network must outrank VPNs and VM adapters');
    assert.equal(origins[1], 'http://100.64.8.3:32145', 'keep VPN addresses available for a shared VPN');
    assert.equal(origins.length, 4, 'keep alternative addresses, but never advertise loopback or unconfigured link-local adapters');

    for (const name of ['wlan0', 'wlp2s0', 'wlx11223344', 'enp3s0', 'ens33', 'eno1', 'eth0', 'en0', 'Ethernet']) {
        assert.equal(listDirectOrigins(context.port, {
            other: [ipv4('10.0.0.5')],
            [name]: [ipv4('192.168.0.5')],
        })[0], 'http://192.168.0.5:32145', `${name} must be recognized as a physical adapter`);
    }
    for (const name of ['Tailscale', 'WireGuard', 'ZeroTier One', 'Hamachi', 'tun0', 'tap0', 'wg0', 'utun2', 'Company VPN']) {
        assert.equal(listDirectOrigins(context.port, {
            [name]: [ipv4('10.0.0.5')],
            connection: [ipv4('192.168.0.5')],
        })[0], 'http://192.168.0.5:32145', `${name} must not replace the local network automatically`);
    }
    assert.deepEqual(listDirectOrigins(context.port, {
        lo: [ipv4('127.0.0.2'), ipv4('10.0.0.1', true)],
        invalid: [ipv4('0.0.0.0'), ipv4('224.0.0.1'), ipv4('255.255.255.255'), ipv4('999.1.2.3'), ipv4('169.254.1.4')],
        ipv6: [{ address: '::1', internal: false, family: 'IPv6', netmask: 'ffff::', mac: '00:00:00:00:00:00', cidr: '::1/128', scopeid: 0 }],
        'Wi-Fi': [ipv4('192.168.1.20'), ipv4('192.168.1.20')],
        duplicate: [ipv4('192.168.1.20')],
    }), ['http://192.168.1.20:32145'], 'advertise only distinct usable IPv4 addresses for the IPv4 listener');

    let interfaces: Record<string, NetworkInterfaceInfo[]> = {};
    const provider = new DirectConnectivityProvider(() => interfaces);
    const offline = await provider.start(context, {});
    assert.equal(offline.publicOrigin, context.localOrigin);
    assert.deepEqual(offline.reachableOrigins, [context.localOrigin]);
    assert.match(offline.title, /No shared network/);
    assert.match(offline.description, /only on this computer/);
    assert.match(offline.warning || '', /Other devices cannot connect/);

    interfaces = { 'Wi-Fi': [ipv4('192.168.1.20')] };
    const connected = await provider.start(context, {});
    assert.equal(connected.publicOrigin, 'http://192.168.1.20:32145', 'refresh must rescan interfaces after connecting to a network');
    assert.match(connected.warning || '', /private network/);
    assert.ok(!connected.description.includes('only on this computer'));

    interfaces = { Tailscale: [ipv4('100.64.8.3')] };
    assert.match((await provider.start(context, {})).description, /same VPN/);
    interfaces = { 'vEthernet (WSL)': [ipv4('172.23.240.1')] };
    assert.match((await provider.start(context, {})).warning || '', /may not reach other devices/);

    interfaces = { 'Wi-Fi': [ipv4('192.168.1.20')], Tailscale: [ipv4('100.64.8.3')] };
    const selected = await provider.start(context, { advertisedOrigin: 'http://100.64.8.3:32145' });
    assert.equal(selected.publicOrigin, 'http://100.64.8.3:32145', 'a user-selected VPN address must override automatic physical preference');
    assert.deepEqual(selected.reachableOrigins, ['http://100.64.8.3:32145', 'http://192.168.1.20:32145', context.localOrigin]);
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
    await testNetworkSelection();
    await testProviderLifecycle();
    console.log('Connectivity provider tests passed.');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
