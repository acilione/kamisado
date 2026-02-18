import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';

import { KamisadoGame } from './game.js';
import type {
  PlayerColor, GameState,
  ServerToClientEvents, ClientToServerEvents,
} from '../shared/types.js';

const app = express();
const server = http.createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server);

// Serve static files from public directory
const publicDir = path.join(process.cwd(), 'public');
app.use(express.static(publicDir));

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

function hasActiveGame(playerId: string): boolean {
    const s = playerSessions.get(playerId);
    if (!s) return false;
    const g = games.get(s.gameId);
    return !!g && !g.gameInstance.finished;
}

// ─── Socket.IO ─────────────────────────────────────────────────────

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Check Active Session
    socket.on('checkActiveSession', ({ playerId }, callback) => {
        const pSession = playerSessions.get(playerId);
        if (pSession) {
            const gameSession = games.get(pSession.gameId);
            if (gameSession && !gameSession.gameInstance.finished) {
                const isSpectator = pSession.isSpectator === true;

                const oldSocketId = gameSession.sockets[playerId];
                if (oldSocketId && oldSocketId !== socket.id) {
                    io.to(oldSocketId).emit('sessionTakenOver');
                }
                gameSession.sockets[playerId] = socket.id;
                socket.join(pSession.gameId);

                gameSession.gameInstance.updateTimer();

                if (isSpectator) {
                    return callback({
                        active: true,
                        success: true,
                        gameId: pSession.gameId,
                        isSpectator: true,
                        gameState: gameSession.gameInstance.toJson(),
                    });
                }

                if (gameSession.disconnects.has(playerId)) {
                    clearTimeout(gameSession.disconnects.get(playerId)!.timeout);
                    gameSession.disconnects.delete(playerId);
                    io.to(pSession.gameId).emit('playerReconnected', { color: pSession.color!, playerId });
                }

                let opponentDisconnected = false;
                let timeoutSeconds = 0;

                console.log(`[DEBUG] checkActiveSession for ${playerId}. Disconnects map size: ${gameSession.disconnects.size}`);
                console.log(`[DEBUG] Disconnects keys: ${Array.from(gameSession.disconnects.keys()).join(', ')}`);

                for (const [pid, entry] of gameSession.disconnects.entries()) {
                    console.log(`[DEBUG] Checking disconnected pid: ${pid} vs requester: ${playerId}`);
                    if (pid !== playerId) {
                        opponentDisconnected = true;
                        const elapsed = Math.floor((Date.now() - entry.startTime) / 1000);
                        timeoutSeconds = Math.max(0, 60 - elapsed);
                        console.log(`[DEBUG] Found opponent disconnected! Timeout: ${timeoutSeconds}`);
                        break;
                    }
                }
                console.log(`[DEBUG] Final opponentDisconnected: ${opponentDisconnected}`);

                return callback({
                    active: true,
                    success: true,
                    gameId: pSession.gameId,
                    color: pSession.color,
                    gameState: gameSession.gameInstance.toJson(),
                    opponentDisconnected,
                    timeoutSeconds,
                    roundTimerEndTime: gameSession.roundTimerEndTime || null,
                });
            } else {
                playerSessions.delete(playerId);
            }
        }
        callback({ active: false });
    });

    // Create Game
    socket.on('createGame', ({ matchType, timer, colorMode, positionMode, playerId }, callback) => {
        if (hasActiveGame(playerId)) {
            return callback({ success: false, message: 'You already have an active game. Refresh to rejoin.' });
        }

        const gameId = Math.random().toString(36).substring(7);
        const game = new KamisadoGame(gameId, { matchType, timer, colorMode, positionMode: positionMode as any });

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
    socket.on('cancelGame', ({ gameId }, callback) => {
        const session = games.get(gameId);
        if (!session) return callback({ success: false });

        const playerId = Object.keys(session.sockets).find(pid => session.sockets[pid] === socket.id);
        if (!playerId) return callback({ success: false });

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
    socket.on('joinGame', ({ gameId, playerId }, callback) => {
        const session = games.get(gameId);
        if (!session) {
            return callback({ success: false, message: 'Game not found' });
        }

        const existingSession = playerSessions.get(playerId);
        if (existingSession && existingSession.gameId === gameId) {
            const oldSocketId = session.sockets[playerId];
            if (oldSocketId && oldSocketId !== socket.id) {
                io.to(oldSocketId).emit('sessionTakenOver');
            }
            session.sockets[playerId] = socket.id;
            socket.join(gameId);

            session.gameInstance.updateTimer();
            if (session.disconnects.has(playerId)) {
                clearTimeout(session.disconnects.get(playerId)!.timeout);
                session.disconnects.delete(playerId);
                io.to(gameId).emit('playerReconnected', { color: existingSession.color!, playerId });
            }

            let opponentDisconnected = false;
            let timeoutSeconds = 0;
            for (const [pid, entry] of session.disconnects.entries()) {
                if (pid !== playerId) {
                    opponentDisconnected = true;
                    const elapsed = Math.floor((Date.now() - entry.startTime) / 1000);
                    timeoutSeconds = Math.max(0, 60 - elapsed);
                    break;
                }
            }

            return callback({
                success: true,
                gameId,
                color: existingSession.color,
                gameState: session.gameInstance.toJson(),
                opponentDisconnected,
                timeoutSeconds,
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
            }
            io.to(gameId).emit('gameStateUpdate', game.toJson());
        }

        callback({ success: true, gameId, color: assignedColor, gameState: session.gameInstance.toJson() });
    });

    // Move
    socket.on('makeMove', ({ gameId, move }) => {
        const session = games.get(gameId);
        if (!session) return;

        const game = session.gameInstance;

        const timeUpdate = game.updateTimer();
        if (timeUpdate && timeUpdate.timeout) {
            handleGameTimeout(gameId, session, timeUpdate.player!);
            return;
        }

        const playerId = Object.keys(session.sockets).find(pid => session.sockets[pid] === socket.id);
        if (!playerId) return;

        const playerColor: PlayerColor = session.players['black'] === playerId ? 'black' : 'white';

        try {
            game.makeMove(move.fromR, move.fromC, move.toR, move.toC, playerColor);

            if (session.turnTimer) clearTimeout(session.turnTimer);

            const state = game.toJson();
            io.to(gameId).emit('gameStateUpdate', state);

            if (game.roundState === 'playing') {
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
                                game.finished = true;
                                game.winner = winner;
                                io.to(gameId).emit('gameEnded', { reason: 'round_timeout', winner: game.winner });
                                playerSessions.forEach((_v, k) => { const v = playerSessions.get(k); if (v && v.gameId === gameId) playerSessions.delete(k); });
                                session.roundTimer = null;
                                return;
                            }
                            game.finished = true;
                            game.winner = winner;
                            io.to(gameId).emit('gameEnded', { reason: 'surrender_timeout', winner: game.winner });
                            playerSessions.forEach((_v, k) => { const v = playerSessions.get(k); if (v && v.gameId === gameId) playerSessions.delete(k); });
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
    socket.on('confirmNextRound', ({ gameId }) => {
        const session = games.get(gameId);
        if (!session) return;

        const playerId = Object.keys(session.sockets).find(pid => session.sockets[pid] === socket.id);
        if (!playerId) return;

        const playerColor: PlayerColor = session.players['black'] === playerId ? 'black' : 'white';
        const game = session.gameInstance;

        const allConfirmed = game.confirmNextRound(playerColor);
        io.to(gameId).emit('gameStateUpdate', game.toJson());

        if (allConfirmed) {
            if (session.roundTimer) {
                clearTimeout(session.roundTimer);
                session.roundTimer = null;
            }
            game.startNextRound();
            if (game.roundState === 'playing') {
                startTurnTimer(gameId, session);
            }
            io.to(gameId).emit('gameStateUpdate', game.toJson());
        }
    });

    // Fill Choice (fill position mode)
    socket.on('fillChoice', ({ gameId, direction }) => {
        const session = games.get(gameId);
        if (!session) return;

        const playerId = Object.keys(session.sockets).find(pid => session.sockets[pid] === socket.id);
        if (!playerId) return;

        const playerColor: PlayerColor = session.players['black'] === playerId ? 'black' : 'white';
        const game = session.gameInstance;

        try {
            game.handleFillChoice(playerColor, direction);
            startTurnTimer(gameId, session);
            io.to(gameId).emit('gameStateUpdate', game.toJson());
        } catch (e: any) {
            socket.emit('error', { message: e.message });
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        for (const [gameId, session] of games.entries()) {
            const playerId = Object.keys(session.sockets).find(pid => session.sockets[pid] === socket.id);
            if (playerId) {
                if (session.gameInstance.finished) return;

                if (session.gameInstance.roundState === 'waiting_start') {
                    console.log(`Player ${playerId} disconnected from lobby ${gameId}. Lobby timeout still active.`);
                    return;
                }

                console.log(`Player ${playerId} disconnected. Starting countdown.`);

                io.to(gameId).emit('playerDisconnected', {
                    playerId,
                    timeoutSeconds: 60,
                });

                const disconnectEntry: DisconnectEntry = {
                    startTime: Date.now(),
                    timeout: setTimeout(() => {
                        if (session.gameInstance.finished) return;
                        console.log(`Game ${gameId} timeout for player ${playerId}.`);
                        session.gameInstance.finished = true;

                        const winner: PlayerColor = session.players['black'] === playerId ? 'white' : 'black';
                        session.gameInstance.winner = winner;

                        io.to(gameId).emit('gameEnded', { reason: 'disconnection_timeout', winner });

                        for (const entry of session.disconnects.values()) {
                            clearTimeout(entry.timeout);
                        }
                        session.disconnects.clear();

                        playerSessions.forEach((_v, k) => { const v = playerSessions.get(k); if (v && v.gameId === gameId) playerSessions.delete(k); });
                    }, 60000),
                };

                session.disconnects.set(playerId, disconnectEntry);
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
    if (!game.timerState.enabled) return;

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
    const game = session.gameInstance;
    game.finished = true;
    game.winner = loserColor === 'black' ? 'white' : 'black';

    io.to(gameId).emit('gameEnded', { reason: 'chess_timeout', winner: game.winner });
    io.to(gameId).emit('gameStateUpdate', game.toJson());

    const pIds = Object.keys(session.players).map(k => session.players[k]);
    pIds.forEach(pid => {
        if (pid) playerSessions.delete(pid);
    });
}
