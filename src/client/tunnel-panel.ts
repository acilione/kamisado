export interface TunnelRequest { mode: 'cloudflare' | 'ngrok'; authToken?: string }

/** One settings panel for desktop and Android; native code owns the connector. */
export function installTunnelPanel(): (() => Promise<string>) | null {
    if (!window.__KAMISADO_START_TUNNEL__ &&
        !(window.parent !== window && new URLSearchParams(location.search).get('hosting') === 'tunnel')) return null;
    const panel = document.getElementById('tunnel-options')!;
    const provider = document.getElementById('tunnel-provider') as HTMLSelectElement;
    const token = document.getElementById('tunnel-token') as HTMLInputElement;
    const status = document.getElementById('tunnel-status')!;
    panel.classList.remove('hidden');
    document.getElementById('join-game-options')!.classList.add('hidden');
    document.getElementById('app-join-options')!.classList.remove('hidden');
    const update = () => document.getElementById('tunnel-ngrok')!.classList.toggle('hidden', provider.value !== 'ngrok');
    provider.addEventListener('change', update);
    update();
    let sequence = 0;
    return async () => {
        status.textContent = 'Preparing your invitation… The first connection may need to download the connector.';
        const request: TunnelRequest = { mode: provider.value === 'ngrok' ? 'ngrok' : 'cloudflare', authToken: token.value.trim() || undefined };
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
            return origin;
        } catch (error) {
            status.textContent = error instanceof Error ? error.message : 'Could not create your invitation. Try again.';
            throw error;
        } finally { token.value = ''; }
    };
}
