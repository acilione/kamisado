import { networkInterfaces } from 'os';

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

function interfaceScore(name: string, address: string): number {
    let score = isPrivateIpv4(address) ? 20 : 10;
    if (/wi-?fi|wireless|ethernet|en\d|eth\d/i.test(name)) score += 20;
    if (/docker|wsl|vethernet|hyper-v|virtualbox|vmware|loopback/i.test(name)) score -= 50;
    if (address.startsWith('169.254.')) score -= 100;
    return score;
}

export function listDirectOrigins(port: number): string[] {
    const addresses: Array<{ address: string; score: number }> = [];

    for (const [name, entries] of Object.entries(networkInterfaces())) {
        for (const entry of entries || []) {
            if (entry.family !== 'IPv4' || entry.internal) continue;
            addresses.push({ address: entry.address, score: interfaceScore(name, entry.address) });
        }
    }

    return [...new Map(
        addresses
            .filter(entry => entry.score > -80)
            .sort((a, b) => b.score - a.score)
            .map(entry => [entry.address, `http://${entry.address}:${port}`]),
    ).values()];
}

export class DirectConnectivityProvider implements ConnectivityProvider {
    readonly mode = 'direct' as const;

    async start(context: ProviderContext, options: ProviderOptions): Promise<ConnectivityDetails> {
        const lanOrigins = listDirectOrigins(context.port);
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
            title: 'Direct host ready',
            description: advertisedOrigin
                ? 'Players connect directly to the address you supplied.'
                : 'Players on your local network can connect directly to this computer.',
            warning: advertisedOrigin
                ? undefined
                : 'Internet play requires port forwarding and a public address, or use ngrok instead.',
        };
    }

    async stop(): Promise<void> {
        // Direct mode has no external resource: stopping only removes its advertised origin.
    }
}

export { normalizeAdvertisedOrigin };
