/** Native share sheets where available; a clipboard fallback on desktop browsers. */
export async function shareLink(link: string): Promise<'shared' | 'copied' | 'cancelled'> {
    if (window.__KAMISADO_SHARE__) return window.__KAMISADO_SHARE__(link);
    if (navigator.share) {
        try {
            // Custom app schemes are shared as text: the Web Share URL field only accepts web URLs.
            await navigator.share({ title: 'Play Kamisado', text: link });
            return 'shared';
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
        }
    }
    await navigator.clipboard.writeText(link);
    return 'copied';
}
