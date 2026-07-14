import type { GameState, PlayerColor, PieceColor } from '../shared/types.js';

const socket = io();

// State
let gameId: string | null = null;
let playerColor: PlayerColor | null = null;
let gameState: GameState | null = null;
let selectedPiece: { r: number; c: number } | null = null;
let isSpectator = false;
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

// Parse URL for direct game link
function getGameIdFromUrl(): string | null {
    const path = window.location.pathname;
    const match = path.match(/^\/game\/([a-zA-Z0-9]+)$/);
    return match ? match[1] : null;
}

// Initial check for active session or URL-based join
socket.on('connect', () => {
    socket.emit('checkActiveSession', { playerId }, (response) => {
        if (response.active) {
            handleJoinResponse(response);
        } else {
            const urlGameId = getGameIdFromUrl();
            if (urlGameId) {
                socket.emit('joinGame', { gameId: urlGameId, playerId }, handleJoinResponse);
            }
        }
    });
});

// Event Listeners
document.getElementById('create-btn')!.addEventListener('click', () => {
    socket.emit('createGame', {
        matchType: (document.getElementById('match-type') as HTMLSelectElement).value,
        timer: (document.getElementById('timer') as HTMLSelectElement).value,
        colorMode: (document.getElementById('color-mode') as HTMLSelectElement).value,
        positionMode: (document.getElementById('position-mode') as HTMLSelectElement).value,
        playerId,
    }, handleJoinResponse);
});

document.getElementById('join-btn')!.addEventListener('click', () => {
    const rawValue = (document.getElementById('join-id') as HTMLInputElement).value.trim();
    const id = rawValue.match(/(?:\/game\/)?([a-f0-9]{12})\/?$/i)?.[1];
    if (id) {
        socket.emit('joinGame', { gameId: id, playerId }, handleJoinResponse);
    } else {
        alert('Enter a valid game ID or invitation link.');
    }
});

document.getElementById('tutorial-toggle')!.addEventListener('click', () => {
    const content = document.getElementById('tutorial-content')!;
    const btn = document.getElementById('tutorial-toggle')!;
    content.classList.toggle('hidden');
    btn.textContent = content.classList.contains('hidden') ? 'How to Play' : 'Hide Tutorial';
});

function getPlayerId(): string {
    let id = localStorage.getItem('kamisado_playerId');
    if (!id) {
        id = Math.random().toString(36).substring(2) + Date.now().toString(36);
        localStorage.setItem('kamisado_playerId', id);
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

function handleJoinResponse(response: JoinResponse): void {
    if (response.success) {
        gameId = response.gameId!;
        playerColor = response.color || null;
        gameState = response.gameState!;
        isSpectator = response.isSpectator === true;

        screens.menu.classList.add('hidden');
        screens.game.classList.remove('hidden');

        renderBoard();
        updateUI();

        // Build shareable URL
        const shareUrl = `${window.location.origin}/game/${gameId}`;

        if (isSpectator) {
            messageEl.innerHTML = `<strong>👁 Spectating</strong> - Watch only mode`;
            messageEl.style.color = '#ffa500';
        } else if (response.active && gameState!.roundState !== 'waiting_start') {
            messageEl.textContent = `Session restored. You are ${playerColor!.toUpperCase()}.`;
            messageEl.style.color = 'white';
        } else {
            // Show share link for new games AND restored lobbies (waiting_start)
            messageEl.innerHTML = `
                <span>Share: <code id="share-url" style="background:#333;padding:2px 6px;border-radius:3px;">${shareUrl}</code></span>
                <button id="copy-link-btn" style="margin-left:10px;padding:5px 10px;font-size:0.9rem;">Copy</button>
            `;
            messageEl.style.color = 'white';

            // Add copy functionality
            document.getElementById('copy-link-btn')!.onclick = () => {
                navigator.clipboard.writeText(shareUrl).then(() => {
                    document.getElementById('copy-link-btn')!.textContent = 'Copied!';
                    setTimeout(() => {
                        const btn = document.getElementById('copy-link-btn');
                        if (btn) btn.textContent = 'Copy';
                    }, 2000);
                });
            };
        }

        // Update browser URL for direct links
        if (window.location.pathname !== `/game/${gameId}`) {
            window.history.replaceState({}, '', `/game/${gameId}`);
        }

        if (!isSpectator && response.opponentDisconnected && response.timeoutSeconds && response.timeoutSeconds > 0) {
            handleOpponentDisconnect(response.timeoutSeconds);
        }

        // Restore round timer if in waiting_confirmation state
        if (response.roundTimerEndTime && response.roundTimerEndTime > Date.now()) {
            startRoundTimerFromEndTime(response.roundTimerEndTime);
        }

    } else {
        alert(response.message);
    }
}

// Socket Events
socket.on('playerJoined', () => {
    messageEl.textContent = `Opponent joined! Game starting.`;
});

socket.on('lobbyExpired', () => {
    alert('Lobby has expired or was cancelled.');
    screens.game.classList.add('hidden');
    screens.menu.classList.remove('hidden');
    gameId = null;
    playerColor = null;
    gameState = null;
    messageEl.textContent = '';
    localStorage.removeItem('kamisado_playerId');
    if (disconnectInterval) clearInterval(disconnectInterval);
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

    updateUI();
});

socket.on('sessionTakenOver', () => {
    if (disconnectInterval) clearInterval(disconnectInterval);
    alert('Session active in another tab/window. This connection is now inactive.');
    screens.game.classList.add('hidden');
    screens.menu.classList.remove('hidden');
    document.title = "Inactive - Kamisado";
    messageEl.textContent = "Session active elsewhere.";
    gameId = null;
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

    const canInteract = !isSpectator &&
        !gameState.finished &&
        gameState.roundState === 'playing' &&
        gameState.turn === playerColor;

    const viewAsBlack = isSpectator ? false : playerColor === 'black';
    const rows = viewAsBlack ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
    const cols = viewAsBlack ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
    const SQUARES = getBoardColors();

    rows.forEach(r => {
        cols.forEach(c => {
            const squareColor = SQUARES[r][c];
            const piece = gameState!.board[r][c];
            const cell = document.createElement('div');
            cell.className = `cell ${squareColor}`;
            cell.dataset.r = String(r);
            cell.dataset.c = String(c);

            if (selectedPiece && selectedPiece.r === r && selectedPiece.c === c) {
                cell.classList.add('selected');
            }

            if (piece) {
                const pieceEl = document.createElement('div');
                pieceEl.className = `piece ${piece.player} ${piece.color}`;
                pieceEl.dataset.color = piece.color;
                if (piece.sumo > 0) pieceEl.textContent = String(piece.sumo);
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
}

function handleCellClick(r: number, c: number): void {
    if (!gameState || gameState.turn !== playerColor) return;

    const piece = gameState.board[r][c];

    if (piece && piece.player === playerColor) {
        if (gameState.requiredColor && piece.color !== gameState.requiredColor) {
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
            localStorage.removeItem('kamisado_playerId');
            window.location.href = '/';
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
                socket.emit('fillChoice', { gameId: gameId!, direction: 'left' });
            };
            btnRow.appendChild(leftBtn);

            const rightBtn = document.createElement('button');
            rightBtn.textContent = 'Fill from Right';
            rightBtn.onclick = () => {
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

function getBoardColors(): PieceColor[][] {
    type C = PieceColor;
    const o: C = 'orange', b: C = 'blue', p: C = 'purple', pi: C = 'pink';
    const y: C = 'yellow', r: C = 'red', g: C = 'green', br: C = 'brown';
    return [
        [o, b, p, pi, y, r, g, br],
        [r, o, pi, g, b, y, br, p],
        [g, pi, o, r, p, br, y, b],
        [pi, p, b, o, br, g, r, y],
        [y, r, g, br, o, b, p, pi],
        [b, y, br, p, r, o, pi, g],
        [p, br, y, b, g, pi, o, r],
        [br, g, r, y, pi, p, b, o],
    ];
}
