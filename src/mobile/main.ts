import { App } from '@capacitor/app';
import { Share } from '@capacitor/share';
import { Browser } from '@capacitor/browser';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { createMeteredCredential } from '../shared/turn-provider.js';
import { normalizePeerInvitation } from '../shared/peer-invitation.js';
import { normalizeGameInvitation } from '../shared/invitation-url.js';
import { createLocalHost } from './local-host.js';
import { installMobileTunnel } from './tunnel-host.js';

window.__KAMISADO_MOBILE__ = true;
document.body.classList.add('mobile-app');
const game = document.getElementById('app')!;
const toolbar = document.createElement('nav');
toolbar.className = 'mobile-session';
toolbar.innerHTML = '<button id="mobile-home-button" type="button">Main menu</button><span>Kamisado</span>';
game.prepend(toolbar);
let local: ReturnType<typeof createLocalHost> | undefined;
let opening = false;
let stopTunnel: (() => Promise<void>) | undefined;

function mayLeave(): boolean {
    return document.getElementById('game-screen')!.classList.contains('hidden') ||
        confirm('Leave this game? Unfinished games are not saved.');
}

async function join(invitation?: string): Promise<void> {
    if (opening || !mayLeave()) return;
    const code = invitation ? normalizePeerInvitation(invitation) : '';
    opening = true;
    await stopTunnel?.();
    await local?.close();
    window.location.replace('/?peer=guest' + (code ? '#' + code : ''));
}
window.__KAMISADO_JOIN_PEER__ = invitation => { void join(invitation); };
window.__KAMISADO_OPEN_LAN__ = value => {
    const url = normalizeGameInvitation(value);
    if (Capacitor.isNativePlatform()) void Browser.open({ url }).catch(() => alert('Could not open the browser.'));
    else window.location.assign(url);
};
document.getElementById('mobile-home-button')!.addEventListener('click', async () => {
    if (!mayLeave()) return;
    await stopTunnel?.();
    await local?.close();
    window.location.replace('/?setup=1');
});

function openLink(url: string): void {
    try { void join(normalizePeerInvitation(url)); }
    catch { document.getElementById('connection-notice')!.textContent = 'This is not a valid Kamisado invitation.'; }
}

async function boot(): Promise<void> {
    if (Capacitor.isNativePlatform()) {
        window.__KAMISADO_CREATE_TURN__ = request => createMeteredCredential(request, async input => {
            const response = await CapacitorHttp.request({ ...input, headers: { 'Content-Type': 'application/json' },
                connectTimeout: 15000, readTimeout: 15000, disableRedirects: true });
            return { status: response.status, data: response.data };
        });
        window.__KAMISADO_SHARE__ = async link => {
            try {
                await Share.share({ title: 'Play Kamisado', text: link, dialogTitle: 'Invite a friend' });
                return 'shared';
            } catch (error) {
                if (/cancel/i.test(String(error))) return 'cancelled';
                throw error;
            }
        };
        await App.addListener('appUrlOpen', ({ url }) => openLink(url));
        // Internal navigations have a query; only a fresh native launch consumes its launch URL.
        if (!window.location.search) {
            const launch = await App.getLaunchUrl();
            if (launch?.url) { openLink(launch.url); if (opening) return; }
        }
        void App.addListener('appStateChange', ({ isActive }) => local?.setSuspended(!isActive));
        void App.addListener('backButton', () => {
            if (!document.getElementById('game-screen')!.classList.contains('hidden') ||
                new URLSearchParams(location.search).get('peer') === 'guest') {
                document.getElementById('mobile-home-button')!.click();
            } else void App.exitApp();
        });
    }
    if (opening) return;
    const guest = new URLSearchParams(location.search).get('peer') === 'guest';
    if (!guest) {
        const nativeTunnel = Capacitor.getPlatform() === 'android';
        history.replaceState({}, '', nativeTunnel ? '/?hosting=tunnel' : '/?peer=host');
        local = createLocalHost();
        if (nativeTunnel) stopTunnel = await installMobileTunnel(local);
        window.__KAMISADO_SOCKET_FACTORY__ = () => local!.connect();
    }
    await import('../client/client.js');
}

document.addEventListener('visibilitychange', () => local?.setSuspended(document.hidden));
window.addEventListener('pagehide', () => { void stopTunnel?.(); void local?.close(); });
void boot().catch(error => {
    const notice = document.getElementById('connection-notice')!;
    notice.classList.remove('hidden');
    notice.textContent = 'Could not open the game. Close and reopen Kamisado to try again.';
    console.error(error);
});
