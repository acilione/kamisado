import { P2pTransport, invitationUsesRelay, type P2pStatus } from './p2p-transport.js';
import { parseRelaySettings } from './peer-network.js';
import { AutomaticPeer, parseAutomaticInvitation } from './automatic-peer.js';
import { normalizePeerInvitation, peerInvitationLink } from '../shared/peer-invitation.js';
import { shareLink } from './share-link.js';

/** Quick invitations and manual exchange share the same game transport and authority. */
export class PeerPanel {
    readonly transport: P2pTransport;
    readonly role: 'host' | 'guest';
    private room: string | null = null;
    private finished = false;
    private busy = false;
    private status: P2pStatus['state'] = 'idle';
    private directFailed = false;
    private relayAttempt = false;
    private quick: AutomaticPeer | null = null;
    private quickExpiry: ReturnType<typeof setTimeout> | null = null;
    private readonly panel = document.getElementById('peer-panel') as HTMLDetailsElement;
    private readonly outgoing = document.getElementById('peer-outgoing') as HTMLTextAreaElement;
    private readonly incoming = document.getElementById('peer-incoming') as HTMLTextAreaElement;
    private readonly generate = document.getElementById('peer-generate') as HTMLButtonElement;
    private readonly connect = document.getElementById('peer-connect') as HTMLButtonElement;
    private readonly notice = document.getElementById('peer-status')!;
    private readonly relayPanel = document.getElementById('peer-relay') as HTMLDetailsElement;
    private readonly useRelay = document.getElementById('peer-use-relay') as HTMLInputElement;
    private readonly relayFields = document.getElementById('peer-relay-fields') as HTMLFieldSetElement;
    private readonly method = document.getElementById('peer-method') as HTMLSelectElement;
    private readonly quickOutgoing = document.getElementById('peer-quick-outgoing') as HTMLInputElement;
    private readonly quickIncoming = document.getElementById('peer-quick-incoming') as HTMLInputElement;
    private readonly quickCreate = document.getElementById('peer-quick-create') as HTMLButtonElement;
    private readonly quickJoin = document.getElementById('peer-quick-join') as HTMLButtonElement;

    constructor(role: 'host' | 'guest') {
        this.role = role;
        this.transport = new P2pTransport(role);
        this.panel.classList.remove('hidden');
        this.panel.open = true;
        if (role === 'host') document.getElementById('peer-steps')!.prepend(document.getElementById('peer-outgoing-section')!);
        document.getElementById('peer-title')!.textContent = role === 'host' ? 'Host an Internet game' : 'Join an Internet game';
        document.getElementById('peer-incoming-label')!.textContent = role === 'host' ? '2. Paste your friend’s reply' : '1. Paste your friend’s invitation';
        document.getElementById('peer-outgoing-label')!.textContent = role === 'host' ? '1. Send this invitation to your friend' : '2. Send this reply to your friend';
        document.getElementById('peer-quick-host')!.classList.toggle('hidden', role !== 'host');
        document.getElementById('peer-quick-guest')!.classList.toggle('hidden', role !== 'guest');
        this.generate.textContent = role === 'host' ? 'Create invitation code' : 'Create reply code';
        this.connect.classList.toggle('hidden', role !== 'host');
        this.transport.onStatus(status => {
            this.status = status.state;
            this.notice.textContent = status.message;
            if (status.state === 'connected') {
                this.clearQuickDeadline();
                this.panel.open = false;
            }
            if (['error', 'disconnected'].includes(status.state)) {
                if (!this.relayAttempt) this.directFailed = true;
                this.panel.open = true;
                this.outgoing.value = '';
                this.quickOutgoing.value = '';
                this.relayPanel.open = true;
                if (status.state === 'error') this.stopQuick();
            }
            this.refresh();
        });
        this.generate.addEventListener('click', () => { void this.run(async () => {
            const relay = this.relaySettings();
            const code = role === 'host'
                ? await this.transport.createOffer(this.room!, relay)
                : await this.transport.acceptOffer(this.incoming.value, relay);
            this.outgoing.value = code;
            if (role === 'host') this.incoming.value = '';
            this.outgoing.focus();
            this.outgoing.select();
        }); });
        this.connect.addEventListener('click', () => { void this.run(() => this.transport.acceptAnswer(this.incoming.value)); });
        this.quickCreate.addEventListener('click', () => { void this.run(() => this.createInvitation()); });
        this.quickJoin.addEventListener('click', () => { void this.run(async () => {
            parseAutomaticInvitation(this.quickIncoming.value);
            const relay = this.relaySettings();
            const quick = this.startQuick();
            await quick.join(this.quickIncoming.value, relay);
        }); });
        document.getElementById('peer-copy')!.addEventListener('click', () => { void this.copyCode(this.outgoing); });
        document.getElementById('peer-quick-copy')!.addEventListener('click', () => { void this.copyCode(this.quickOutgoing); });
        document.getElementById('peer-quick-share')!.addEventListener('click', () => { void this.shareInvitation(); });
        this.incoming.addEventListener('input', () => this.refresh());
        this.quickIncoming.addEventListener('input', () => this.refresh());
        this.useRelay.addEventListener('change', () => this.refresh());
        this.method.addEventListener('change', () => {
            this.stopQuick();
            this.transport.close();
            this.outgoing.value = this.incoming.value = this.quickOutgoing.value = '';
            this.notice.textContent = 'Ready to connect to a friend.';
            this.refresh();
        });
        window.addEventListener('pagehide', () => { this.stopQuick(); this.transport.close(); });
        this.refresh();
    }

    async joinInvitation(value: string): Promise<void> {
        const code = normalizePeerInvitation(value);
        if (this.role !== 'guest' || this.busy) return;
        this.quickIncoming.value = peerInvitationLink(code);
        this.refresh();
        if (parseAutomaticInvitation(code).relay) {
            this.relayPanel.open = true;
            this.notice.textContent = 'This invitation uses a relay. Enter your TURN credentials, then press Join.';
            return;
        }
        this.quickJoin.click();
    }

    private async shareInvitation(): Promise<void> {
        if (!this.quickOutgoing.value) await this.run(() => this.createInvitation());
        if (!this.quickOutgoing.value) return;
        try {
            const result = await shareLink(this.quickOutgoing.value);
            if (result !== 'cancelled') this.notice.textContent = result === 'copied'
                ? 'Link copied. Send it to your friend to open in Kamisado.' : 'Return to Kamisado and keep it open while your friend joins.';
        } catch { await this.copyCode(this.quickOutgoing); }
    }

    private async createInvitation(): Promise<void> {
        const relay = this.relaySettings();
        const quick = this.startQuick();
        const invitation = await quick.createInvite(relay);
        if (this.quick !== quick) return;
        this.quickOutgoing.value = peerInvitationLink(invitation);
        this.status = 'waiting-answer';
        this.quickExpiry = setTimeout(() => this.quickError('This invitation expired. Create a new invitation.'), 600000);
        this.notice.textContent = 'Share the link with your friend. Opening it in Kamisado joins this game.';
    }

    private relaySettings(): RTCIceServer | undefined {
        const relay = this.useRelay.checked ? parseRelaySettings(
            (document.getElementById('peer-relay-urls') as HTMLTextAreaElement).value,
            (document.getElementById('peer-relay-username') as HTMLInputElement).value,
            (document.getElementById('peer-relay-password') as HTMLInputElement).value,
        ) : undefined;
        this.relayAttempt = !!relay;
        return relay;
    }

    private startQuick(): AutomaticPeer {
        this.stopQuick();
        this.transport.close();
        this.quickOutgoing.value = '';
        this.status = 'gathering';
        const quick = new AutomaticPeer(this.role, {
            server: window.__KAMISADO_SIGNALING__,
            onConnection: (peer, channel) => {
                if (this.quick !== quick) { channel.close(); return; }
                this.transport.acceptChannel(peer, channel, this.room ?? undefined);
            },
            onStatus: message => { if (this.quick === quick) this.notice.textContent = message; },
            onAttemptFailed: () => {
                if (this.quick !== quick) return;
                if (!this.relayAttempt) this.directFailed = true;
                this.relayPanel.open = true;
                this.refresh();
            },
            onError: error => { if (this.quick === quick) this.quickError(error.message); },
        });
        this.quick = quick;
        return quick;
    }

    private quickError(message: string): void {
        this.stopQuick();
        this.transport.close();
        this.status = 'error';
        if (!this.relayAttempt) this.directFailed = true;
        this.quickOutgoing.value = '';
        this.panel.open = true;
        this.relayPanel.open = true;
        this.notice.textContent = message;
        this.refresh();
    }

    private clearQuickDeadline(): void {
        if (this.quickExpiry) clearTimeout(this.quickExpiry);
        this.quickExpiry = null;
    }

    private stopQuick(): void {
        this.clearQuickDeadline();
        const quick = this.quick;
        this.quick = null;
        quick?.close();
    }

    updateGame(id: string | null, finished = false): void {
        if (this.role === 'host' && id !== this.room) {
            this.directFailed = false;
            this.useRelay.checked = false;
        }
        if (this.room && id !== this.room && (!id || this.transport.gameId !== id)) {
            this.stopQuick();
            this.transport.close();
            this.outgoing.value = this.incoming.value = this.quickOutgoing.value = '';
            this.panel.open = true;
        }
        this.room = id;
        this.finished = finished;
        this.panel.classList.toggle('hidden', this.role === 'host' && !id);
        this.refresh();
    }

    private refresh(): void {
        const quick = this.method.value === 'quick';
        document.getElementById('peer-quick')!.classList.toggle('hidden', !quick);
        document.getElementById('peer-steps')!.classList.toggle('hidden', quick);
        document.getElementById('peer-instructions')!.textContent = quick
            ? this.role === 'host'
                ? this.room ? 'Create an invitation and send it to your friend. Keep the app open while they join.' : 'Choose your game options and create a game below. Then share one invitation.'
                : 'Paste your friend’s invitation and press Join. The apps handle the connection setup.'
            : this.role === 'host'
                ? this.room ? 'Create an invitation code, send it to your friend, then paste their reply to connect.' : 'Create a game below, then exchange an invitation code and a reply.'
                : 'Paste the invitation, create a reply code, and send it back. Keep this window open while your friend connects.';
        let relayInvitation = false;
        if (this.role === 'guest') {
            if (quick) {
                try { relayInvitation = parseAutomaticInvitation(this.quickIncoming.value).relay; } catch { /* Incomplete input. */ }
            } else relayInvitation = invitationUsesRelay(this.incoming.value);
        }
        const canUseRelay = this.directFailed || relayInvitation;
        if (!canUseRelay) this.useRelay.checked = false;
        this.useRelay.disabled = this.busy || this.status === 'connected' || !canUseRelay;
        this.relayFields.disabled = this.busy || this.status === 'connected' || !this.useRelay.checked;
        document.getElementById('peer-relay-help')!.textContent = relayInvitation
            ? 'Your friend is retrying with a relay. Enable TURN and enter your credentials before joining.'
            : 'Available after a failed connection, or when your friend sends a relay invitation.';
        this.generate.disabled = this.busy || this.status === 'connected' || this.finished ||
            (this.role === 'host' ? !this.room : !this.incoming.value.trim());
        this.connect.disabled = this.busy || this.status !== 'waiting-answer' || !this.incoming.value.trim();
        this.quickCreate.disabled = this.busy || this.status === 'connected' || this.finished || !this.room;
        this.quickJoin.disabled = this.busy || this.status === 'connected' || !this.quickIncoming.value.trim();
        this.method.disabled = this.busy || this.status === 'connected';
        (document.getElementById('peer-copy') as HTMLButtonElement).disabled = !this.outgoing.value || this.busy;
        (document.getElementById('peer-quick-copy') as HTMLButtonElement).disabled = !this.quickOutgoing.value || this.busy || this.status === 'connected';
        (document.getElementById('peer-quick-share') as HTMLButtonElement).disabled = !this.room || this.busy || this.finished || this.status === 'connected';
    }

    private async run(action: () => Promise<unknown>): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        this.refresh();
        try { await action(); }
        catch (error) { this.notice.textContent = error instanceof Error ? error.message : 'Could not connect. Try a new invitation.'; }
        finally { this.busy = false; this.refresh(); }
    }

    private async copyCode(field: HTMLInputElement | HTMLTextAreaElement): Promise<void> {
        try {
            if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
            await navigator.clipboard.writeText(field.value);
            this.notice.textContent = 'Invitation copied. Send it to your friend in your usual messaging app.';
        } catch {
            field.focus();
            field.select();
            this.notice.textContent = 'Invitation selected. Use your device’s copy command and send it to your friend.';
        }
    }
}
