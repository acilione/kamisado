import express from 'express';
import http from 'http';
import { randomBytes } from 'crypto';
import { Server } from 'socket.io';
import path from 'path';

import { KamisadoGame } from './game.js';
import type {
  PlayerColor, GameState, PositionMode,
  ServerToClientEvents, ClientToServerEvents,
} from '../shared/types.js';

const app = express();
const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server);

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

    if (broadcastState) io.to(gameId).emit('gameStateUpdate', game.toJson());
    io.to(gameId).emit('gameEnded', { reason, winner });
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
        io.to(oldSocketId).emit('sessionTakenOver');
        io.sockets.sockets.get(oldSocketId)?.leave(gameId);
    }
    session.sockets[playerId] = newSocketId;
}

function restoreConnectedPlayer(gameId: string, session: GameSession, playerId: string, color: PlayerColor): void {
    const entry = session.disconnects.get(playerId);
    if (!entry) return;

    clearTimeout(entry.timeout);
    session.disconnects.delete(playerId);
    io.to(gameId).emit('playerReconnected', { color, playerId });

    if (session.disconnects.size === 0) {
        session.gameInstance.resumeTimer();
        startTurnTimer(gameId, session);
        io.to(gameId).emit('gameStateUpdate', session.gameInstance.toJson());
    }
}

function beginDisconnectCountdown(gameId: string, session: GameSession, playerId: string): void {
    if (session.gameInstance.finished || session.disconnects.has(playerId)) return;

    const timerResult = session.gameInstance.pauseTimer();
    if (session.turnTimer) {
        clearTimeout(session.turnTimer);
        session.turnTimer = undefined;
    }
    if (timerResult?.timeout && timerResult.player) {
        handleGameTimeout(gameId, session, timerResult.player);
        return;
    }

    io.to(gameId).emit('gameStateUpdate', session.gameInstance.toJson());

    io.to(gameId).emit('playerDisconnected', {
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

io.on('connection', (socket) => {
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
                        gameState: gameSession.gameInstance.toJson(),
                    });
                }

                const disconnectInfo = getOpponentDisconnectInfo(gameSession, playerId);

                return callback({
                    active: true,
                    success: true,
                    gameId: pSession.gameId,
                    color: pSession.color,
                    gameState: gameSession.gameInstance.toJson(),
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

        // Background Cleanup Timeout (10 minutes)
        session.lobbyTimeout = setTimeout(() => {
            const s = games.get(gameId);
            if (s && s.gameInstance.roundState === 'waiting_start') {
                console.log(`Lobby ${gameId} expired (abandoned).`);
                io.to(gameId).emit('lobbyExpired');
                Object.keys(s.players).forEach(c => {
                    const pid = s.players[c];
                    if (pid) playerSessions.delete(pid);
                });
                games.delete(gameId);
            }
        }, 600000);

        socket.join(gameId);

        callback({ success: true, gameId, color: assignedColor, gameState: game.toJson() });
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
        io.to(gameId).emit('lobbyExpired');

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
                gameState: session.gameInstance.toJson(),
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
                gameState: session.gameInstance.toJson(),
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
        io.to(gameId).emit('playerJoined', { color: assignedColor });

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
            io.to(gameId).emit('gameStateUpdate', game.toJson());
        }

        callback({
            success: true,
            gameId,
            color: assignedColor,
            gameState: session.gameInstance.toJson(),
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

        const timeUpdate = game.updateTimer();
        if (timeUpdate && timeUpdate.timeout) {
            handleGameTimeout(gameId, session, timeUpdate.player!);
            return;
        }

        try {
            game.makeMove(move.fromR, move.fromC, move.toR, move.toC, player.color);

            if (session.turnTimer) clearTimeout(session.turnTimer);

            const state = game.toJson();
            io.to(gameId).emit('gameStateUpdate', state);

            if (game.finished && game.winner) {
                finishSession(gameId, session, 'match_complete', game.winner, false);
            } else if (game.roundState === 'playing') {
                startTurnTimer(gameId, session);
            } else if (state.roundState === 'waiting_confirmation') {
                if (!session.roundTimer) {
                    console.log(`Round finished. Starting 30s timer for game ${gameId}`);
                    const roundTimerEndTime = Date.now() + 30000;
                    session.roundTimerEndTime = roundTimerEndTime;
                    io.to(gameId).emit('roundTimerStart', { endTime: roundTimerEndTime });
                    session.roundTimer = setTimeout(() => {
                        if (game.roundState === 'waiting_confirmation') {
                            console.log(`Round timeout for game ${gameId}`);
                            const blackConfirmed = game.confirmations.has('black');
                            const whiteConfirmed = game.confirmations.has('white');
                            let winner: PlayerColor | 'DRAW';
                            if (blackConfirmed && !whiteConfirmed) winner = 'black';
                            else if (whiteConfirmed && !blackConfirmed) winner = 'white';
                            else {
                                if (game.scores['black'] > game.scores['white']) winner = 'black';
                                else if (game.scores['white'] > game.scores['black']) winner = 'white';
                                else winner = 'DRAW';
                                finishSession(gameId, session, 'round_timeout', winner);
                                return;
                            }
                            finishSession(gameId, session, 'surrender_timeout', winner);
                        }
                        session.roundTimer = null;
                    }, 30000);
                }
            }

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
        io.to(gameId).emit('gameStateUpdate', game.toJson());

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
            io.to(gameId).emit('gameStateUpdate', game.toJson());
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
            io.to(gameId).emit('gameStateUpdate', game.toJson());
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
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

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
