import { toCanvas } from 'qrcode';

/** Keeps the invitation, QR code and clipboard action on the same current URL. */
export class InvitationPanel {
    private readonly panel = document.getElementById('invite-panel') as HTMLDetailsElement;
    private readonly title = document.getElementById('invite-title')!;
    private readonly help = document.getElementById('invite-help')!;
    private readonly link = document.getElementById('share-link') as HTMLInputElement;
    private readonly button = document.getElementById('share-btn') as HTMLButtonElement;
    private readonly qr = document.getElementById('share-qr') as HTMLCanvasElement;
    private readonly feedback = document.getElementById('share-feedback')!;
    private origin: string;
    private gameId: string | null = null;
    private waiting = false;
    private qrVersion = 0;

    constructor(origin: string) {
        this.origin = origin;
        this.button.textContent = typeof window.__KAMISADO_SHARE__ === 'function' || typeof navigator.share === 'function' ? 'Share link' : 'Copy link';
        this.button.addEventListener('click', () => { void this.copy(); });
        this.link.addEventListener('click', () => this.link.select());
    }

    setOrigin(origin: string): void {
        if (this.origin === origin) return;
        this.origin = origin;
        this.refreshLink();
    }

    setGame(gameId: string | null, waiting = false): void {
        const newGame = this.gameId !== gameId;
        const waitingChanged = this.waiting !== waiting;
        this.gameId = gameId;
        this.waiting = waiting;
        this.panel.classList.toggle('hidden', !gameId);
        if (!gameId) {
            this.panel.open = false;
            return;
        }
        // Preserve the player's choice to expand/collapse between state updates.
        if (newGame || waitingChanged) this.panel.open = waiting;
        this.title.textContent = waiting ? 'Invite a friend' : 'Share this game';
        this.help.textContent = waiting
            ? 'Send the link or scan the code on another device. Your friend plays in their browser.'
            : 'Send the link or scan the code to watch this game in a browser.';
        this.refreshLink();
    }

    private refreshLink(): void {
        if (!this.gameId) return;
        const url = new URL(`/game/${this.gameId}`, this.origin).href;
        if (this.link.value === url) return;
        this.link.value = url;
        this.feedback.textContent = '';
        this.qr.classList.add('hidden');
        // Render offscreen so a slower render for an old tunnel cannot replace
        // the current invitation after switching hosting modes.
        const version = ++this.qrVersion;
        const canvas = document.createElement('canvas');
        void toCanvas(canvas, url, {
            width: 160,
            margin: 4,
            errorCorrectionLevel: 'M',
            color: { dark: '#171a20', light: '#ffffff' },
        }).then(() => {
            if (version !== this.qrVersion) return;
            this.qr.width = canvas.width;
            this.qr.height = canvas.height;
            const context = this.qr.getContext('2d');
            if (!context) return;
            context.drawImage(canvas, 0, 0);
            this.qr.setAttribute('aria-label', 'Scan this code to open the invitation link');
            this.qr.classList.remove('hidden');
        }).catch(() => {
            // The selectable invitation remains fully usable without canvas.
            if (version === this.qrVersion) this.qr.classList.add('hidden');
        });
    }

    private async copy(): Promise<void> {
        const url = this.link.value;
        try {
            if (window.__KAMISADO_SHARE__) {
                const result = await window.__KAMISADO_SHARE__(url);
                this.feedback.textContent = result === 'cancelled' ? '' : 'Invitation shared.';
                return;
            }
            if (navigator.share) {
                try { await navigator.share({ title: 'Play Kamisado', url }); }
                catch (error) { if ((error as Error).name === 'AbortError') return; throw error; }
                this.feedback.textContent = 'Invitation shared.';
                return;
            }
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
            await navigator.clipboard.writeText(url);
            this.feedback.textContent = this.link.value === url
                ? 'Invitation link copied.'
                : 'The invitation changed. Copy the updated link.';
        } catch {
            this.link.focus({ preventScroll: true });
            this.link.select();
            this.link.setSelectionRange(0, this.link.value.length);
            this.feedback.textContent = 'Link selected. Use your device’s copy command to copy it.';
        }
    }
}
