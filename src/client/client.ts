import type { GameState, PlayerColor } from '../shared/types.js';
import { BOARD_COLORS, STANDARD_LAYOUT } from '../shared/constants.js';
import { AI_LEVELS, isAiLevel } from '../shared/ai-levels.js';
import { normalizeGameInvitation } from '../shared/invitation-url.js';
import { createRealisticTower, createRealisticSymbol, REALISTIC_COLORS } from './realistic-art.js';
import { RealisticBoard3D } from './board-3d.js';
import { InvitationPanel } from './invitation.js';
import { connectGameSocket } from './transport.js';
import { PeerPanel } from './peer-panel.js';
import { normalizePeerInvitation } from '../shared/peer-invitation.js';

const requestedPeerMode = new URLSearchParams(window.location.search).get('peer');
const peer = requestedPeerMode === 'host' || requestedPeerMode === 'guest' ? new PeerPanel(requestedPeerMode) : null;
peer?.updateGame(null);
const socket = peer?.role === 'guest' ? peer.transport.getGuestSocket() : connectGameSocket();

// State
let gameId: string | null = null;
let playerColor: PlayerColor | null = null;
let gameState: GameState | null = null;
let selectedPiece: { r: number; c: number } | null = null;
let isSpectator = false;
let connectionReady = false;
let transportConnected = false;
let hostStopped = false;
let connectionVersion = 0;
const playerId = getPlayerId();
let timerInterval: ReturnType<typeof setInterval> | null = null;
let timerEndTime: number | null = null;
let disconnectInterval: ReturnType<typeof setInterval> | null = null;

// DOM Elements
const screens = {
    menu: document.getElementById('menu-screen')!,
    game: document.getElementById('game-screen')!,
};

const boardEl = document.getElementById('board')!;
const turnIndicatorEl = document.getElementById('turn-indicator')!;
const messageEl = document.getElementById('message')!;
const opponentSelect = document.getElementById('opponent') as HTMLSelectElement;
const aiLevelSelect = document.getElementById('ai-level') as HTMLSelectElement;
const leaveComputerBtn = document.getElementById('leave-computer-btn') as HTMLButtonElement;
let leavingComputer = false;
for (const profile of AI_LEVELS) {
    aiLevelSelect.add(new Option(`${profile.level} · ${profile.name}`, String(profile.level)));
}
aiLevelSelect.value = '5';
try {
    const savedLevel = Number(localStorage.getItem('kamisado_aiLevel'));
    if (isAiLevel(savedLevel)) aiLevelSelect.value = String(savedLevel);
} catch { /* Preferences are optional. */ }
if (new URLSearchParams(window.location.search).get('opponent') === 'computer') {
    opponentSelect.value = 'computer';
}
if (peer) {
    document.getElementById('join-game-options')!.classList.add('hidden');
    document.getElementById('join-separator')!.classList.toggle('hidden', peer.role === 'guest');
    document.getElementById('app-join-options')!.classList.toggle('hidden', peer.role === 'guest');
    if (peer.role === 'guest') document.getElementById('create-game-options')!.classList.add('hidden');
}
function updateOpponentOptions(): void {
    document.getElementById('computer-options')!.classList.remove('hidden');
}
opponentSelect.addEventListener('change', updateOpponentOptions);
aiLevelSelect.addEventListener('change', () => {
    try { localStorage.setItem('kamisado_aiLevel', aiLevelSelect.value); } catch { /* Session preference. */ }
});
updateOpponentOptions();
leaveComputerBtn.addEventListener('click', leaveComputerGame);
const invitation = new InvitationPanel(window.__KAMISADO_RUNTIME_CONFIG__?.publicOrigin || window.location.origin);
socket.on('runtimeConfig', config => {
    window.__KAMISADO_RUNTIME_CONFIG__ = config;
    invitation.setOrigin(config.publicOrigin || window.location.origin);
});
const symbolToggles = document.querySelectorAll<HTMLInputElement>('.symbol-mode-toggle');
const symbolLegend = document.getElementById('symbol-legend')!;
const symbolKey = document.getElementById('symbol-key') as HTMLDetailsElement;
type BoardView = 'realistic-2d' | 'realistic-3d';
const boardViewSelects = document.querySelectorAll<HTMLSelectElement>('.board-view-select');
const board3DEl = document.getElementById('board-3d')!;
const viewNotice = document.getElementById('view-notice')!;
let boardView: BoardView = 'realistic-2d';
let board3D: RealisticBoard3D | null = null;
try {
    const savedView = localStorage.getItem('kamisado_boardView');
    if (savedView === 'realistic-2d' || savedView === 'realistic-3d') boardView = savedView;
    else if (savedView !== null) localStorage.setItem('kamisado_boardView', boardView);
} catch { /* Display settings remain usable without browser storage. */ }
applyBoardView();
boardViewSelects.forEach(select => select.addEventListener('change', () => {
    const value = select.value;
    if (value !== 'realistic-2d' && value !== 'realistic-3d') return;
    boardView = value;
    viewNotice.textContent = '';
    saveBoardView();
    applyBoardView();
    applySymbolMode();
    renderBoard();
    updateUI();
}));
document.getElementById('reset-camera')!.addEventListener('click', () => board3D?.resetCamera());

function saveBoardView(): void {
    try { localStorage.setItem('kamisado_boardView', boardView); } catch { /* Session-only preference. */ }
}

function dispose3DBoard(): void {
    board3D?.dispose();
    board3D = null;
}

function applyBoardView(): void {
    document.getElementById('app')!.dataset.boardView = boardView;
    boardViewSelects.forEach(select => { select.value = boardView; });
    boardEl.classList.toggle('hidden', boardView === 'realistic-3d');
    board3DEl.classList.toggle('hidden', boardView !== 'realistic-3d');
    document.getElementById('camera-controls')!.classList.toggle('hidden', boardView !== 'realistic-3d');
    if (boardView !== 'realistic-3d') dispose3DBoard();
}

function fallbackFrom3D(): void {
    if (boardView !== 'realistic-3d') return;
    boardView = 'realistic-2d';
    saveBoardView();
    applyBoardView();
    viewNotice.textContent = '3D is unavailable on this device. Showing realistic 2D instead.';
    renderBoard();
}

window.addEventListener('pagehide', dispose3DBoard);
window.addEventListener('pageshow', () => { if (gameState) renderBoard(); });
let symbolMode = false;
try {
    symbolMode = localStorage.getItem('kamisado_symbolMode') === 'true';
} catch {
    // Display preferences still work when browser storage is unavailable.
}

function renderSymbolLegend(): void {
    symbolLegend.replaceChildren();
    for (const color of STANDARD_LAYOUT) {
        const item = document.createElement('li');
        item.append(createRealisticSymbol(color), document.createTextNode(color));
        symbolLegend.appendChild(item);
    }
    document.getElementById('symbol-key-help')!.textContent = 'Match the printed character on a square to the same character on a tower.';
}
applySymbolMode();
symbolToggles.forEach(toggle => toggle.addEventListener('change', () => {
    symbolMode = toggle.checked;
    try {
        localStorage.setItem('kamisado_symbolMode', String(symbolMode));
    } catch {
        // Keep the setting for this page even if it cannot be saved.
    }
    applySymbolMode();
    renderBoard();
    updateUI();
}));

function applySymbolMode(): void {
    renderSymbolLegend();
    symbolToggles.forEach(toggle => { toggle.checked = symbolMode; });
    document.getElementById('app')!.classList.toggle('symbol-mode', symbolMode);
    symbolKey.classList.toggle('hidden', !symbolMode);
    if (!symbolMode) symbolKey.open = false;
}

// Parse URL for direct game link
function getGameIdFromUrl(): string | null {
    if (peer?.role === 'guest') return peer.transport.gameId;
    const path = window.location.pathname;
    const match = path.match(/^\/game\/([a-zA-Z0-9]+)$/);
    return match ? match[1] : null;
}

function sessionUrl(path: string): string {
    if (window.__KAMISADO_MOBILE__) {
        const url = new URL(path, window.location.href);
        if (peer) url.searchParams.set('peer', peer.role);
        // Keep Capacitor on its bundled entry page. Game IDs are in memory.
        return '/' + url.search;
    }
    if (!peer) return path;
    const url = new URL(path, window.location.origin);
    url.searchParams.set('peer', peer.role);
    return url.pathname + url.search;
}

function refreshConnectionState(): void {
    const notice = document.getElementById('connection-notice')!;
    notice.classList.toggle('hidden', connectionReady && !hostStopped);
    notice.textContent = hostStopped
        ? 'The host stopped this game. Ask them for a new invitation.'
        : peer?.role === 'guest' ? 'Open or paste your friend’s invitation link to join.' : 'Connection lost. Reconnecting to the host…';
    for (const id of ['create-btn', 'play-computer-btn', 'join-btn']) {
        (document.getElementById(id) as HTMLButtonElement).disabled = !connectionReady || hostStopped;
    }
    selectedPiece = null;
    if (gameState) {
        renderBoard();
        updateUI();
    }
}

socket.on('hostStopped', () => {
    hostStopped = true;
    connectionReady = false;
    connectionVersion++;
    if (disconnectInterval) { clearInterval(disconnectInterval); disconnectInterval = null; }
    refreshConnectionState();
});

socket.on('disconnect', () => {
    transportConnected = false;
    connectionReady = false;
    connectionVersion++;
    if (disconnectInterval) { clearInterval(disconnectInterval); disconnectInterval = null; }
    refreshConnectionState();
});

// Restore server-authoritative state before accepting actions after reconnecting.
socket.on('connect', () => {
    transportConnected = true;
    // A fresh peer invitation may come from a restarted host with a new room.
    // Ordinary browser sessions still keep their explicit host-stop notice.
    if (peer?.role === 'guest') hostStopped = false;
    if (hostStopped) return;
    const version = ++connectionVersion;
    connectionReady = false;
    socket.emit('checkActiveSession', { playerId }, (response) => {
        if (version !== connectionVersion || hostStopped) return;
        if (response.active) {
            handleJoinResponse(response);
        } else {
            const urlGameId = getGameIdFromUrl();
            if (urlGameId) {
                socket.emit('joinGame', { gameId: urlGameId, playerId }, result => {
                    if (version === connectionVersion && !hostStopped) handleJoinResponse(result);
                });
            } else {
                connectionReady = true;
                refreshConnectionState();
            }
        }
    });
});

// Event Listeners
document.getElementById('play-computer-btn')!.addEventListener('click', () => {
    createGame('computer');
});
document.getElementById('create-btn')!.addEventListener('click', () => createGame('human'));
function createGame(opponent: 'computer' | 'human'): void {
    if (!connectionReady || hostStopped || peer?.role === 'guest') return;
    opponentSelect.value = opponent;
    socket.emit('createGame', {
        opponent: opponentSelect.value === 'computer' ? 'computer' : 'human',
        ...(opponentSelect.value === 'computer' ? { aiLevel: Number(aiLevelSelect.value) } : {}),
        matchType: (document.getElementById('match-type') as HTMLSelectElement).value,
        timer: (document.getElementById('timer') as HTMLSelectElement).value,
        colorMode: (document.getElementById('color-mode') as HTMLSelectElement).value,
        positionMode: (document.getElementById('position-mode') as HTMLSelectElement).value,
        playerId,
    }, currentJoinResponse());
    opponentSelect.value = 'human';
}

document.getElementById('join-peer-btn')!.addEventListener('click', () => {
    const value = (document.getElementById('app-join-link') as HTMLInputElement).value.trim();
    try {
        if (value && /^https?:/.test(value)) { openInvitation(normalizeGameInvitation(value)); return; }
        const code = value ? normalizePeerInvitation(value) : undefined;
        if (window.__KAMISADO_JOIN_PEER__) window.__KAMISADO_JOIN_PEER__(code);
        else if (window.parent !== window) window.parent.postMessage({ type: 'kamisado:join-peer', invitation: code }, '*');
        else window.location.assign('/?peer=guest' + (code ? '#' + code : ''));
    } catch (error) { alert(error instanceof Error ? error.message : 'Invalid invitation.'); }
});
window.addEventListener('hashchange', () => {
    if (peer?.role !== 'guest' || !window.location.hash) return;
    if (gameState && !gameState.finished && !confirm('Leave this game and open the new invitation?')) {
        history.replaceState({}, '', location.pathname + location.search);
        return;
    }
    // A second app link can be a same-document navigation. Recreate the transport cleanly.
    window.location.reload();
});
if (peer?.role === 'guest' && window.location.hash) {
    const invitationCode = window.location.hash.slice(1);
    history.replaceState({}, '', window.location.pathname + window.location.search);
    void peer.joinInvitation(invitationCode).catch(error => {
        document.getElementById('peer-status')!.textContent = error instanceof Error ? error.message : 'Invalid invitation.';
    });
}

let invitationRequest = 0;
function openInvitation(url: string): void {
    if (window.__KAMISADO_OPEN_LAN__) { window.__KAMISADO_OPEN_LAN__(url); return; }
    if (window.parent === window) {
        window.location.assign(url);
        return;
    }
    // The desktop shell opens a friend's invitation in the system browser. The
    // embedded game keeps its local-only navigation and receives no native API.
    const requestId = ++invitationRequest;
    const listener = (event: MessageEvent) => {
        if (event.source !== window.parent || event.data?.type !== 'kamisado:join-result' || event.data.requestId !== requestId) return;
        clearTimeout(timeout);
        window.removeEventListener('message', listener);
        if (!event.data.success) alert(event.data.message || 'Could not open the invitation.');
    };
    const timeout = setTimeout(() => {
        window.removeEventListener('message', listener);
        alert('Open this invitation in your web browser to join your friend.');
    }, 5000);
    window.addEventListener('message', listener);
    window.parent.postMessage({ type: 'kamisado:join-invitation', url, requestId }, '*');
}

document.getElementById('join-btn')!.addEventListener('click', () => {
    if (!connectionReady || hostStopped) return;
    const rawValue = (document.getElementById('join-id') as HTMLInputElement).value.trim();
    if (/^https?:\/\//i.test(rawValue)) {
        try {
            const url = normalizeGameInvitation(rawValue);
            if (new URL(url).origin !== window.location.origin) {
                openInvitation(url);
                return;
            }
        } catch (error) {
            alert(error instanceof Error ? error.message : 'Invalid invitation link.');
            return;
        }
    }
    const id = rawValue.match(/^(?:https?:\/\/[^/]+)?(?:\/game\/)?([a-f0-9]{12})\/?$/i)?.[1]?.toLowerCase();
    if (id) {
        socket.emit('joinGame', { gameId: id, playerId }, currentJoinResponse());
    } else {
        alert('Enter a valid game ID or invitation link.');
    }
});

document.getElementById('tutorial-toggle')!.addEventListener('click', () => {
    const content = document.getElementById('tutorial-content')!;
    const btn = document.getElementById('tutorial-toggle')!;
    content.classList.toggle('hidden');
    btn.setAttribute('aria-expanded', String(!content.classList.contains('hidden')));
    btn.textContent = content.classList.contains('hidden') ? 'How to Play' : 'Hide Tutorial';
});

function getPlayerId(): string {
    let id: string | null = null;
    try { id = localStorage.getItem('kamisado_playerId'); } catch { /* Use a session-only ID. */ }
    if (!id) {
        id = Math.random().toString(36).substring(2) + Date.now().toString(36);
        try { localStorage.setItem('kamisado_playerId', id); } catch { /* Storage is optional. */ }
    }
    return id;
}

interface JoinResponse {
    success?: boolean;
    message?: string;
    gameId?: string;
    color?: PlayerColor;
    isSpectator?: boolean;
    gameState?: GameState;
    active?: boolean;
    opponentDisconnected?: boolean;
    timeoutSeconds?: number;
    roundTimerEndTime?: number | null;
}

function currentJoinResponse(): (response: JoinResponse) => void {
    const version = connectionVersion;
    return response => {
        if (version === connectionVersion) handleJoinResponse(response);
    };
}

function returnToMenu(): void {
    if (window.parent !== window) window.parent.postMessage({ type: 'kamisado:session', active: false }, '*');
    opponentSelect.value = 'human';
    gameId = null;
    gameState = null;
    peer?.updateGame(null);
    playerColor = null;
    isSpectator = false;
    selectedPiece = null;
    invitation.setGame(null);
    dispose3DBoard();
    screens.game.classList.add('hidden');
    screens.menu.classList.remove('hidden');
    if (disconnectInterval) { clearInterval(disconnectInterval); disconnectInterval = null; }
    if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
    if (chessClockInterval) { clearInterval(chessClockInterval); chessClockInterval = null; }
    timerEndTime = null;
    document.getElementById('timer-container')?.remove();
    messageEl.textContent = '';
    window.history.replaceState({}, '', sessionUrl(opponentSelect.value === 'computer' ? '/?opponent=computer' : '/'));
    refreshConnectionState();
}

function leaveComputerGame(): void {
    if (!gameState?.computer || !gameId || !connectionReady || hostStopped || leavingComputer) return;
    leavingComputer = true;
    leaveComputerBtn.disabled = true;
    const room = gameId;
    const version = connectionVersion;
    socket.timeout(5000).emit('leaveComputerGame', { gameId: room }, (error, response) => {
        leavingComputer = false;
        if (version !== connectionVersion || room !== gameId) return;
        if (error || !response?.success) {
            updateUI();
            alert(response?.message || 'Could not end the game. Please try again.');
            return;
        }
        returnToMenu();
    });
}

function handleJoinResponse(response: JoinResponse): void {
    if (hostStopped || !transportConnected) return;
    if (response.success) {
        connectionReady = true;
        refreshConnectionState();
        gameId = response.gameId!;
        playerColor = response.color || null;
        gameState = response.gameState!;
        isSpectator = response.isSpectator === true;
        leavingComputer = false;
        if (gameState.computer) {
            opponentSelect.value = 'computer';
            aiLevelSelect.value = String(gameState.computer.level);
            updateOpponentOptions();
        }

        screens.menu.classList.add('hidden');
        screens.game.classList.remove('hidden');

        renderBoard();
        updateUI();

        if (isSpectator) {
            messageEl.textContent = 'Spectating — watch only';
            messageEl.style.color = '#ffa500';
        } else if (response.active && gameState!.roundState !== 'waiting_start') {
            messageEl.textContent = `Session restored. You are ${playerColor!.toUpperCase()}.`;
            messageEl.style.color = 'white';
        } else {
            messageEl.textContent = `You are ${playerColor!.toUpperCase()}.`;
            messageEl.style.color = 'white';
        }

        // Update browser URL for direct links
        if (window.location.pathname !== `/game/${gameId}`) {
            window.history.replaceState({}, '', sessionUrl(`/game/${gameId}`));
        }

        if (!isSpectator && response.opponentDisconnected && response.timeoutSeconds && response.timeoutSeconds > 0) {
            handleOpponentDisconnect(response.timeoutSeconds);
        }

        // Restore round timer if in waiting_confirmation state
        if (response.roundTimerEndTime && response.roundTimerEndTime > Date.now()) {
            startRoundTimerFromEndTime(response.roundTimerEndTime);
        }

    } else {
        // A missing/expired invitation is a healthy connection to an unavailable
        // room. Return to a usable menu instead of retaining a frozen game.
        connectionReady = true;
        returnToMenu();
        alert(response.message || 'This invitation is no longer available.');
    }
}

// Socket Events
socket.on('playerJoined', () => {
    messageEl.textContent = `Opponent joined! Game starting.`;
});

socket.on('lobbyExpired', () => {
    alert('Lobby has expired or was cancelled.');
    returnToMenu();
});

function handleOpponentDisconnect(timeoutSeconds: number): void {
    let remaining = timeoutSeconds;
    const updateMsg = () => {
        messageEl.textContent = `Opponent disconnected! Waiting ${remaining}s...`;
    };
    updateMsg();
    messageEl.style.color = 'orange';

    if (disconnectInterval) clearInterval(disconnectInterval);
    disconnectInterval = setInterval(() => {
        remaining--;
        if (remaining >= 0) {
            updateMsg();
        } else {
            clearInterval(disconnectInterval!);
        }
    }, 1000);
}

socket.on('playerDisconnected', ({ timeoutSeconds, playerId: disconnectedPid }) => {
    if (disconnectedPid === playerId) return;
    if (isSpectator) {
        messageEl.textContent = `A player disconnected. Waiting ${timeoutSeconds}s for reconnection...`;
        messageEl.style.color = 'orange';
        return;
    }
    handleOpponentDisconnect(timeoutSeconds);
});

socket.on('playerReconnected', (data) => {
    if (data && data.playerId === playerId) return;

    if (disconnectInterval) clearInterval(disconnectInterval);
    messageEl.textContent = isSpectator ? 'Player reconnected. Game resumed.' : 'Opponent reconnected! Resuming.';
    messageEl.style.color = 'white';
});

socket.on('gameEnded', ({ reason, winner }) => {
    if (gameState) {
        gameState.finished = true;
        gameState.winner = winner;
    }

    if (reason === 'disconnection_timeout') {
        alert(`Game Over! Winner: ${winner}. Reason: Opponent timed out.`);
        messageEl.textContent = `Game Over. Winner: ${winner}`;
    }
    if (reason === 'round_timeout' || reason === 'surrender_timeout') {
        alert(`Game Over! Winner: ${winner}. Reason: Round Confirmation Timeout.`);
        messageEl.textContent = `Game Over. Winner: ${winner}`;
    }
    if (reason === 'chess_timeout') {
        alert(`Game Over! Winner: ${winner}. Reason: Time Limit Exceeded.`);
    }
    if (reason === 'match_complete') {
        messageEl.textContent = `Match complete. Winner: ${winner}`;
    }
    if (disconnectInterval) clearInterval(disconnectInterval);
    if (chessClockInterval) { clearInterval(chessClockInterval); chessClockInterval = null; }

    renderBoard();
    updateUI();
});

socket.on('sessionTakenOver', () => {
    dispose3DBoard();
    if (disconnectInterval) clearInterval(disconnectInterval);
    alert('Session active in another tab/window. This connection is now inactive.');
    screens.game.classList.add('hidden');
    screens.menu.classList.remove('hidden');
    document.title = "Inactive - Kamisado";
    messageEl.textContent = "Session active elsewhere.";
    gameId = null;
    invitation.setGame(null);
});

socket.on('gameStateUpdate', (newState) => {
    gameState = newState;
    selectedPiece = null;
    renderBoard();
    updateUI();
});

// Helper to start round timer countdown from endTime
function startRoundTimerFromEndTime(endTime: number): void {
    timerEndTime = endTime;
    updateTimerBtn();

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        updateTimerBtn();
        if (Date.now() >= timerEndTime!) {
            clearInterval(timerInterval!);
        }
    }, 1000);
}

socket.on('roundTimerStart', ({ endTime }) => {
    startRoundTimerFromEndTime(endTime);
});

socket.on('error', (err) => {
    alert(err.message);
});

function updateTimerBtn(): void {
    const btn = document.getElementById('next-round-btn') as HTMLButtonElement | null;
    if (!btn || !timerEndTime) return;

    const remaining = Math.max(0, Math.ceil((timerEndTime - Date.now()) / 1000));

    if (btn.disabled) {
        btn.textContent = `Waiting for opponent... (${remaining}s)`;
    } else {
        btn.textContent = `Ready for Next Round (${remaining}s)`;
    }
}

let chessClockInterval: ReturnType<typeof setInterval> | null = null;

function renderBoard(): void {
    if (!gameState) return;
    boardEl.innerHTML = '';

    const canInteract = connectionReady && !hostStopped && !isSpectator &&
        !gameState.finished &&
        gameState.roundState === 'playing' &&
        gameState.turn === playerColor;

    const viewAsBlack = isSpectator ? false : playerColor === 'black';
    const rows = viewAsBlack ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
    const cols = viewAsBlack ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

    rows.forEach(r => {
        cols.forEach(c => {
            const squareColor = BOARD_COLORS[r][c];
            const piece = gameState!.board[r][c];
            const cell = document.createElement('div');
            cell.className = `cell ${squareColor}`;
            cell.style.setProperty('--tile-color', REALISTIC_COLORS[squareColor]);
            cell.dataset.r = String(r);
            cell.dataset.c = String(c);
            const squareLabel = `Row ${r + 1}, column ${c + 1}: ${squareColor} square`;
            cell.title = piece
                ? `${squareLabel}; ${piece.player} ${piece.color} tower, rank ${piece.sumo}`
                : `${squareLabel}; empty`;
            cell.setAttribute('aria-label', cell.title);
            cell.setAttribute('role', 'group');
            if (symbolMode) {
                cell.append(
                    createRealisticSymbol(squareColor, 'square-symbol realistic-square-symbol'),
                    createRealisticSymbol(squareColor, 'square-symbol realistic-square-symbol opposite-symbol'),
                );
            }

            if (selectedPiece && selectedPiece.r === r && selectedPiece.c === c) {
                cell.classList.add('selected');
            }

            if (piece) {
                const pieceEl = document.createElement('div');
                pieceEl.className = `piece ${piece.player} ${piece.color}`;
                pieceEl.dataset.color = piece.color;
                pieceEl.appendChild(createRealisticTower(piece));
                if (piece.sumo > 0) {
                    const rank = document.createElement('span');
                    rank.className = 'sumo-rank';
                    rank.textContent = String(piece.sumo);
                    pieceEl.appendChild(rank);
                }
                cell.appendChild(pieceEl);

                if (canInteract && piece.player === playerColor) {
                    if (!gameState!.requiredColor || piece.color === gameState!.requiredColor) {
                        pieceEl.classList.add('playable');
                    }
                }
            }

            if (canInteract) {
                cell.addEventListener('click', () => handleCellClick(r, c));
            } else {
                cell.style.cursor = 'default';
            }
            boardEl.appendChild(cell);
        });
    });

    if (boardView === 'realistic-3d') {
        try {
            board3D ??= new RealisticBoard3D(board3DEl, handleCellClick, fallbackFrom3D);
            board3D.update({ state: gameState, viewAsBlack, symbolMode, selected: selectedPiece, canInteract, playerColor });
        } catch {
            fallbackFrom3D();
        }
    }
}

function handleCellClick(r: number, c: number): void {
    if (!connectionReady || hostStopped || !gameState || !gameId || isSpectator || gameState.finished ||
        gameState.roundState !== 'playing' || gameState.turn !== playerColor) return;

    const piece = gameState.board[r][c];

    if (piece && piece.player === playerColor) {
        if (gameState.requiredColor && piece.color !== gameState.requiredColor) {
            selectedPiece = null;
            renderBoard();
            alert(`You have to move the ${gameState.requiredColor} piece.`);
            return;
        }
        selectedPiece = { r, c };
        renderBoard();
        return;
    }

    if (selectedPiece) {
        socket.emit('makeMove', {
            gameId: gameId!,
            move: {
                fromR: selectedPiece.r,
                fromC: selectedPiece.c,
                toR: r,
                toC: c,
            },
        });
    }
}

function updateUI(): void {
    if (!gameState) return;
    if (window.parent !== window) window.parent.postMessage({ type: 'kamisado:session', active: !gameState.finished }, '*');
    peer?.updateGame(gameState.computer ? null : gameState.id, gameState.finished);
    const computer = gameState.computer;
    const computerStatus = document.getElementById('computer-status')!;
    computerStatus.classList.toggle('hidden', !computer);
    computerStatus.textContent = computer
        ? `Computer · Level ${computer.level} · ${AI_LEVELS[computer.level - 1]?.name || ''}${computer.thinking && connectionReady && !hostStopped ? ' · Thinking…' : ''}`
        : '';
    document.getElementById('computer-controls')!.classList.toggle('hidden', !computer || gameState.finished);
    leaveComputerBtn.disabled = !connectionReady || hostStopped || leavingComputer;
    if (!connectionReady || hostStopped) {
        invitation.setGame(null);
        turnIndicatorEl.textContent = hostStopped ? 'Game stopped' : 'Reconnecting…';
        turnIndicatorEl.className = '';
        messageEl.textContent = '';
        if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
        if (chessClockInterval) { clearInterval(chessClockInterval); chessClockInterval = null; }
        timerEndTime = null;
        document.getElementById('timer-container')?.remove();
        return;
    }
    invitation.setGame(computer || peer ? null : gameId, gameState.roundState === 'waiting_start' && !isSpectator);

    turnIndicatorEl.innerHTML = '';

    let statusText = `Turn: ${gameState.turn.toUpperCase()}`;
    if (gameState.requiredColor) {
        statusText += ` (Must move ${gameState.requiredColor.toUpperCase()})`;
    }

    if (gameState.finished) {
        statusText = gameState.winner === 'DRAW'
            ? 'MATCH OVER: DRAW'
            : `MATCH OVER: ${String(gameState.winner).toUpperCase()} WINS!`;

        turnIndicatorEl.appendChild(document.createTextNode(statusText));

        const btn = document.createElement('button');
        btn.id = 'back-menu-btn';
        btn.textContent = 'Back to Main Menu';
        btn.style.backgroundColor = '#444';
        btn.onclick = () => {
            if (gameState?.computer) { leaveComputerGame(); return; }
            localStorage.removeItem('kamisado_playerId');
            window.location.href = sessionUrl('/');
        };
        turnIndicatorEl.appendChild(btn);

        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        timerEndTime = null;

    } else if (gameState.roundState === 'waiting_start') {
        statusText = "Waiting for opponent to join...";
        turnIndicatorEl.appendChild(document.createTextNode(statusText));

        const btn = document.createElement('button');
        btn.id = 'cancel-game-btn';
        btn.textContent = 'Cancel Game';
        btn.style.backgroundColor = '#cc0000';
        btn.onclick = () => {
            if (!connectionReady || hostStopped) return;
            if (confirm('Are you sure you want to cancel the lobby?')) {
                socket.emit('cancelGame', { gameId: gameId! }, (res) => {
                    if (!res.success) alert(res.message || 'Failed to cancel');
                });
            }
        };
        turnIndicatorEl.appendChild(btn);

        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }

    } else if (gameState.roundState === 'waiting_confirmation') {
        statusText = `Round Finished! Winner: ${gameState.roundWinner!.toUpperCase()}.`;
        statusText += ` Scores: Black ${gameState.scores.black} - White ${gameState.scores.white}.`;

        turnIndicatorEl.appendChild(document.createTextNode(statusText));

        const hasConfirmed = playerColor ? gameState.confirmations.includes(playerColor) : false;
        if (isSpectator) {
            const wait = document.createElement('div');
            wait.textContent = 'Waiting for both players to continue...';
            turnIndicatorEl.appendChild(wait);
        } else if (!hasConfirmed) {
            const btn = document.createElement('button');
            btn.id = 'next-round-btn';
            btn.textContent = 'Ready for Next Round...';
            btn.onclick = () => {
                if (!connectionReady || hostStopped) return;
                socket.emit('confirmNextRound', { gameId: gameId! });
                btn.disabled = true;
                updateTimerBtn();
            };
            turnIndicatorEl.appendChild(btn);
        } else {
            const btn = document.createElement('button');
            btn.id = 'next-round-btn';
            btn.textContent = 'Waiting for opponent...';
            btn.disabled = true;
            turnIndicatorEl.appendChild(btn);
        }
        updateTimerBtn();
    } else if (gameState.roundState === 'waiting_fill_choice') {
        statusText = `Round ${gameState.round} - Fill Position Setup`;
        turnIndicatorEl.appendChild(document.createTextNode(statusText));

        if (!isSpectator && playerColor === gameState.defender) {
            const info = document.createElement('div');
            info.textContent = 'Choose fill direction for piece rearrangement:';
            info.style.marginTop = '10px';
            turnIndicatorEl.appendChild(info);

            const btnRow = document.createElement('div');
            btnRow.style.display = 'flex';
            btnRow.style.justifyContent = 'center';
            btnRow.style.gap = '10px';
            btnRow.style.marginTop = '10px';

            const leftBtn = document.createElement('button');
            leftBtn.textContent = 'Fill from Left';
            leftBtn.onclick = () => {
                if (!connectionReady || hostStopped) return;
                socket.emit('fillChoice', { gameId: gameId!, direction: 'left' });
            };
            btnRow.appendChild(leftBtn);

            const rightBtn = document.createElement('button');
            rightBtn.textContent = 'Fill from Right';
            rightBtn.onclick = () => {
                if (!connectionReady || hostStopped) return;
                socket.emit('fillChoice', { gameId: gameId!, direction: 'right' });
            };
            btnRow.appendChild(rightBtn);
            turnIndicatorEl.appendChild(btnRow);
        } else {
            const waitMsg = document.createElement('div');
            waitMsg.textContent = 'Waiting for opponent to choose fill direction...';
            waitMsg.style.marginTop = '10px';
            turnIndicatorEl.appendChild(waitMsg);
        }

        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        timerEndTime = null;

    } else {
        // Playing
        turnIndicatorEl.appendChild(document.createTextNode(statusText));
        if (symbolMode && gameState.requiredColor) {
            turnIndicatorEl.appendChild(createRealisticSymbol(gameState.requiredColor, 'required-symbol'));
        }

        if (gameState.positionMode === 'random' && gameState.roundPositionInfo) {
            const posInfo = document.createElement('div');
            posInfo.style.fontSize = '0.8em';
            posInfo.style.opacity = '0.7';
            posInfo.textContent = `Positions: Black #${gameState.roundPositionInfo.blackIndex} / White #${gameState.roundPositionInfo.whiteIndex}`;
            turnIndicatorEl.appendChild(posInfo);
        }

        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        timerEndTime = null;
    }

    turnIndicatorEl.className = gameState.turn;

    updateTimersContainer();
}

function updateTimersContainer(): void {
    if (!gameState) return;

    if (gameState.timer && gameState.timer.enabled) {
        if (!chessClockInterval) {
            chessClockInterval = setInterval(() => updateClocks(), 100);
        }

        let timerContainer = document.getElementById('timer-container');
        if (!timerContainer) {
            timerContainer = document.createElement('div');
            timerContainer.id = 'timer-container';
            timerContainer.style.display = 'flex';
            timerContainer.style.justifyContent = 'space-between';
            timerContainer.style.padding = '10px';
            timerContainer.style.fontSize = '1.2em';
            timerContainer.style.fontWeight = 'bold';
            timerContainer.style.width = '100%';
            timerContainer.style.maxWidth = '800px';
            timerContainer.style.marginBottom = '10px';

            const boardContainer = document.getElementById('board-container');
            if (boardContainer && boardContainer.parentElement) {
                boardContainer.parentElement.insertBefore(timerContainer, boardContainer);
            }
        }

        if (!document.getElementById('timer-black')) {
            const tBlack = document.createElement('div');
            tBlack.id = 'timer-black';
            tBlack.style.color = 'white';
            tBlack.style.textShadow = '0 0 2px black';
            timerContainer.appendChild(tBlack);

            const tWhite = document.createElement('div');
            tWhite.id = 'timer-white';
            tWhite.style.color = 'white';
            tWhite.style.textShadow = '0 0 2px black';
            timerContainer.appendChild(tWhite);
        }
    } else {
        if (chessClockInterval) { clearInterval(chessClockInterval); chessClockInterval = null; }
        const timerContainer = document.getElementById('timer-container');
        if (timerContainer) {
            timerContainer.remove();
        }
    }
}

function updateClocks(): void {
    if (!gameState || !gameState.timer || !gameState.timer.enabled) return;

    const gs = gameState as GameState & { _localReceiveTime?: number };
    if (!gs._localReceiveTime) gs._localReceiveTime = Date.now();

    const blackEl = document.getElementById('timer-black');
    const whiteEl = document.getElementById('timer-white');

    if (blackEl && whiteEl) {
        let bTime = gameState.timer.remaining.black;
        let wTime = gameState.timer.remaining.white;

        if (gameState.roundState === 'playing' && gameState.timer.lastTimestamp !== null) {
            const elapsed = Date.now() - gs._localReceiveTime;
            if (gameState.turn === 'black') bTime -= elapsed;
            else wTime -= elapsed;
        }

        const format = (ms: number): string => {
            if (ms < 0) ms = 0;
            const s = Math.ceil(ms / 1000);
            const m = Math.floor(s / 60);
            const sec = s % 60;
            return `${m}:${sec.toString().padStart(2, '0')}`;
        };

        blackEl.textContent = `Black: ${format(bTime)}`;
        whiteEl.textContent = `White: ${format(wTime)}`;

        if (gameState.turn === 'black') {
            blackEl.style.textDecoration = 'underline';
            whiteEl.style.textDecoration = 'none';
        } else {
            blackEl.style.textDecoration = 'none';
            whiteEl.style.textDecoration = 'underline';
        }
    }
}
