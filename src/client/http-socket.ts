import { EventSocket } from './event-socket.js';
import type { GameSocket } from './transport.js';

const EVENTS = new Set(['joinGame', 'checkActiveSession', 'makeMove', 'confirmNextRound', 'fillChoice']);

/** Android's native HTTP bridge uses bounded long polling, with no ICE negotiation. */
export function connectHttpSocket(): GameSocket {
    let stopped = false;
    let session = '';
    let connection = new AbortController();
    const socket = new EventSocket({
        sendRequest(frame) {
            if (!session || stopped) return false;
            const active = connection;
            void request('send', { session, frame }, active.signal).catch(() => active.abort());
            return true;
        },
        close() { stopped = true; connection.abort(); socket.setConnected(false); },
    }, EVENTS);
    async function request(action: string, data: unknown, signal?: AbortSignal): Promise<any> {
        const controller = new AbortController();
        const cancel = () => controller.abort();
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) controller.abort();
        const timer = setTimeout(cancel, 35000);
        try {
            const response = await fetch(`/bridge/${action}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
                signal: controller.signal, credentials: 'same-origin',
            });
            if (!response.ok) throw new Error('The host connection is unavailable.');
            return await response.json();
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); }
    }
    async function run(): Promise<void> {
        while (!stopped) {
            try {
                connection = new AbortController();
                session = (await request('connect', {}, connection.signal)).session;
                while (!stopped) {
                    const frames = await request('poll', { session }, connection.signal);
                    for (const frame of frames) {
                        if (frame.kind === 'connected') socket.setConnected(true);
                        else if (frame.kind === 'ack') socket.acknowledge(frame.id, frame.data);
                        else if (frame.kind === 'event' && Array.isArray(frame.args)) socket.deliver(frame.event, ...frame.args);
                    }
                }
            } catch {
                socket.setConnected(false);
                if (!stopped) await new Promise(resolve => setTimeout(resolve, 2000));
            } finally {
                void request('close', { session }).catch(() => {});
            }
        }
    }
    void run();
    return socket as unknown as GameSocket;
}
