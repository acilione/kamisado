import type { ClientToServerEvents, ServerToClientEvents } from '../shared/types.js';
const MAX_PENDING_ACKS = 32;
export interface EventTransport {
    sendRequest(frame: { kind: string; event: string; data: unknown; id?: number }): boolean;
    close(): void;
}
type SocketEvents = ServerToClientEvents & {
    connect: () => void;
    disconnect: (reason: string) => void;
    connect_error: (error: Error) => void;
};
type Listener = (...args: any[]) => void;
type TimedArguments<F extends (...args: any[]) => void> = Parameters<F> extends [...infer P, (value: infer R) => void]
    ? [...P, (error: Error | null, value?: R) => void] : Parameters<F>;

/** The small Socket.IO-shaped surface used by the existing browser client. */
export class EventSocket {
    connected = false;
    private listeners = new Map<string, Set<Listener>>();
    private pending = new Map<number, { callback: Listener; timed: boolean; timer: ReturnType<typeof setTimeout> }>();
    private nextId = 0;

    constructor(private readonly transport: EventTransport, private readonly allowedEvents: ReadonlySet<string>) {}

    private anyListeners = new Set<(event: string, ...args: unknown[]) => void>();
    onAny(listener: (event: string, ...args: unknown[]) => void): this {
        this.anyListeners.add(listener);
        return this;
    }

    removeAllListeners(): this {
        this.listeners.clear();
        this.anyListeners.clear();
        return this;
    }

    on<E extends keyof SocketEvents>(event: E, listener: SocketEvents[E]): this {
        let listeners = this.listeners.get(event);
        if (!listeners) this.listeners.set(event, listeners = new Set());
        listeners.add(listener);
        return this;
    }

    off<E extends keyof SocketEvents>(event: E, listener?: SocketEvents[E]): this {
        if (listener) this.listeners.get(event)?.delete(listener);
        else this.listeners.delete(event);
        return this;
    }

    emit<E extends keyof ClientToServerEvents>(event: E, ...args: Parameters<ClientToServerEvents[E]>): this {
        this.request(event, args, false, 10000);
        return this;
    }

    timeout(milliseconds: number): { emit<E extends keyof ClientToServerEvents>(event: E, ...args: TimedArguments<ClientToServerEvents[E]>): EventSocket } {
        return { emit: (event, ...args) => {
            this.request(event, args, true, Math.min(30000, Math.max(1, milliseconds)));
            return this;
        } };
    }

    disconnect(): this { this.transport.close(); return this; }

    /** Transport internals; incoming peer messages never select arbitrary methods. */
    deliver(event: keyof SocketEvents, ...args: unknown[]): void {
        if (event !== 'connect' && event !== 'disconnect' && event !== 'connect_error') {
            for (const listener of this.anyListeners) listener(event, ...args);
        }
        for (const listener of [...(this.listeners.get(event) || [])]) listener(...args);
    }

    setConnected(value: boolean, reason = 'Peer connection closed'): void {
        if (this.connected === value) return;
        this.connected = value;
        this.deliver(value ? 'connect' : 'disconnect', ...(value ? [] : [reason]));
        // Notify the UI first so its connection generation invalidates pending
        // join/session callbacks before they receive a connection failure.
        if (!value) this.rejectPending(reason);
    }

    acknowledge(id: number, value: unknown): void {
        const pending = this.pending.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(id);
        if (pending.timed) pending.callback(null, value);
        else pending.callback(value);
    }

    rejectPending(reason: string): void {
        const pending = [...this.pending.values()];
        this.pending.clear();
        for (const entry of pending) {
            clearTimeout(entry.timer);
            if (entry.timed) entry.callback(new Error(reason));
            else entry.callback({ success: false, active: false, message: reason });
        }
    }

    private request(event: string, args: unknown[], timed: boolean, timeoutMs: number): void {
        const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] as Listener : undefined;
        if (!this.connected || !this.allowedEvents.has(event) || this.pending.size >= MAX_PENDING_ACKS) {
            const message = !this.connected ? 'Connect to your friend before playing.' : 'This action is unavailable in a peer game.';
            if (callback) queueMicrotask(() => timed ? callback(new Error(message)) : callback({ success: false, active: false, message }));
            else this.deliver('error', { message });
            return;
        }
        const id = callback ? ++this.nextId : undefined;
        if (id !== undefined && callback) {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                if (timed) callback(new Error('Your friend did not respond in time.'));
                else callback({ success: false, active: false, message: 'Your friend did not respond in time.' });
            }, timeoutMs);
            this.pending.set(id, { callback, timed, timer });
        }
        if (!this.transport.sendRequest({ kind: 'request', event, data: args[0], ...(id ? { id } : {}) }) && id) {
            this.acknowledge(id, { success: false, active: false, message: 'The peer connection is unavailable.' });
        }
    }
}
