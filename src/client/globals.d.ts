import type { ServerToClientEvents, ClientToServerEvents } from '../shared/types.js';
import type { Socket } from 'socket.io-client';

declare global {
    function io(): Socket<ServerToClientEvents, ClientToServerEvents>;
}
