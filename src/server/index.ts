import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import type { AddressInfo, Socket as TcpSocket } from 'net';

import { createSessionHost } from './sessions.js';
import { requestComputerMove, stopComputerWorkers } from './ai/runner.js';
import type { ServerToClientEvents, ClientToServerEvents } from '../shared/types.js';

const app = express();
let io: Server<ClientToServerEvents, ServerToClientEvents> | undefined;
let startingServer: Promise<RunningServer> | null = null;
let activeServer: RunningServer | null = null;

let publicOrigin: string | null = null;

export interface ServerStartOptions {
    port?: number;
    host?: string;
}

export interface RunningServer {
    port: number;
    close(): Promise<void>;
}

export function setPublicOrigin(origin: string | null): void {
    if (origin === null) {
        publicOrigin = null;
        io?.emit('runtimeConfig', { publicOrigin });
        return;
    }

    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
        throw new Error('Public origin must be an HTTP(S) URL without credentials');
    }
    publicOrigin = parsed.origin;
    io?.emit('runtimeConfig', { publicOrigin });
}

app.get('/runtime-config.js', (_req, res) => {
    const config = JSON.stringify({ publicOrigin }).replace(/</g, '\\u003c');
    res.setHeader('Cache-Control', 'no-store');
    res.type('application/javascript').send(`window.__KAMISADO_RUNTIME_CONFIG__ = ${config};`);
});

// Serve static files from public directory
const publicDir = path.resolve(__dirname, '../../public');
app.use(express.static(publicDir));

app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
});

// Direct game link route - serve the same index.html
app.get('/game/:gameId', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
});


function environmentPort(): number {
    const parsed = Number.parseInt(process.env.PORT || '3000', 10);
    return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535 ? parsed : 3000;
}

export async function startServer(options: ServerStartOptions = {}): Promise<RunningServer> {
    if (startingServer) return startingServer;
    if (activeServer) return activeServer;
    startingServer = listen(options);
    try {
        return await startingServer;
    } finally {
        startingServer = null;
    }
}

async function listen(options: ServerStartOptions): Promise<RunningServer> {
    const server = http.createServer(app);
    const connections = new Set<TcpSocket>();
    server.on('connection', connection => {
        connections.add(connection);
        connection.once('close', () => connections.delete(connection));
    });
    const socketServer = new Server<ClientToServerEvents, ServerToClientEvents>(server);
    io = socketServer;
    const sessions = createSessionHost(socketServer, { requestComputerMove, getPublicOrigin: () => publicOrigin });
    socketServer.on('connection', sessions.connect);
    try {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(options.port ?? environmentPort(), options.host, () => {
                server.off('error', reject);
                resolve();
            });
        });
    } catch (error) {
        sessions.close();
        // A failed bind must not leave an Engine.IO instance around before a retry.
        await new Promise<void>(resolve => socketServer.close(() => resolve()));
        io = undefined;
        throw error;
    }
    const address = server.address() as AddressInfo;
    let closing: Promise<void> | null = null;
    const running: RunningServer = {
        port: address.port,
        close: () => {
            if (closing) return closing;
            // Polling clients may be between requests. Wait for their outgoing
            // packet to drain, but never let an unreachable guest hold Stop open.
            const drained = Promise.all([...socketServer.sockets.sockets.values()].map(socket => {
                socket.removeAllListeners();
                return new Promise<void>(resolve => {
                    const connection = socket.conn;
                    const finish = () => {
                        clearTimeout(timeout);
                        connection.off('drain', finish);
                        connection.off('close', finish);
                        resolve();
                    };
                    const timeout = setTimeout(finish, 1000);
                    connection.once('drain', finish);
                    connection.once('close', finish);
                });
            }));
            sessions.close();
            const workersStopped = stopComputerWorkers();
            publicOrigin = null;
            closing = Promise.all([drained, workersStopped]).then(() => new Promise<void>((resolve, reject) => {
                // Browsers may preconnect without sending HTTP headers, or leave
                // an upgrade unfinished. Those sockets can hold HTTP close open
                // indefinitely, even after Socket.IO has disconnected its clients.
                // Give the shutdown notice time to arrive, then release leftovers.
                const deadline = setTimeout(() => {
                    for (const connection of connections) connection.destroy();
                }, 1000);
                const finish = (error?: Error) => {
                    clearTimeout(deadline);
                    activeServer = null;
                    io = undefined;
                    error ? reject(error) : resolve();
                };
                void socketServer.close(finish).catch(finish);
            }));
            return closing;
        },
    };
    activeServer = running;
    return running;
}

if (require.main === module) {
    startServer()
        .then(({ port }) => console.log(`Server running on port ${port}`))
        .catch(error => {
            console.error('Unable to start server:', error);
            process.exitCode = 1;
        });
}
