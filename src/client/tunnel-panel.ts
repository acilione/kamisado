export interface TunnelRequest { mode: 'cloudflare' | 'ngrok' | 'tunnl'; authToken?: string }

/** One settings panel for desktop and Android; native code owns the connector. */
export function installTunnelPanel(): (() => Promise<string>) | null {
    if (!window.__KAMISADO_START_TUNNEL__ &&
        !(window.parent !== window && new URLSearchParams(location.search).get('hosting') === 'tunnel')) return null;
    const panel = document.getElementById('tunnel-options') as HTMLDetailsElement;
    const provider = document.getElementById('tunnel-provider') as HTMLSelectElement;
    const token = document.getElementById('tunnel-token') as HTMLInputElement;
    const status = document.getElementById('tunnel-status')!;
    panel.classList.remove('hidden');
    document.getElementById('join-game-options')!.classList.add('hidden');
    document.getElementById('app-join-options')!.classList.remove('hidden');
    const update = () => {
        const ngrok = provider.value === 'ngrok';
        const tunnl = provider.value === 'tunnl';
        document.getElementById('tunnel-ngrok')!.classList.toggle('hidden', !ngrok);
        document.getElementById('tunnel-selection')!.textContent = ngrok ? 'ngrok · host account' : tunnl ? 'tunnl.gg · no account' : 'Cloudflare · no account';
        document.getElementById('tunnel-provider-help')!.textContent = ngrok
            ? 'Use your ngrok account. The free plan has usage limits and a browser welcome page.'
            : tunnl ? 'No account or token. Free tunnels last up to 24 hours; your friend may see a welcome page before joining.'
            : 'Free, temporary links without an account. Availability is not guaranteed.';
    };
    provider.addEventListener('change', update);
    update();
    let sequence = 0;
    return async () => {
        status.textContent = provider.value === 'cloudflare'
            ? 'Preparing your invitation… The first desktop connection may need to download the connector.'
            : 'Preparing your invitation…';
        status.dataset.state = 'connecting';
        const mode = provider.value === 'cloudflare' ? 'cloudflare' : provider.value === 'ngrok' ? 'ngrok' : 'tunnl';
        const request: TunnelRequest = { mode, ...(mode === 'ngrok' ? { authToken: token.value.trim() || undefined } : {}) };
        try {
            const origin = window.__KAMISADO_START_TUNNEL__ ? await window.__KAMISADO_START_TUNNEL__(request) : await new Promise<string>((resolve, reject) => {
                const requestId = ++sequence;
                const listener = (event: MessageEvent) => {
                    if (event.source !== parent || event.data?.type !== 'kamisado:tunnel-result' || event.data.requestId !== requestId) return;
                    clearTimeout(timer);
                    window.removeEventListener('message', listener);
                    if (event.data.success) resolve(event.data.origin);
                    else reject(new Error(event.data.message || 'Could not start the tunnel.'));
                };
                const timer = setTimeout(() => {
                    window.removeEventListener('message', listener);
                    reject(new Error('The tunnel did not respond. Open Connection settings to retry.'));
                }, 250000);
                window.addEventListener('message', listener);
                parent.postMessage({ type: 'kamisado:start-tunnel', requestId, request }, '*');
            });
            status.textContent = 'Connected. Share the invitation in your game.';
            status.dataset.state = 'ready';
            return origin;
        } catch (error) {
            panel.open = true;
            status.dataset.state = 'error';
            status.textContent = error instanceof Error ? error.message : 'Could not create your invitation. Try again.';
            throw error;
        } finally { token.value = ''; }
    };
}
