import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { GameSocket } from '../client/transport.js';
import type { TunnelRequest } from '../client/tunnel-panel.js';
import type { createLocalHost } from './local-host.js';

interface TunnelPlugin {
    start(options: TunnelRequest): Promise<{ origin: string }>;
    stop(): Promise<void>;
    send(options: { session: string; frame: unknown }): Promise<void>;
    addListener(event: 'request', listener: (message: { session: string; action: string; frame?: any }) => void): Promise<PluginListenerHandle>;
    addListener(event: 'stopped', listener: () => void): Promise<PluginListenerHandle>;
}
const native = registerPlugin<TunnelPlugin>('GameTunnel');
const allowed = new Set(['joinGame', 'checkActiveSession', 'makeMove', 'confirmNextRound', 'fillChoice']);

export async function installMobileTunnel(host: ReturnType<typeof createLocalHost>): Promise<() => Promise<void>> {
    if (Capacitor.getPlatform() !== 'android') return async () => {};
    const ngrokOption = document.querySelector<HTMLOptionElement>('#tunnel-provider option[value="ngrok"]')!;
    ngrokOption.disabled = true;
    ngrokOption.textContent = 'ngrok — desktop hosting only';
    const connections = new Map<string, GameSocket>();
    const send = (session: string, frame: unknown) => { void native.send({ session, frame }).catch(() => {}); };
    const listener = await native.addListener('request', message => {
        if (message.action === 'connect') {
            if (connections.has(message.session) || connections.size >= 8) return;
            const socket = host.connect();
            connections.set(message.session, socket);
            socket.on('connect', () => send(message.session, { kind: 'connected' }));
            socket.onAny((event, ...args) => send(message.session, { kind: 'event', event, args }));
        } else if (message.action === 'close') {
            connections.get(message.session)?.disconnect();
            connections.delete(message.session);
        } else if (message.action === 'send') {
            const socket = connections.get(message.session);
            const frame = message.frame;
            if (!socket || !frame || frame.kind !== 'request' || !allowed.has(frame.event)) return;
            const acknowledge = (data: unknown) => send(message.session, { kind: 'ack', id: frame.id, data });
            if (frame.id !== undefined && (!Number.isSafeInteger(frame.id) || frame.id < 1)) return;
            (socket.emit as Function)(frame.event, frame.data, ...(frame.id === undefined ? [] : [acknowledge]));
        }
    });
    const stopped = await native.addListener('stopped', () => {
        host.setPublicOrigin(null);
        document.getElementById('connection-notice')!.classList.remove('hidden');
        document.getElementById('connection-notice')!.textContent = 'The Internet tunnel stopped. Return to the main menu and create a new invitation.';
    });
    window.__KAMISADO_START_TUNNEL__ = async request => {
        const { origin } = await native.start(request);
        host.setPublicOrigin(origin);
        return origin;
    };
    return async () => {
        await native.stop();
        await listener.remove();
        await stopped.remove();
        for (const socket of connections.values()) socket.disconnect();
        connections.clear();
    };
}
