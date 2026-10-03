import { createSessionHost, type SessionSocket, type SessionHub } from '../server/sessions.js';
import { EventSocket } from '../client/event-socket.js';
import type { GameSocket } from '../client/transport.js';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/types.js';
import { requestComputerMove } from './worker-runner.js';

type Listener = (...args: any[]) => void;
const CLIENT_EVENTS = new Set<keyof ClientToServerEvents>([
    'createGame', 'joinGame', 'checkActiveSession', 'makeMove', 'confirmNextRound',
    'fillChoice', 'cancelGame', 'leaveComputerGame',
]);

/** In-process transport only. The existing session host still validates every action. */
export function createLocalHost() {
    const connections = new Map<string, { rooms: Set<string>; client: EventSocket }>();
    let closed = false;
    let closing: Promise<void> | undefined;
    const hub: SessionHub = {
        sockets: { sockets: new Map() },
        emit(event, ...args) {
            for (const { client } of connections.values()) deliver(client, event, args);
        },
        to(room) {
            return { emit(event, ...args) {
                for (const [id, { rooms, client }] of connections) {
                    if (id === room || rooms.has(room)) deliver(client, event, args);
                }
            } };
        },
    };
    const host = createSessionHost(hub, { requestComputerMove, getPublicOrigin: () => null });

    function deliver(client: EventSocket, event: keyof ServerToClientEvents, args: unknown[]): void {
        // Preserve the network boundary: rendering cannot mutate the live board.
        const copy = structuredClone(args);
        queueMicrotask(() => { if (client.connected) client.deliver(event, ...copy); });
    }

    return {
        connect(): GameSocket {
            if (closed) throw new Error('This game session has ended.');
            const id = crypto.randomUUID();
            const rooms = new Set<string>();
            const handlers = new Map<string, Listener>();
            const client = new EventSocket({
                sendRequest(frame) {
                    if (!client.connected || !CLIENT_EVENTS.has(frame.event as keyof ClientToServerEvents)) return false;
                    const data = structuredClone(frame.data);
                    queueMicrotask(() => {
                        if (!client.connected || closed) return;
                        const callback = frame.id === undefined ? undefined : (value: unknown) => {
                            const copy = structuredClone(value);
                            queueMicrotask(() => client.acknowledge(frame.id!, copy));
                        };
                        handlers.get(frame.event)?.(data, callback);
                    });
                    return true;
                },
                close() {
                    if (!connections.delete(id)) return;
                    hub.sockets.sockets.delete(id);
                    client.setConnected(false, 'Local session ended');
                    handlers.get('disconnect')?.();
                    handlers.clear();
                },
            }, CLIENT_EVENTS);
            const serverSocket: SessionSocket = {
                id,
                on(event: string, listener: Listener) { handlers.set(event, listener); },
                emit(event, ...args) { deliver(client, event, args); },
                join(room) { rooms.add(room); },
                leave(room) { rooms.delete(room); },
                disconnect() { client.disconnect(); },
            };
            connections.set(id, { rooms, client });
            hub.sockets.sockets.set(id, serverSocket);
            queueMicrotask(() => {
                if (closed || !connections.has(id)) return;
                host.connect(serverSocket);
                client.setConnected(true);
            });
            // Same narrow event surface as the WebRTC adapter, without Socket.IO internals.
            return client as unknown as GameSocket;
        },
        setSuspended: host.setSuspended,
        close(): Promise<void> {
            if (closing) return closing;
            closed = true;
            host.close();
            // Let the queued hostStopped event reach the WebRTC channel before closing it.
            closing = new Promise(resolve => setTimeout(() => {
                for (const { client } of [...connections.values()]) client.disconnect();
                resolve();
            }, 100));
            return closing;
        },
    };
}
