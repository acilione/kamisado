import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { access } from 'node:fs/promises';
import type { ConnectivityDetails, ConnectivityProvider, ProviderContext } from './types.js';

export function tunnlOrigin(line: string): string | null {
    return /^READY (https:\/\/[a-z0-9]+(?:-[a-z0-9]+)+\.tunnl\.gg)$/.exec(line.trim())?.[1] || null;
}

export class TunnlConnectivityProvider implements ConnectivityProvider {
    readonly mode = 'tunnl' as const;
    private child: ChildProcess | null = null;
    private ready = false;
    constructor(private readonly directory: string,
        private readonly onExit: () => void = () => {},
        private readonly onStatus: (reconnecting: boolean) => void = () => {},
        private readonly probe: (url: string, options: RequestInit) => Promise<Response> = fetch,
        private readonly executable = path.resolve(__dirname, '../../../desktop/connectors',
            `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'tunnl.exe' : 'tunnl')
            .replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')) {}

    async start(context: ProviderContext): Promise<ConnectivityDetails> {
        this.ready = false;
        await access(this.executable).catch(() => { throw new Error('This build is missing the tunnl.gg connector. Install a complete build, or run npm run tunnel:build when developing.'); });
        const child = this.child = spawn(this.executable, ['--port', String(context.port), '--state', this.directory],
            { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        const publicOrigin = await new Promise<string>((resolve, reject) => {
            let buffer = '';
            let settled = false;
            const fail = (message: string) => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error(message)); } };
            const timer = setTimeout(() => fail('tunnl.gg did not connect in time. Check your network or choose another service.'), 65000);
            child.stdout!.on('data', (chunk: Buffer) => {
                buffer = (buffer + chunk.toString()).slice(-8192);
                let end: number;
                while ((end = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.slice(0, end).trim();
                    buffer = buffer.slice(end + 1);
                    const origin = tunnlOrigin(line);
                    if (origin) {
                        if (!settled) { settled = true; clearTimeout(timer); resolve(origin); }
                        if (this.ready) this.onStatus(false);
                    } else if (line === 'RECONNECTING' && this.ready) this.onStatus(true);
                    else if (line.startsWith('ERROR ')) fail(line.slice(6));
                }
            });
            child.once('error', () => fail('Could not start the tunnl.gg connector.'));
            child.once('exit', () => {
                const active = this.child === child;
                if (active) this.child = null;
                fail('tunnl.gg closed before the invitation was ready. Try another connection or service.');
                if (active && this.ready) this.onExit();
            });
        });
        let reachable = false;
        for (let attempt = 0; attempt < 10 && this.child === child; attempt++) {
            try {
                const response = await this.probe(publicOrigin + '/health', {
                    signal: AbortSignal.timeout(3000), redirect: 'error', headers: { 'tunnl-skip-browser-warning': '1' },
                });
                if (response.ok && (await response.json() as { status?: string }).status === 'ok') { reachable = true; break; }
            } catch { /* Allow the newly allocated address to become reachable. */ }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        if (!reachable || this.child !== child) throw new Error('tunnl.gg connected, but its invitation address is not reachable yet. Try again.');
        this.ready = true;
        return { mode: this.mode, publicOrigin, reachableOrigins: [publicOrigin], title: 'tunnl.gg invitation ready',
            description: 'Share the invitation from your game. Your friend joins in a browser without an account.',
            warning: 'Your friend may see a tunnl.gg welcome page. Free tunnels last up to 24 hours. Keep this app open.' };
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
