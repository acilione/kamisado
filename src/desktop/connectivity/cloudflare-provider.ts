import { spawn, type ChildProcess } from 'node:child_process';
import { access, chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { ConnectivityDetails, ConnectivityProvider, ProviderContext } from './types.js';

// Pin both the release and its published SHA-256; never execute an unchecked download.
export const CLOUDFLARED_VERSION = '2026.10.0';
const assets: Record<string, [string, string]> = {
    'win32-x64': ['cloudflared-windows-amd64.exe', '86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c'],
    'linux-x64': ['cloudflared-linux-amd64', 'd33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db'],
    'linux-arm64': ['cloudflared-linux-arm64', 'e6422b9d4f72d3194bc5a38676f13667c06666523217b842a877d72a80b5ac08'],
    'darwin-x64': ['cloudflared-darwin-amd64.tgz', '903845b81828c8cb3c5d13d816a2de71c06a3da5785469df8eb0e1b736d92f9f'],
    'darwin-arm64': ['cloudflared-darwin-arm64.tgz', 'a2f79ff7b9420aa537d74af239f376da170bbabeb529aec416002adac6a72e70'],
};

export function quickTunnelOrigin(line: string): string | null {
    return line.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com\b/)?.[0] || null;
}

export async function ensureCloudflared(directory: string): Promise<string> {
    const asset = assets[`${process.platform}-${process.arch}`];
    if (!asset) throw new Error('Cloudflare hosting is not available for this processor. Use ngrok or LAN.');
    const folder = path.join(directory, CLOUDFLARED_VERSION);
    await mkdir(folder, { recursive: true });
    const executable = path.join(folder, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
    const archive = path.join(folder, asset[0]);
    let data = await readFile(archive).catch(() => null);
    if (!data || createHash('sha256').update(data).digest('hex') !== asset[1]) {
        const response = await fetch(`https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${asset[0]}`, { signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw new Error('Could not download the Cloudflare connector. Check your Internet connection and try again.');
        data = Buffer.from(await response.arrayBuffer());
        if (createHash('sha256').update(data).digest('hex') !== asset[1]) throw new Error('Cloudflare connector verification failed. The download was not run.');
        await writeFile(archive + '.download', data);
        await rename(archive + '.download', archive);
    }
    if (asset[0].endsWith('.tgz')) {
        // The verified upstream archive contains the executable; extract it afresh.
        await new Promise<void>((resolve, reject) => {
            const child = spawn('/usr/bin/tar', ['-xzf', archive, '-C', folder, 'cloudflared'], { windowsHide: true, stdio: 'ignore' });
            child.once('error', reject);
            child.once('exit', code => code === 0 ? resolve() : reject(new Error('Could not unpack the Cloudflare connector.')));
        });
    } else if (archive !== executable) await writeFile(executable, data);
    await chmod(executable, 0o700);
    await access(executable);
    return executable;
}

export class CloudflareConnectivityProvider implements ConnectivityProvider {
    readonly mode = 'cloudflare' as const;
    private child: ChildProcess | null = null;
    private ready = false;
    constructor(private readonly directory: string, private readonly onExit: () => void = () => {},
        private readonly probe: (url: string, options: { signal: AbortSignal }) => Promise<Response> = fetch) {}

    async start(context: ProviderContext): Promise<ConnectivityDetails> {
        this.ready = false;
        const executable = await ensureCloudflared(this.directory);
        const config = path.join(this.directory, 'quick-tunnel.yml');
        // Ignore a player's unrelated named-tunnel configuration.
        await writeFile(config, '{}\n');
        const child = this.child = spawn(executable, ['tunnel', '--config', config, '--no-autoupdate',
            '--protocol', 'http2', '--url', context.localOrigin], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        const publicOrigin = await new Promise<string>((resolve, reject) => {
            let origin: string | null = null;
            let registered = false;
            let settled = false;
            let buffer = '';
            const finish = (error?: Error) => {
                if (settled) return;
                if (!error && (!origin || !registered)) return;
                settled = true;
                clearTimeout(timer);
                if (error) reject(error); else resolve(origin!);
            };
            const timer = setTimeout(() => finish(new Error('Cloudflare could not connect within 60 seconds. Try again, or select ngrok.')), 60000);
            const output = (chunk: Buffer) => {
                buffer = (buffer + chunk.toString()).slice(-8192);
                origin ||= quickTunnelOrigin(buffer);
                registered ||= buffer.includes('Registered tunnel connection');
                finish();
            };
            child.stdout?.on('data', output);
            child.stderr?.on('data', output);
            child.once('error', () => finish(new Error('Could not start the Cloudflare connector.')));
            child.once('exit', () => {
                const active = this.child === child;
                if (active) this.child = null;
                if (!settled) finish(new Error('Cloudflare closed the connection before it was ready. Try again, or select ngrok.'));
                else if (active && this.ready) this.onExit();
            });
        });
        // Registration can precede DNS propagation. Do not hand out a dead link.
        let reachable = false;
        for (let attempt = 0; attempt < 15 && this.child === child; attempt++) {
            try {
                const response = await this.probe(publicOrigin + '/health', { signal: AbortSignal.timeout(3000) });
                if (response.ok && (await response.json() as { status?: string }).status === 'ok') { reachable = true; break; }
            } catch { /* A new hostname may need a few seconds to become reachable. */ }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (!reachable) throw new Error('Cloudflare connected, but its public address is not reachable yet. Try creating the game again.');
        this.ready = true;
        return { mode: this.mode, publicOrigin, reachableOrigins: [publicOrigin], title: 'Cloudflare invitation ready',
            description: 'Share the invitation from your game. Your friend opens it in a browser, without an account.',
            warning: 'Quick Tunnels are a free testing service without an uptime guarantee. Keep this app open.' };
    }

    async stop(): Promise<void> {
        const child = this.child;
        this.child = null;
        this.ready = false;
        if (!child || child.exitCode !== null) return;
        await new Promise<void>(resolve => {
            const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
            child.once('exit', () => { clearTimeout(timer); resolve(); });
            child.kill();
        });
    }
}
