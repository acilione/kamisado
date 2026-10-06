import type { TurnCredentialRequest } from '../shared/turn-provider.js';
import type { InvitationRelay } from '../shared/peer-invitation.js';

let nextRequest = 0;
export function canGenerateTurn(): boolean {
    return !!window.__KAMISADO_CREATE_TURN__ || window.parent !== window;
}

export async function generateTurn(request: TurnCredentialRequest): Promise<InvitationRelay> {
    if (window.__KAMISADO_CREATE_TURN__) return window.__KAMISADO_CREATE_TURN__(request);
    if (window.parent === window) throw new Error('Automatic TURN credentials require the desktop or mobile app.');
    return new Promise((resolve, reject) => {
        const requestId = ++nextRequest;
        const listener = (event: MessageEvent) => {
            if (event.source !== window.parent || event.data?.type !== 'kamisado:turn-result' || event.data.requestId !== requestId) return;
            clearTimeout(timer); window.removeEventListener('message', listener);
            if (event.data.success) resolve(event.data.relay);
            else reject(new Error(event.data.message || 'Could not generate TURN credentials.'));
        };
        const timer = setTimeout(() => {
            window.removeEventListener('message', listener);
            reject(new Error('The TURN provider did not respond in time.'));
        }, 45000);
        window.addEventListener('message', listener);
        window.parent.postMessage({ type: 'kamisado:create-turn', requestId, request }, '*');
    });
}
