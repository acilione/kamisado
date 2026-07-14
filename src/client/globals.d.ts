import type { ServerToClientEvents, ClientToServerEvents } from '../shared/types.js';
import type { Socket } from 'socket.io-client';

declare global {
    function io(): Socket<ServerToClientEvents, ClientToServerEvents>;

    interface Window {
        __KAMISADO_RUNTIME_CONFIG__?: {
            publicOrigin: string | null;
        };
    }
}
