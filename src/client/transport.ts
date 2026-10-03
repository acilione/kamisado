import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../shared/types.js';
export type GameSocket = Pick<Socket<ServerToClientEvents, ClientToServerEvents>,
    'on' | 'off' | 'onAny' | 'emit' | 'timeout' | 'connected' | 'disconnect' | 'removeAllListeners'>;

/** The mobile build supplies an in-process host; desktop and web use Socket.IO. */
export function connectGameSocket(): GameSocket {
    return window.__KAMISADO_SOCKET_FACTORY__?.() ?? io();
}
