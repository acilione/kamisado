import type { ServerToClientEvents, ClientToServerEvents } from '../shared/types.js';
import type { Socket } from 'socket.io-client';

declare global {
    function io(): Socket<ServerToClientEvents, ClientToServerEvents>;

    interface Window {
        __KAMISADO_START_TUNNEL__?: (request: import('./tunnel-panel.js').TunnelRequest) => Promise<string>;
        __KAMISADO_CREATE_TURN__?: (request: import('../shared/turn-provider.js').TurnCredentialRequest) => Promise<import('../shared/peer-invitation.js').InvitationRelay>;
        __KAMISADO_SOCKET_FACTORY__?: () => import('./transport.js').GameSocket;
        __KAMISADO_MOBILE__?: boolean;
        __KAMISADO_JOIN_PEER__?: (invitation?: string) => void;
        __KAMISADO_OPEN_LAN__?: (url: string) => void;
        __KAMISADO_SHARE__?: (link: string) => Promise<'shared' | 'copied' | 'cancelled'>;
        /** Optional local signaling endpoint used by integration tests. */
        __KAMISADO_SIGNALING__?: { host: string; port: number; path: string; secure: boolean; key?: string };
        __KAMISADO_RUNTIME_CONFIG__?: {
            publicOrigin: string | null;
        };
    }
}
