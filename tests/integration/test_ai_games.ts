import assert from 'assert/strict';
import { io, type Socket } from 'socket.io-client';
import { KamisadoGame } from '../../src/server/game.js';
import type { ClientToServerEvents, CreateGameData, CreateGameResponse, GameState, MoveData, ServerToClientEvents } from '../../src/shared/types.js';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const url = process.env.TEST_SERVER_URL || 'http://127.0.0.1:3000';
const sockets: GameSocket[] = [];
let serial = 0;

async function connect(): Promise<GameSocket> {
    const socket: GameSocket = io(url, { autoConnect: false, reconnection: false, transports: ['websocket'] });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
        socket.connect();
    });
    return socket;
}

function nextState(socket: GameSocket, predicate: (state: GameState) => boolean, timeout = 7000): Promise<GameState> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.off('gameStateUpdate', listener);
            reject(new Error('Timed out waiting for computer state'));
        }, timeout);
        const listener = (state: GameState) => {
            if (!predicate(state)) return;
            clearTimeout(timer);
            socket.off('gameStateUpdate', listener);
            resolve(state);
        };
        socket.on('gameStateUpdate', listener);
    });
}

function position(state: GameState): KamisadoGame {
    const game = new KamisadoGame(state.id, {});
    game.board = structuredClone(state.board);
    game.turn = state.turn;
    game.requiredColor = state.requiredColor;
    game.roundState = state.roundState;
    return game;
}

function legalMoves(state: GameState): MoveData[] {
    const game = position(state);
    const moves: MoveData[] = [];
    for (const piece of game.getPlayerPieces(state.turn)) {
        for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
            if (game.isValidMove(piece.r, piece.c, r, c, state.turn).valid) {
                moves.push({ fromR: piece.r, fromC: piece.c, toR: r, toC: c });
            }
        }
    }
    return moves;
}

function create(socket: GameSocket, overrides: Partial<CreateGameData> = {}): Promise<CreateGameResponse> {
    return socket.timeout(4000).emitWithAck('createGame', {
        playerId: `ai-integration-${process.pid}-${++serial}`, opponent: 'computer', aiLevel: 1,
        matchType: '1', timer: '0', colorMode: 'black', positionMode: 'standard', ...overrides,
    });
}

async function main(): Promise<void> {
    const player = await connect();
    const stranger = await connect();
    for (const aiLevel of [0, 11, 1.5, '3', null, undefined]) {
        assert.equal((await create(player, { aiLevel: aiLevel as number })).success, false, `Reject level ${aiLevel}`);
    }
    assert.equal((await create(player, { opponent: 'robot' as 'computer' })).success, false);

    for (const aiLevel of [1, 10]) {
        for (const colorMode of ['black', 'white']) {
            const aiMoved = nextState(player, state => state.roundState === 'playing' &&
                state.turn === colorMode && !state.computer?.thinking && state.requiredColor !== null);
            const response = await create(player, { aiLevel, colorMode, timer: '60' });
            assert.equal(response.success, true);
            const initial = response.gameState!;
            assert.equal(initial.roundState, 'playing');
            assert.equal(initial.computer?.level, aiLevel);
            assert.equal(initial.computer?.color, colorMode === 'black' ? 'white' : 'black');
            assert.equal((await stranger.emitWithAck('joinGame', {
                gameId: response.gameId!, playerId: `intruder-${serial}`,
            })).success, false, 'Another identity cannot take the computer seat or spectate a private game');
            assert.equal((await stranger.emitWithAck('leaveComputerGame', { gameId: response.gameId! })).success, false);
            let beforeComputer = initial;
            if (colorMode === 'black') {
                const move = legalMoves(initial)[0];
                const expected = position(initial);
                expected.makeMove(move.fromR, move.fromC, move.toR, move.toC, 'black');
                beforeComputer = expected.toJson();
                player.emit('makeMove', { gameId: response.gameId!, move });
            }
            const started = Date.now();
            const health = await fetch(`${url}/health`);
            assert.equal(health.status, 200);
            assert(Date.now() - started < 1500, 'Search must not block the HTTP event loop');
            const moved = await aiMoved;
            const computer = moved.computer!.color;
            const fromPieces = beforeComputer.board.flat().filter(piece => piece?.player === computer);
            const destination = moved.board.flat().find(piece => piece?.player === computer &&
                fromPieces.some(previous => previous?.color === piece.color && (previous.r !== piece.r || previous.c !== piece.c)));
            assert(destination, 'Computer must move a tower');
            const source = fromPieces.find(piece => piece?.color === destination.color)!;
            assert(position(beforeComputer).isValidMove(source.r, source.c, destination.r, destination.c, computer).valid);
            assert(moved.timer.remaining[computer] < 60000, 'Computer thinking time is charged to its clock');
            assert.equal((await player.emitWithAck('leaveComputerGame', { gameId: response.gameId! })).success, true);
        }
    }

    // Cancel a live search and immediately reuse the same identity: no old worker
    // may apply its move to the next game or leak room events to its old socket.
    const ownerId = `ai-reconnect-${process.pid}`;
    const abandoned = await create(player, { playerId: ownerId, colorMode: 'white', aiLevel: 10 });
    let lateUpdates = 0;
    player.on('gameStateUpdate', state => { if (state.id === abandoned.gameId) lateUpdates++; });
    assert.equal((await player.emitWithAck('leaveComputerGame', { gameId: abandoned.gameId! })).success, true);
    const afterLeave = lateUpdates;
    const recreated = await create(player, { playerId: ownerId, colorMode: 'white', aiLevel: 10 });
    assert.equal(recreated.success, true);
    player.disconnect();
    await new Promise(resolve => setTimeout(resolve, 300));
    const reconnected = await connect();
    const resumedMove = nextState(reconnected, state => state.id === recreated.gameId && state.turn === 'white' && !state.computer?.thinking);
    const restored = await reconnected.emitWithAck('checkActiveSession', { playerId: ownerId });
    assert.equal(restored.active, true);
    assert.equal(restored.opponentDisconnected, false, 'The computer never appears disconnected');
    assert.equal(restored.gameState?.requiredColor, null, 'Disconnect cancels search before any move is applied');
    assert(restored.gameState?.computer?.thinking, 'Reconnect resumes the computer turn');
    await resumedMove;
    assert.equal(lateUpdates, afterLeave);
    await reconnected.emitWithAck('leaveComputerGame', { gameId: recreated.gameId! });

    // Play through a round with each arrangement. The computer confirms without
    // a second client; fill mode proceeds through whichever player is defender.
    for (const positionMode of ['standard', 'fill', 'random']) {
        const response = await create(reconnected, { matchType: '3', positionMode });
        let state = response.gameState!;
        let plies = 0;
        while (state.round === 1 && !state.finished && plies++ < 100) {
            if (state.roundState === 'waiting_confirmation') {
                assert(state.confirmations.includes('white'), 'Computer automatically confirms the next round');
                const next = nextState(reconnected, value => value.id === state.id && value.round === 2);
                reconnected.emit('confirmNextRound', { gameId: state.id });
                state = await next;
                break;
            }
            const changed = nextState(reconnected, value => value.id === state.id &&
                (value.roundState !== 'playing' || (value.turn === 'black' && JSON.stringify(value.board) !== JSON.stringify(state.board))));
            if (state.turn === 'black') {
                const moves = legalMoves(state);
                // Prefer progress, allowing quick real wins without modifying server state.
                moves.sort((a, b) => b.toR - a.toR);
                assert(moves.length > 0);
                reconnected.emit('makeMove', { gameId: state.id, move: moves[0] });
            }
            state = await changed;
        }
        assert.equal(state.round, 2, `A ${positionMode} game must advance to its next round`);
        if (state.roundState === 'waiting_fill_choice') {
            assert.equal(state.defender, 'black', 'Computer defenders choose automatically');
            const filled = nextState(reconnected, value => value.id === state.id && value.roundState === 'playing');
            reconnected.emit('fillChoice', { gameId: state.id, direction: 'right' });
            state = await filled;
        }
        assert.equal(state.roundState, 'playing');
        await reconnected.emitWithAck('leaveComputerGame', { gameId: response.gameId! });
    }

    for (const matchType of ['7', '15']) {
        const response = await create(reconnected, { matchType });
        assert.equal(response.success, true);
        await reconnected.emitWithAck('leaveComputerGame', { gameId: response.gameId! });
    }
    console.log('Computer game integration tests passed: levels, legal moves, clocks, private rooms, reconnect, cancellation and rounds.');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => { for (const socket of sockets) socket.close(); });
