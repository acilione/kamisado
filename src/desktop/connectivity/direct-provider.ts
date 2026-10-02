import { networkInterfaces } from 'os';
import { isIPv4 } from 'net';

import type {
    ConnectivityDetails,
    ConnectivityProvider,
    ProviderContext,
    ProviderOptions,
} from './types.js';

function normalizeAdvertisedOrigin(value: string): string {
    const candidate = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `http://${value}`;
    const parsed = new URL(candidate);

    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error('The public address must be an HTTP(S) URL without credentials.');
    }
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
        throw new Error('The public address must contain only a host and optional port.');
    }
    return parsed.origin;
}

function isPrivateIpv4(address: string): boolean {
    const octets = address.split('.').map(Number);
    return octets[0] === 10 ||
        (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
        (octets[0] === 192 && octets[1] === 168);
}

type InterfaceReader = () => ReturnType<typeof networkInterfaces>;
type DirectAddress = { address: string; name: string; score: number; kind: 'network' | 'vpn' | 'virtual' };

function isUsableIpv4(address: string): boolean {
    if (!isIPv4(address)) return false;
    const [first, second] = address.split('.').map(Number);
    return first !== 0 && first !== 127 && first < 224 && !(first === 169 && second === 254);
}

function describeInterface(name: string, address: string): DirectAddress {
    let score = isPrivateIpv4(address) ? 20 : 10;
    let kind: DirectAddress['kind'] = 'network';
    if (/(?:^|[\s(_-])(?:wi-?fi|wireless|ethernet|wlan|wlp|wlx|eth\d|en\d|en[ops]\d)/i.test(name)) score += 30;
    if (/tailscale|wireguard|zerotier|hamachi|vpn|utun|(?:^|[\s(_-])(?:tun|tap|wg)\d*(?:$|[\s)_-])/i.test(name)) {
        kind = 'vpn';
        score -= 30;
    }
    if (/docker|wsl|veth|hyper-v|virtualbox|vbox|vmware|loopback|virbr|br-|bridge|podman|lxc/i.test(name)) {
        kind = 'virtual';
        score -= 80;
    }
    return { address, name, score, kind };
}

function directAddresses(interfaces: ReturnType<InterfaceReader>): DirectAddress[] {
    const addresses: DirectAddress[] = [];

    for (const [name, entries] of Object.entries(interfaces)) {
        for (const entry of entries || []) {
            if (entry.family !== 'IPv4' || entry.internal || !isUsableIpv4(entry.address)) continue;
            addresses.push(describeInterface(name, entry.address));
        }
    }

    addresses.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name) || a.address.localeCompare(b.address));
    return addresses.filter((entry, index, all) => all.findIndex(other => other.address === entry.address) === index);
}

export function listDirectOrigins(port: number, interfaces = networkInterfaces()): string[] {
    return directAddresses(interfaces).map(entry => `http://${entry.address}:${port}`);
}

export class DirectConnectivityProvider implements ConnectivityProvider {
    readonly mode = 'direct' as const;

    constructor(private readonly readInterfaces: InterfaceReader = networkInterfaces) {}

    async start(context: ProviderContext, options: ProviderOptions): Promise<ConnectivityDetails> {
        const addresses = directAddresses(this.readInterfaces());
        const lanOrigins = addresses.map(entry => `http://${entry.address}:${context.port}`);
        const advertisedOrigin = options.advertisedOrigin?.trim()
            ? normalizeAdvertisedOrigin(options.advertisedOrigin.trim())
            : null;
        const reachableOrigins = [advertisedOrigin, ...lanOrigins, context.localOrigin]
            .filter((origin): origin is string => origin !== null)
            .filter((origin, index, all) => all.indexOf(origin) === index);

        return {
            mode: this.mode,
            publicOrigin: advertisedOrigin || lanOrigins[0] || context.localOrigin,
            reachableOrigins,
            title: !advertisedOrigin && !lanOrigins.length ? 'No shared network detected' : 'Direct host ready',
            description: advertisedOrigin
                ? 'Players connect directly to the address you supplied.'
                : !lanOrigins.length
                    ? 'This game currently opens only on this computer.'
                    : addresses[0].kind === 'vpn'
                        ? 'Friends connected to the same VPN can join using your invitation.'
                        : addresses[0].kind === 'virtual'
                            ? 'Only a virtual network address was detected.'
                            : 'Players on your local network can connect directly to this computer.',
            warning: advertisedOrigin
                ? undefined
                : !lanOrigins.length
                    ? 'Other devices cannot connect yet. Connect this computer to Wi-Fi or Ethernet, then refresh the connection.'
                    : addresses[0].kind === 'virtual'
                        ? 'This address may not reach other devices. Connect to Wi-Fi or Ethernet, then refresh and choose that address.'
                        : 'Both devices must share a reachable network. If a friend cannot connect, check the selected address and allow Kamisado through the firewall on your private network.',
        };
    }

    async stop(): Promise<void> {
        // Direct mode has no external resource: stopping only removes its advertised origin.
    }
}

export { normalizeAdvertisedOrigin };
