import { P2pTransport, type P2pStatus } from './p2p-transport.js';

/** Manual invitation/reply exchange keeps matchmaking out of an external service. */
export class PeerPanel {
    readonly transport: P2pTransport;
    readonly role: 'host' | 'guest';
    private room: string | null = null;
    private finished = false;
    private busy = false;
    private status: P2pStatus['state'] = 'idle';
    private readonly panel = document.getElementById('peer-panel') as HTMLDetailsElement;
    private readonly outgoing = document.getElementById('peer-outgoing') as HTMLTextAreaElement;
    private readonly incoming = document.getElementById('peer-incoming') as HTMLTextAreaElement;
    private readonly generate = document.getElementById('peer-generate') as HTMLButtonElement;
    private readonly connect = document.getElementById('peer-connect') as HTMLButtonElement;
    private readonly notice = document.getElementById('peer-status')!;

    constructor(role: 'host' | 'guest') {
        this.role = role;
        this.transport = new P2pTransport(role);
        this.panel.classList.remove('hidden');
        this.panel.open = true;
        if (role === 'host') document.getElementById('peer-steps')!.prepend(document.getElementById('peer-outgoing-section')!);
        document.getElementById('peer-title')!.textContent = role === 'host' ? 'Host an Internet game' : 'Join an Internet game';
        document.getElementById('peer-instructions')!.textContent = role === 'host'
            ? 'Choose your game options and create a game below. Then send your invitation code to your friend, who opens Join Internet game in their app. Paste their reply here to connect.'
            : 'Paste the invitation code your friend sent you. Create a reply and send it back. Keep this window open while your friend connects.';
        document.getElementById('peer-incoming-label')!.textContent = role === 'host' ? '2. Paste your friend’s reply' : '1. Paste your friend’s invitation';
        document.getElementById('peer-outgoing-label')!.textContent = role === 'host' ? '1. Send this invitation to your friend' : '2. Send this reply to your friend';
        this.generate.textContent = role === 'host' ? 'Create invitation code' : 'Create reply code';
        this.connect.classList.toggle('hidden', role !== 'host');
        this.transport.onStatus(status => {
            this.status = status.state;
            this.notice.textContent = status.message;
            if (status.state === 'connected') this.panel.open = false;
            if (['error', 'disconnected'].includes(status.state)) {
                this.panel.open = true;
                this.outgoing.value = '';
            }
            this.refresh();
        });
        this.generate.addEventListener('click', () => { void this.run(async () => {
            const code = role === 'host'
                ? await this.transport.createOffer(this.room!)
                : await this.transport.acceptOffer(this.incoming.value);
            this.outgoing.value = code;
            if (role === 'host') this.incoming.value = '';
            this.outgoing.focus();
            this.outgoing.select();
        }); });
        this.connect.addEventListener('click', () => { void this.run(() => this.transport.acceptAnswer(this.incoming.value)); });
        document.getElementById('peer-copy')!.addEventListener('click', () => { void this.copyCode(); });
        this.incoming.addEventListener('input', () => this.refresh());
        window.addEventListener('pagehide', () => this.transport.close());
        this.refresh();
    }

    updateGame(id: string | null, finished = false): void {
        if (this.room && id !== this.room && (!id || this.transport.gameId !== id)) {
            this.transport.close();
            this.outgoing.value = '';
            this.incoming.value = '';
            this.panel.open = true;
        }
        this.room = id;
        this.finished = finished;
        if (this.role === 'host') {
            document.getElementById('peer-instructions')!.textContent = id
                ? 'Create an invitation code and send it to your friend, who opens Join Internet game in their app. Paste their reply here to connect. To reconnect, exchange fresh codes before the game’s disconnect countdown ends.'
                : 'Choose your game options and create a game below. Then send your invitation code to your friend, who opens Join Internet game in their app. Paste their reply here to connect.';
        }
        this.refresh();
    }

    private refresh(): void {
        this.generate.disabled = this.busy || this.status === 'connected' || this.finished ||
            (this.role === 'host' ? !this.room : !this.incoming.value.trim());
        this.connect.disabled = this.busy || this.status !== 'waiting-answer' || !this.incoming.value.trim();
        (document.getElementById('peer-copy') as HTMLButtonElement).disabled = !this.outgoing.value || this.busy;
    }

    private async run(action: () => Promise<unknown>): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        this.refresh();
        try { await action(); }
        catch (error) { this.notice.textContent = error instanceof Error ? error.message : 'Could not connect. Try a new invitation.'; }
        finally { this.busy = false; this.refresh(); }
    }

    private async copyCode(): Promise<void> {
        try {
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
            await navigator.clipboard.writeText(this.outgoing.value);
            this.notice.textContent = 'Code copied. Send it to your friend in your usual messaging app.';
        } catch {
            this.outgoing.focus();
            this.outgoing.select();
            this.notice.textContent = 'Code selected. Use your device’s copy command and send it to your friend.';
        }
    }
}
