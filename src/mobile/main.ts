import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { normalizeGameInvitation } from '../shared/invitation-url.js';
import { createLocalHost } from './local-host.js';

window.__KAMISADO_MOBILE__ = true;
const game = document.getElementById('app')!;
game.classList.add('hidden');
document.body.classList.add('mobile-app');
const home = document.createElement('main');
home.id = 'mobile-home';
home.innerHTML = `
    <h1>Kamisado</h1><p class="tagline">Color decides your next move.</p>
    <div class="menu-group">
        <button id="mobile-computer">Play computer</button>
        <p class="option-help">Ten levels. Play anywhere, even offline.</p>
        <button id="mobile-host">Host a friend</button>
        <button id="mobile-guest">Join a friend</button>
        <p class="option-help">Exchange connection codes. Works with mobile and desktop apps, on the same Wi-Fi or over the Internet.</p>
        <details><summary>Join a desktop LAN game</summary>
            <label for="mobile-invitation">Invitation link</label>
            <input id="mobile-invitation" type="url" placeholder="http://192.168…/game/…" autocomplete="off" autocapitalize="off" spellcheck="false">
            <button id="mobile-lan">Open game</button>
            <p class="option-help">Your browser opens the game hosted by your friend's computer.</p>
        </details>
        <p id="mobile-error" role="status" aria-live="polite"></p>
    </div>
    <p class="mobile-footnote">Keep the host app open and in the foreground during multiplayer games.</p>`;
document.body.prepend(home);
const toolbar = document.createElement('nav');
toolbar.className = 'mobile-session hidden';
toolbar.innerHTML = '<button id="mobile-home-button" type="button">End session</button><span id="mobile-session-title"></span>';
game.prepend(toolbar);
let active = false;
let local: ReturnType<typeof createLocalHost> | undefined;

async function leave(): Promise<void> {
    if (active && !confirm('End this session and return to the menu? Unfinished games are not saved.')) return;
    await local?.close();
    window.location.replace('/');
}

async function start(mode: 'computer' | 'host' | 'guest'): Promise<void> {
    if (active) return;
    active = true;
    const query = mode === 'computer' ? '?opponent=computer' : `?peer=${mode}`;
    history.replaceState({}, '', '/' + query);
    if (mode !== 'guest') {
        local = createLocalHost();
        window.__KAMISADO_SOCKET_FACTORY__ = () => local!.connect();
    }
    home.classList.add('hidden');
    game.classList.remove('hidden');
    toolbar.classList.remove('hidden');
    document.getElementById('mobile-session-title')!.textContent = mode === 'computer' ? 'Computer game' : 'Play with a friend';
    try {
        await import('../client/client.js');
        if (mode === 'computer') {
            (document.getElementById('opponent') as HTMLSelectElement).disabled = true;
            document.getElementById('join-game-options')!.classList.add('hidden');
            document.getElementById('join-separator')!.classList.add('hidden');
        }
        window.scrollTo(0, 0);
    } catch (error) {
        local?.close();
        document.getElementById('connection-notice')!.classList.remove('hidden');
        document.getElementById('connection-notice')!.textContent = 'Could not start the game. Return to the menu and try again.';
        console.error(error);
    }
}

document.getElementById('mobile-computer')!.addEventListener('click', () => { void start('computer'); });
document.getElementById('mobile-host')!.addEventListener('click', () => { void start('host'); });
document.getElementById('mobile-guest')!.addEventListener('click', () => { void start('guest'); });
document.getElementById('mobile-home-button')!.addEventListener('click', leave);
document.getElementById('mobile-lan')!.addEventListener('click', () => {
    const error = document.getElementById('mobile-error')!;
    let invitation: string;
    try { invitation = normalizeGameInvitation((document.getElementById('mobile-invitation') as HTMLInputElement).value); }
    catch { error.textContent = 'Paste the complete invitation link from the desktop game.'; return; }
    error.textContent = '';
    if (Capacitor.isNativePlatform()) {
        void Browser.open({ url: invitation }).catch(() => { error.textContent = 'Could not open the browser. Copy the invitation into your browser.'; });
    } else window.location.assign(invitation);
});

// The browser and native lifecycle signals both cover app switching and screen locking.
document.addEventListener('visibilitychange', () => local?.setSuspended(document.hidden));
window.addEventListener('pagehide', () => local?.close());
if (Capacitor.isNativePlatform()) {
    void App.addListener('appStateChange', ({ isActive }) => local?.setSuspended(!isActive));
    void App.addListener('backButton', () => { if (active) leave(); else void App.exitApp(); });
}
