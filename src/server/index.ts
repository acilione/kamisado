import express from 'express';
import http from 'http';
import { randomBytes } from 'crypto';
import { Server, type Socket } from 'socket.io';
import path from 'path';
import type { AddressInfo, Socket as TcpSocket } from 'net';

import { KamisadoGame } from './game.js';
import { AI_LEVELS, isAiLevel } from '../shared/ai-levels.js';
import { chooseFillDirection } from './ai/engine.js';
import { requestComputerMove, stopComputerWorkers, type ComputerTask } from './ai/runner.js';
import type {
    PlayerColor, GameState, PositionMode, MoveData,
  ServerToClientEvents, ClientToServerEvents,
} from '../shared/types.js';

const app = express();
let io: Server<ClientToServerEvents, ServerToClientEvents> | undefined;
let startingServer: Promise<RunningServer> | null = null;
let activeServer: RunningServer | null = null;
let stoppingServer = false;

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

// ─── Session types ─────────────────────────────────────────────────

interface DisconnectEntry {
    timeout: ReturnType<typeof setTimeout>;
    startTime: number;
}

interface GameSession {
    computer?: {
        color: PlayerColor;
        level: number;
        ownerId: string;
        generation: number;
        thinking: boolean;
        task?: ComputerTask;
    };
    gameInstance: KamisadoGame;
    players: Record<string, string | null>;   // color → playerId
    sockets: Record<string, string>;          // playerId → socketId
    disconnects: Map<string, DisconnectEntry>;
    spectators: Set<string>;
    roundTimer: ReturnType<typeof setTimeout> | null;
    turnTimer?: ReturnType<typeof setTimeout>;
    lobbyTimeout?: ReturnType<typeof setTimeout>;
    cleanupTimeout?: ReturnType<typeof setTimeout>;
    roundTimerEndTime?: number;
}

interface PlayerSession {
    gameId: string;
    color?: PlayerColor;
    isSpectator?: boolean;
}

// ─── State ─────────────────────────────────────────────────────────

const games = new Map<string, GameSession>();
const playerSessions = new Map<string, PlayerSession>();
const PLAYER_COLORS: readonly PlayerColor[] = ['black', 'white'];
const VALID_MATCH_TYPES = new Set(['1', '3', '7', '15']);
const VALID_TIMERS = new Set(['0', '60', '180', '300', '600', '1800']);
const VALID_COLOR_MODES = new Set(['black', 'white', 'random']);
const VALID_POSITION_MODES = new Set<PositionMode>(['standard', 'fill', 'random']);
const DISCONNECT_GRACE_MS = 60_000;
const FINISHED_GAME_RETENTION_MS = 5 * 60_000;

function sessionState(session: GameSession): GameState {
    const state = session.gameInstance.toJson();
    if (session.computer) {
        const { color, level, thinking } = session.computer;
        state.computer = { color, level, thinking };
    }
    return state;
}

function cancelComputer(session: GameSession): void {
    if (!session.computer) return;
    session.computer.generation++;
    session.computer.task?.cancel();
    session.computer.task = undefined;
    session.computer.thinking = false;
}

function hasActiveGame(playerId: string): boolean {
    const s = playerSessions.get(playerId);
    if (!s) return false;
    const g = games.get(s.gameId);
    return !!g && !g.gameInstance.finished;
}

function isValidPlayerId(playerId: unknown): playerId is string {
    return typeof playerId === 'string' && playerId.length > 0 && playerId.length <= 128;
}

function getSocketPlayer(session: GameSession, socketId: string): { playerId: string; color: PlayerColor } | null {
    for (const color of PLAYER_COLORS) {
        const playerId = session.players[color];
        if (playerId && session.sockets[playerId] === socketId) {
            return { playerId, color };
        }
    }
    return null;
}

function removeSessionsForGame(gameId: string): void {
    for (const [playerId, session] of playerSessions.entries()) {
        if (session.gameId === gameId) playerSessions.delete(playerId);
    }
}

function clearSessionTimers(session: GameSession): void {
    cancelComputer(session);
    if (session.turnTimer) clearTimeout(session.turnTimer);
    if (session.roundTimer) clearTimeout(session.roundTimer);
    if (session.lobbyTimeout) clearTimeout(session.lobbyTimeout);
    session.turnTimer = undefined;
    session.roundTimer = null;
    session.lobbyTimeout = undefined;
    session.roundTimerEndTime = undefined;

    for (const entry of session.disconnects.values()) clearTimeout(entry.timeout);
    session.disconnects.clear();
}

function finishSession(
    gameId: string,
    session: GameSession,
    reason: string,
    winner: PlayerColor | 'DRAW',
    broadcastState = true,
): void {
    if (session.cleanupTimeout) return;

    const game = session.gameInstance;
    game.finished = true;
    game.winner = winner;
    clearSessionTimers(session);

    if (broadcastState) io!.to(gameId).emit('gameStateUpdate', sessionState(session));
    io!.to(gameId).emit('gameEnded', { reason, winner });
    removeSessionsForGame(gameId);

    session.cleanupTimeout = setTimeout(() => {
        games.delete(gameId);
    }, FINISHED_GAME_RETENTION_MS);
}

function getOpponentDisconnectInfo(session: GameSession, playerId: string): {
    opponentDisconnected: boolean;
    timeoutSeconds: number;
} {
    for (const [disconnectedId, entry] of session.disconnects.entries()) {
        if (disconnectedId !== playerId) {
            const remainingMs = DISCONNECT_GRACE_MS - (Date.now() - entry.startTime);
            return {
                opponentDisconnected: true,
                timeoutSeconds: Math.max(0, Math.ceil(remainingMs / 1000)),
            };
        }
    }
    return { opponentDisconnected: false, timeoutSeconds: 0 };
}

function replaceSocket(gameId: string, session: GameSession, playerId: string, newSocketId: string): void {
    const oldSocketId = session.sockets[playerId];
    if (oldSocketId && oldSocketId !== newSocketId) {
        io!.to(oldSocketId).emit('sessionTakenOver');
        io!.sockets.sockets.get(oldSocketId)?.leave(gameId);
    }
    session.sockets[playerId] = newSocketId;
}

function restoreConnectedPlayer(gameId: string, session: GameSession, playerId: string, color: PlayerColor): void {
    const entry = session.disconnects.get(playerId);
    if (!entry) return;

    clearTimeout(entry.timeout);
    session.disconnects.delete(playerId);
    io!.to(gameId).emit('playerReconnected', { color, playerId });

    if (session.disconnects.size === 0) {
        session.gameInstance.resumeTimer();
        startTurnTimer(gameId, session);
        advanceComputer(gameId, session);
        io!.to(gameId).emit('gameStateUpdate', sessionState(session));
    }
}

function beginDisconnectCountdown(gameId: string, session: GameSession, playerId: string): void {
    if (session.gameInstance.finished || session.disconnects.has(playerId)) return;
    cancelComputer(session);

    const timerResult = session.gameInstance.pauseTimer();
    if (session.turnTimer) {
        clearTimeout(session.turnTimer);
        session.turnTimer = undefined;
    }
    if (timerResult?.timeout && timerResult.player) {
        handleGameTimeout(gameId, session, timerResult.player);
        return;
    }

    io!.to(gameId).emit('gameStateUpdate', sessionState(session));

    io!.to(gameId).emit('playerDisconnected', {
        playerId,
        timeoutSeconds: DISCONNECT_GRACE_MS / 1000,
    });

    const disconnectEntry: DisconnectEntry = {
        startTime: Date.now(),
        timeout: setTimeout(() => {
            if (session.gameInstance.finished || !session.disconnects.has(playerId)) return;
            const winner: PlayerColor = session.players.black === playerId ? 'white' : 'black';
            finishSession(gameId, session, 'disconnection_timeout', winner);
        }, DISCONNECT_GRACE_MS),
    };

    session.disconnects.set(playerId, disconnectEntry);
}

// ─── Socket.IO ─────────────────────────────────────────────────────

function onConnection(socket: Socket<ClientToServerEvents, ServerToClientEvents>): void {
    if (stoppingServer) {
        socket.disconnect(true);
        return;
    }
    socket.emit('runtimeConfig', { publicOrigin });
    // Check Active Session
    socket.on('checkActiveSession', (data, callback) => {
        if (typeof callback !== 'function') return;
        const playerId = data?.playerId;
        if (!isValidPlayerId(playerId)) return callback({ active: false });

        const pSession = playerSessions.get(playerId);
        if (pSession) {
            const gameSession = games.get(pSession.gameId);
            if (gameSession && !gameSession.gameInstance.finished) {
                const isSpectator = pSession.isSpectator === true;

                replaceSocket(pSession.gameId, gameSession, playerId, socket.id);
                socket.join(pSession.gameId);

                if (!isSpectator && pSession.color) {
                    restoreConnectedPlayer(pSession.gameId, gameSession, playerId, pSession.color);
                }

                if (gameSession.disconnects.size === 0) {
                    const timerUpdate = gameSession.gameInstance.updateTimer();
                    if (timerUpdate?.timeout && timerUpdate.player) {
                        handleGameTimeout(pSession.gameId, gameSession, timerUpdate.player);
                        return callback({ active: false });
                    }
                }

                if (isSpectator) {
                    return callback({
                        active: true,
                        success: true,
                        gameId: pSession.gameId,
                        isSpectator: true,
                        gameState: sessionState(gameSession),
                    });
                }

                const disconnectInfo = getOpponentDisconnectInfo(gameSession, playerId);

                return callback({
                    active: true,
                    success: true,
                    gameId: pSession.gameId,
                    color: pSession.color,
                    gameState: sessionState(gameSession),
                    ...disconnectInfo,
                    roundTimerEndTime: gameSession.roundTimerEndTime || null,
                });
            } else {
                playerSessions.delete(playerId);
            }
        }
        callback({ active: false });
    });

    // Create Game
    socket.on('createGame', (data, callback) => {
        if (typeof callback !== 'function') return;
        if (!data || !isValidPlayerId(data.playerId)) {
            return callback({ success: false, message: 'Invalid player ID' });
        }

        const { matchType, timer, colorMode, playerId } = data;
        const opponent = data.opponent ?? 'human';
        if (!['human', 'computer'].includes(opponent) ||
            (data.aiLevel !== undefined && !isAiLevel(data.aiLevel)) ||
            (opponent === 'computer' && !isAiLevel(data.aiLevel))) {
            return callback({ success: false, message: 'Choose a computer difficulty from 1 to 10' });
        }
        const positionMode = (data.positionMode || 'standard') as PositionMode;
        if (!VALID_MATCH_TYPES.has(matchType) || !VALID_TIMERS.has(timer) ||
            !VALID_COLOR_MODES.has(colorMode) || !VALID_POSITION_MODES.has(positionMode)) {
            return callback({ success: false, message: 'Invalid game settings' });
        }

        if (hasActiveGame(playerId)) {
            return callback({ success: false, message: 'You already have an active game. Refresh to rejoin.' });
        }

        let gameId: string;
        do {
            gameId = randomBytes(6).toString('hex');
        } while (games.has(gameId));
        const game = new KamisadoGame(gameId, { matchType, timer, colorMode, positionMode });

        const session: GameSession = {
            gameInstance: game,
            players: { black: null, white: null },
            sockets: {},
            disconnects: new Map(),
            spectators: new Set(),
            roundTimer: null,
        };
        games.set(gameId, session);

        let assignedColor: PlayerColor = 'black';
        if (colorMode === 'white') assignedColor = 'white';
        if (colorMode === 'random') assignedColor = Math.random() < 0.5 ? 'black' : 'white';

        session.players[assignedColor] = playerId;
        session.sockets[playerId] = socket.id;

        playerSessions.set(playerId, { gameId, color: assignedColor });

        if (opponent === 'computer') {
            session.computer = {
                color: assignedColor === 'black' ? 'white' : 'black',
                level: data.aiLevel!, ownerId: playerId, generation: 0, thinking: false,
            };
            socket.join(gameId);
            game.startGame();
            startTurnTimer(gameId, session);
            advanceComputer(gameId, session);
            callback({ success: true, gameId, color: assignedColor, gameState: sessionState(session) });
            return;
        }

        // Background Cleanup Timeout (10 minutes)
        session.lobbyTimeout = setTimeout(() => {
            const s = games.get(gameId);
            if (s && s.gameInstance.roundState === 'waiting_start') {
                console.log(`Lobby ${gameId} expired (abandoned).`);
                io!.to(gameId).emit('lobbyExpired');
                Object.keys(s.players).forEach(c => {
                    const pid = s.players[c];
                    if (pid) playerSessions.delete(pid);
                });
                games.delete(gameId);
            }
        }, 600000);

        socket.join(gameId);

        callback({ success: true, gameId, color: assignedColor, gameState: sessionState(session) });
    });

    socket.on('leaveComputerGame', (data, callback) => {
        if (typeof callback !== 'function') return;
        const session = typeof data?.gameId === 'string' ? games.get(data.gameId) : undefined;
        if (!session?.computer || getSocketPlayer(session, socket.id)?.playerId !== session.computer.ownerId) {
            return callback({ success: false, message: 'Only the player can leave this computer game' });
        }
        clearSessionTimers(session);
        if (session.cleanupTimeout) clearTimeout(session.cleanupTimeout);
        removeSessionsForGame(data.gameId);
        games.delete(data.gameId);
        socket.leave(data.gameId);
        callback({ success: true });
    });

    // Cancel Game (Manual)
    socket.on('cancelGame', (data, callback) => {
        if (typeof callback !== 'function') return;
        if (!data || typeof data.gameId !== 'string') return callback({ success: false });
        const { gameId } = data;
        const session = games.get(gameId);
        if (!session) return callback({ success: false });

        if (!getSocketPlayer(session, socket.id)) return callback({ success: false });

        if (session.gameInstance.roundState !== 'waiting_start') {
            return callback({ success: false, message: 'Cannot cancel active game' });
        }

        console.log(`Game ${gameId} cancelled by player.`);
        io!.to(gameId).emit('lobbyExpired');

        if (session.lobbyTimeout) clearTimeout(session.lobbyTimeout);

        Object.keys(session.players).forEach(c => {
            const pid = session.players[c];
            if (pid) playerSessions.delete(pid);
        });
        games.delete(gameId);

        callback({ success: true });
    });

    // Join Game
    socket.on('joinGame', (data, callback) => {
        if (typeof callback !== 'function') return;
        if (!data || typeof data.gameId !== 'string' || !isValidPlayerId(data.playerId)) {
            return callback({ success: false, message: 'Invalid join request' });
        }
        const { gameId, playerId } = data;
        const session = games.get(gameId);
        if (!session) {
            return callback({ success: false, message: 'Game not found' });
        }
        if (session.gameInstance.finished) {
            return callback({ success: false, message: 'Game has ended' });
        }
        if (session.computer && playerId !== session.computer.ownerId) {
            return callback({ success: false, message: 'Single-player games are private' });
        }

        const existingSession = playerSessions.get(playerId);
        if (existingSession && existingSession.gameId === gameId) {
            replaceSocket(gameId, session, playerId, socket.id);
            socket.join(gameId);

            if (existingSession.color) {
                restoreConnectedPlayer(gameId, session, playerId, existingSession.color);
            }

            if (session.disconnects.size === 0) {
                const timerUpdate = session.gameInstance.updateTimer();
                if (timerUpdate?.timeout && timerUpdate.player) {
                    handleGameTimeout(gameId, session, timerUpdate.player);
                    return callback({ success: false, message: 'Game has ended' });
                }
            }

            const disconnectInfo = getOpponentDisconnectInfo(session, playerId);

            return callback({
                success: true,
                gameId,
                color: existingSession.color,
                gameState: sessionState(session),
                isSpectator: existingSession.isSpectator,
                ...disconnectInfo,
                roundTimerEndTime: session.roundTimerEndTime || null,
            });
        }

        if (hasActiveGame(playerId)) return callback({ success: false, message: 'Active game exists' });

        let assignedColor: PlayerColor | null = null;
        if (!session.players['black']) assignedColor = 'black';
        else if (!session.players['white']) assignedColor = 'white';

        if (!assignedColor) {
            // Game is full - join as spectator
            session.spectators.add(playerId);
            session.sockets[playerId] = socket.id;
            playerSessions.set(playerId, { gameId, isSpectator: true });
            socket.join(gameId);

            return callback({
                success: true,
                gameId,
                isSpectator: true,
                gameState: sessionState(session),
            });
        }

        // Clear Lobby Timeout
        if (session.lobbyTimeout) {
            clearTimeout(session.lobbyTimeout);
            session.lobbyTimeout = undefined;
        }

        session.players[assignedColor] = playerId;
        session.sockets[playerId] = socket.id;
        playerSessions.set(playerId, { gameId, color: assignedColor });

        socket.join(gameId);

        // Notify opponent
        io!.to(gameId).emit('playerJoined', { color: assignedColor });

        // Start Game if both present
        if (session.players['black'] && session.players['white']) {
            const game = session.gameInstance;
            if (game.roundState === 'waiting_start') {
                game.startGame();
                startTurnTimer(gameId, session);

                for (const color of PLAYER_COLORS) {
                    const id = session.players[color];
                    if (id && !session.sockets[id]) beginDisconnectCountdown(gameId, session, id);
                }
            }
            io!.to(gameId).emit('gameStateUpdate', sessionState(session));
        }

        callback({
            success: true,
            gameId,
            color: assignedColor,
            gameState: sessionState(session),
            ...getOpponentDisconnectInfo(session, playerId),
        });
    });

    // Move
    socket.on('makeMove', (data) => {
        if (!data || typeof data.gameId !== 'string' || !data.move) {
            socket.emit('error', { message: 'Invalid move request' });
            return;
        }
        const { gameId, move } = data;
        const session = games.get(gameId);
        if (!session) return;

        const game = session.gameInstance;

        const player = getSocketPlayer(session, socket.id);
        if (!player) {
            socket.emit('error', { message: 'Only active players can make moves' });
            return;
        }
        if (session.disconnects.size > 0) {
            socket.emit('error', { message: 'Wait for the disconnected player to rejoin' });
            return;
        }

        const timeUpdate = game.updateTimer();
        if (timeUpdate && timeUpdate.timeout) {
            handleGameTimeout(gameId, session, timeUpdate.player!);
            return;
        }

        try {
            game.makeMove(move.fromR, move.fromC, move.toR, move.toC, player.color);

            afterMove(gameId, session);

        } catch (e: any) {
            socket.emit('error', { message: e.message });
        }
    });

    // Confirm Next Round
    socket.on('confirmNextRound', (data) => {
        if (!data || typeof data.gameId !== 'string') return;
        const { gameId } = data;
        const session = games.get(gameId);
        if (!session) return;

        const player = getSocketPlayer(session, socket.id);
        if (!player) return;
        const game = session.gameInstance;

        const allConfirmed = game.confirmNextRound(player.color);
        io!.to(gameId).emit('gameStateUpdate', sessionState(session));

        if (allConfirmed) {
            if (session.roundTimer) {
                clearTimeout(session.roundTimer);
                session.roundTimer = null;
            }
            session.roundTimerEndTime = undefined;
            game.startNextRound();
            if (game.roundState === 'playing') {
                startTurnTimer(gameId, session);
            }
            advanceComputer(gameId, session);
            io!.to(gameId).emit('gameStateUpdate', sessionState(session));
        }
    });

    // Fill Choice (fill position mode)
    socket.on('fillChoice', (data) => {
        if (!data || typeof data.gameId !== 'string') return;
        const { gameId, direction } = data;
        const session = games.get(gameId);
        if (!session) return;

        const player = getSocketPlayer(session, socket.id);
        if (!player) return;
        const game = session.gameInstance;

        try {
            game.handleFillChoice(player.color, direction);
            startTurnTimer(gameId, session);
            advanceComputer(gameId, session);
            io!.to(gameId).emit('gameStateUpdate', sessionState(session));
        } catch (e: any) {
            socket.emit('error', { message: e.message });
        }
    });

    socket.on('disconnect', () => {
        for (const [gameId, session] of games.entries()) {
            const playerId = Object.keys(session.sockets).find(pid => session.sockets[pid] === socket.id);
            if (playerId) {
                delete session.sockets[playerId];
                if (session.gameInstance.finished) break;

                const isPlayer = PLAYER_COLORS.some(color => session.players[color] === playerId);
                if (!isPlayer) break;

                if (session.gameInstance.roundState === 'waiting_start') {
                    break;
                }

                beginDisconnectCountdown(gameId, session, playerId);
                break;
            }
        }
    });
}

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
    stoppingServer = false;
    const server = http.createServer(app);
    const connections = new Set<TcpSocket>();
    server.on('connection', connection => {
        connections.add(connection);
        connection.once('close', () => connections.delete(connection));
    });
    const socketServer = new Server<ClientToServerEvents, ServerToClientEvents>(server);
    io = socketServer;
    socketServer.on('connection', onConnection);
    try {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(options.port ?? environmentPort(), options.host, () => {
                server.off('error', reject);
                resolve();
            });
        });
    } catch (error) {
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
            stoppingServer = true;
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
            socketServer.emit('hostStopped');
            // Remove games before disconnecting clients so disconnect handlers cannot
            // start new grace timers while the host is shutting down.
            for (const session of games.values()) {
                clearSessionTimers(session);
                if (session.cleanupTimeout) clearTimeout(session.cleanupTimeout);
            }
            games.clear();
            const workersStopped = stopComputerWorkers();
            playerSessions.clear();
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

function startTurnTimer(gameId: string, session: GameSession): void {
    const game = session.gameInstance;
    if (!game.timerState.enabled || game.finished || game.roundState !== 'playing' ||
        game.timerState.lastTimestamp === null || session.disconnects.size > 0) return;

    if (session.turnTimer) clearTimeout(session.turnTimer);

    const remaining = game.timerState.remaining[game.turn];

    session.turnTimer = setTimeout(() => {
        const update = game.updateTimer();
        if (update && update.timeout) {
            handleGameTimeout(gameId, session, update.player!);
        }
    }, remaining);
}

function handleGameTimeout(gameId: string, session: GameSession, loserColor: PlayerColor): void {
    const winner: PlayerColor = loserColor === 'black' ? 'white' : 'black';
    finishSession(gameId, session, 'chess_timeout', winner);
}

function afterMove(gameId: string, session: GameSession): void {
    const game = session.gameInstance;
    if (session.turnTimer) clearTimeout(session.turnTimer);
    session.turnTimer = undefined;
    if (game.finished && game.winner) {
        finishSession(gameId, session, 'match_complete', game.winner);
        return;
    }

    advanceComputer(gameId, session);
    io!.to(gameId).emit('gameStateUpdate', sessionState(session));
    if (game.roundState === 'playing') {
        startTurnTimer(gameId, session);
    } else if (game.roundState === 'waiting_confirmation' && !session.roundTimer) {
        session.roundTimerEndTime = Date.now() + 30000;
        io!.to(gameId).emit('roundTimerStart', { endTime: session.roundTimerEndTime });
        session.roundTimer = setTimeout(() => {
            if (game.roundState !== 'waiting_confirmation') return;
            const blackConfirmed = game.confirmations.has('black');
            const whiteConfirmed = game.confirmations.has('white');
            let winner: PlayerColor | 'DRAW';
            if (blackConfirmed !== whiteConfirmed) {
                winner = blackConfirmed ? 'black' : 'white';
                finishSession(gameId, session, 'surrender_timeout', winner);
            } else {
                winner = game.scores.black === game.scores.white ? 'DRAW'
                    : game.scores.black > game.scores.white ? 'black' : 'white';
                finishSession(gameId, session, 'round_timeout', winner);
            }
        }, 30000);
    }
}

function firstLegalMove(game: KamisadoGame): MoveData | null {
    for (const piece of game.getPlayerPieces(game.turn)) {
        if (game.requiredColor && piece.color !== game.requiredColor) continue;
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (game.isValidMove(piece.r, piece.c, r, c, game.turn).valid) {
                    return { fromR: piece.r, fromC: piece.c, toR: r, toC: c };
                }
            }
        }
    }
    return null;
}

function advanceComputer(gameId: string, session: GameSession): void {
    const computer = session.computer;
    const game = session.gameInstance;
    if (!computer || stoppingServer || games.get(gameId) !== session || game.finished ||
        session.disconnects.size || !session.sockets[computer.ownerId]) return;

    if (game.roundState === 'waiting_confirmation') {
        game.confirmNextRound(computer.color);
        return;
    }
    if (game.roundState === 'waiting_fill_choice' && game.defender === computer.color) {
        game.handleFillChoice(computer.color, chooseFillDirection(game.toJson(), game.settings, computer.level));
        startTurnTimer(gameId, session);
    }
    if (game.roundState !== 'playing' || game.turn !== computer.color || computer.task) return;

    const timedOut = game.updateTimer();
    if (timedOut?.timeout && timedOut.player) {
        handleGameTimeout(gameId, session, timedOut.player);
        return;
    }
    const remaining = game.timerState.remaining[computer.color];
    const maxTimeMs = Math.max(1, Math.min(AI_LEVELS[computer.level - 1].maxTimeMs,
        game.timerState.enabled ? Math.max(1, remaining / 20) : Infinity));
    const generation = ++computer.generation;
    const round = game.round;
    computer.thinking = true;
    const task = requestComputerMove({
        state: game.toJson(), settings: game.settings, level: computer.level, maxTimeMs,
    });
    computer.task = task;
    io!.to(gameId).emit('gameStateUpdate', sessionState(session));

    void task.result.catch(error => {
        console.error(`Computer search failed in ${gameId}; using a legal fallback:`, error.message);
        return null;
    }).then(candidate => {
        if (computer.generation !== generation || computer.task !== task || stoppingServer ||
            games.get(gameId) !== session || game.finished || game.round !== round ||
            game.roundState !== 'playing' || game.turn !== computer.color || session.disconnects.size ||
            !session.sockets[computer.ownerId]) return;
        computer.task = undefined;
        computer.thinking = false;
        const timer = game.updateTimer();
        if (timer?.timeout && timer.player) {
            handleGameTimeout(gameId, session, timer.player);
            return;
        }
        // Worker output crosses a trust/lifecycle boundary. Validate against the
        // live authoritative board even though the search uses the same rules.
        const move = candidate && game.isValidMove(candidate.fromR, candidate.fromC,
            candidate.toR, candidate.toC, computer.color).valid ? candidate : firstLegalMove(game);
        if (!move) {
            console.error(`Computer has no legal move in active game ${gameId}`);
            return;
        }
        game.makeMove(move.fromR, move.fromC, move.toR, move.toC, computer.color);
        afterMove(gameId, session);
    }).catch(error => {
        console.error(`Unable to apply computer move in ${gameId}:`, error);
    });
}
