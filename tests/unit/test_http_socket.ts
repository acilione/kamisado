import assert from 'node:assert/strict';
import { connectHttpSocket } from '../../src/client/http-socket.js';

async function main(): Promise<void> {
    const original = globalThis.fetch;
    let generation = 0;
    let failSend = true;
    let deliver: ((frames: unknown[]) => void) | undefined;
    let queued: unknown[] = [];
    const closed: string[] = [];
    const requests: string[] = [];
    globalThis.fetch = async (input, options) => {
        const action = String(input).split('/').pop();
        const body = JSON.parse(String(options?.body));
        const response = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });
        if (action === 'connect') { queued = [{ kind: 'connected' }]; return response({ session: `session-${++generation}` }); }
        if (action === 'close') { closed.push(body.session); return response({}); }
        if (action === 'send') {
            requests.push(body.frame.event);
            if (failSend) { failSend = false; throw new Error('Connection lost during a move'); }
            const frames = [{ kind: 'ack', id: body.frame.id, data: { active: false } }];
            if (deliver) deliver(frames); else queued.push(...frames);
            return response({});
        }
        if (queued.length) { const frames = queued; queued = []; return response(frames); }
        return new Promise<Response>((resolve, reject) => {
            const abort = () => { deliver = undefined; reject(new Error('Aborted')); };
            options?.signal?.addEventListener('abort', abort, { once: true });
            deliver = frames => {
                deliver = undefined;
                options?.signal?.removeEventListener('abort', abort);
                resolve(response(frames));
            };
        });
    };
    const socket = connectHttpSocket();
    let connects = 0;
    let disconnects = 0;
    try {
        await new Promise<void>((resolve, reject) => {
            const deadline = setTimeout(() => reject(new Error('HTTP transport did not recover')), 6000);
            socket.on('disconnect', () => disconnects++);
            socket.on('connect', () => {
                connects++;
                socket.emit('checkActiveSession', { playerId: 'guest-test' }, response => {
                    if (response.active === false && connects === 2) { clearTimeout(deadline); resolve(); }
                });
            });
        });
        assert.equal(connects, 2, 'a failed send must restart polling, not strand a disconnected UI');
        assert.equal(disconnects, 1);
        assert.deepEqual(closed, ['session-1']);
        const before = requests.length;
        socket.emit('createGame', {} as never, () => {});
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(requests.length, before, 'guest transport cannot request host-only creation');
        console.log('HTTP guest transport passed: failed-send recovery, session cleanup, acknowledgements, host-only action filtering.');
    } finally {
        socket.disconnect();
        await new Promise(resolve => setTimeout(resolve, 0));
        globalThis.fetch = original;
    }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
