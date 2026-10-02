'use strict';

const api = window.kamisadoDesktop;
const launcher = document.getElementById('launcher');
const gamePanel = document.getElementById('game-panel');
const gameFrame = document.getElementById('game-frame');
const toolbar = document.getElementById('play-toolbar');
const settingsButton = document.getElementById('hosting-settings');
const statusPanel = document.getElementById('status-panel');
const tokenSetup = document.getElementById('token-setup');
const quickActions = document.querySelector('.quick-actions');
const errorPanel = document.getElementById('error-panel');
const onlineButton = document.getElementById('online-button');
const lanButton = document.getElementById('lan-button');
const computerButton = document.getElementById('computer-button');
const peerHostButton = document.getElementById('peer-host-button');
const peerJoinButton = document.getElementById('peer-join-button');
const tokenContinue = document.getElementById('token-continue');
const stopConfirmation = document.getElementById('stop-confirmation');
const internetOptions = document.getElementById('internet-options');
const hostSteps = document.getElementById('host-steps');
const joinInvitation = document.getElementById('join-invitation');
const joinResult = document.getElementById('join-result');
let currentState = null;
let busy = false;
let storagePreferenceInitialized = false;

function setBusy(value, message = 'Connecting…') {
    busy = value;
    document.querySelectorAll('button, input').forEach(control => {
        control.disabled = value || control.dataset.stayDisabled === 'true';
    });
    document.getElementById('remember-token').disabled = value || !currentState?.canSaveNgrokToken;
    const notice = document.getElementById('busy-message');
    notice.textContent = value ? message : '';
    notice.classList.toggle('hidden', !value);
    launcher.setAttribute('aria-busy', String(value));
}

function showLauncher() {
    launcher.classList.remove('hidden');
    gamePanel.classList.add('hidden');
    document.body.classList.remove('playing');
    settingsButton.setAttribute('aria-expanded', 'true');
    stopConfirmation.classList.add('hidden');
}

function showGame() {
    if (currentState?.status !== 'ready' || !currentState.localOrigin) return;
    // Keep the same frame alive when changing connectivity or visiting settings.
    if (gameFrame.dataset.origin !== currentState.localOrigin) {
        gameFrame.dataset.origin = currentState.localOrigin;
        gameFrame.src = currentState.localOrigin + (currentState.peerMode
            ? '/?peer=' + currentState.peerMode : (currentState.localOnly ? '/?opponent=computer' : ''));
    }
    launcher.classList.add('hidden');
    gamePanel.classList.remove('hidden');
    document.body.classList.add('playing');
    settingsButton.setAttribute('aria-expanded', 'false');
    gameFrame.focus();
}

function showTokenSetup() {
    quickActions.classList.add('hidden');
    hostSteps.classList.add('hidden');
    internetOptions.classList.add('hidden');
    document.getElementById('peer-help').classList.add('hidden');
    tokenSetup.classList.remove('hidden');
    errorPanel.classList.add('hidden');
    document.getElementById('auth-token').focus();
}

function hideTokenSetup() {
    tokenSetup.classList.add('hidden');
    quickActions.classList.remove('hidden');
    hostSteps.classList.remove('hidden');
    internetOptions.classList.remove('hidden');
    document.getElementById('peer-help').classList.toggle('hidden', currentState?.status === 'ready');
}

function showLocalError(message) {
    errorPanel.textContent = message;
    errorPanel.classList.remove('hidden');
}

async function startHosting(request) {
    if (busy) return;
    setBusy(true, request.peerMode ? 'Preparing your Internet game…' : (request.localOnly ? 'Preparing your game…' : 'Connecting…'));
    errorPanel.classList.add('hidden');
    try {
        const state = await api.startHosting(request);
        render(state);
        if (state.status === 'ready' && !state.error && !hasNoNetworkAddress(state)) showGame();
        else if (hasNoNetworkAddress(state)) showLauncher();
    } catch (error) {
        showLocalError(error.message || String(error));
    } finally {
        document.getElementById('auth-token').value = '';
        setBusy(false);
    }
}

function isLoopbackOrigin(origin) {
    const hostname = new URL(origin).hostname;
    return hostname === 'localhost' || hostname === '[::1]' || hostname.startsWith('127.');
}

function hasNoNetworkAddress(state) {
    return !state.localOnly && state.connectivity?.mode === 'direct'
        && state.connectivity.reachableOrigins.every(isLoopbackOrigin);
}

function renderOrigins(origins) {
    const container = document.getElementById('origins');
    container.replaceChildren();
    origins.forEach((origin, index) => {
        const row = document.createElement('div');
        row.className = 'origin-row';
        const content = document.createElement('div');
        const label = document.createElement('small');
        const loopback = isLoopbackOrigin(origin);
        const selected = origin === currentState.connectivity.publicOrigin;
        label.textContent = loopback ? 'This computer only' : (selected ? 'Invitation address' : 'Alternative address');
        const code = document.createElement('code');
        code.textContent = origin;
        content.append(label, code);
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.textContent = 'Copy';
        copy.addEventListener('click', async () => {
            try {
                await api.copyText(origin);
                copy.textContent = 'Copied';
                setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
            } catch {
                showLocalError('Could not copy the address. Select it in Connection details and copy it manually.');
            }
        });
        const actions = document.createElement('div');
        actions.className = 'origin-actions';
        actions.append(copy);
        if (!loopback && !currentState.localOnly && currentState.connectivity.mode === 'direct') {
            const useAddress = document.createElement('button');
            useAddress.type = 'button';
            useAddress.textContent = selected ? 'Selected' : 'Use for invitation';
            useAddress.disabled = selected;
            useAddress.dataset.stayDisabled = String(selected);
            useAddress.setAttribute('aria-label', selected ? 'Selected invitation address ' + origin : 'Use ' + origin + ' for invitation');
            useAddress.addEventListener('click', () => {
                document.getElementById('advertised-origin').value = origin;
                void startHosting({ mode: 'direct', advertisedOrigin: origin });
            });
            actions.append(useAddress);
        }
        row.append(content, actions);
        container.append(row);
    });
}

function render(state) {
    currentState = state;
    const ready = state.status === 'ready' && Boolean(state.connectivity);
    const localSession = ready && state.localOnly;
    const peer = ready && Boolean(state.peerMode);
    const offline = localSession && !peer;
    const hasToken = state.hasSavedNgrokToken || state.hasSessionNgrokToken;
    document.getElementById('local-origin').textContent = state.localOrigin || 'Not running';
    document.getElementById('port-description').textContent = state.port
        ? 'The current local port is ' + state.port + '.'
        : 'The app chooses a free local port when you connect.';
    document.getElementById('saved-token-row').classList.toggle('hidden', !hasToken);
    document.getElementById('token-status').textContent = state.hasSavedNgrokToken
        ? 'Credentials saved securely' : 'Credentials available until you quit';
    document.getElementById('online-description').textContent = hasToken
        ? 'Your ngrok account is connected. This uses the ngrok relay service.'
        : 'Only the host needs an ngrok account. Guests join in their browser.';

    const remember = document.getElementById('remember-token');
    remember.disabled = busy || !state.canSaveNgrokToken;
    if (!storagePreferenceInitialized) {
        remember.checked = state.canSaveNgrokToken;
        storagePreferenceInitialized = true;
    }
    if (!state.canSaveNgrokToken) remember.checked = false;
    document.getElementById('remember-row').classList.toggle('disabled', !state.canSaveNgrokToken);
    document.getElementById('storage-note').textContent = state.canSaveNgrokToken
        ? 'Saved tokens are encrypted by the operating system. Uncheck to remember only until you quit.'
        : 'Secure storage is unavailable. Your token will stay in memory until you quit.';

    errorPanel.classList.toggle('hidden', !state.error);
    errorPanel.textContent = state.error || '';
    statusPanel.classList.toggle('hidden', !ready);
    toolbar.classList.toggle('hidden', !ready);
    document.getElementById('setup-panel').classList.toggle('hidden', localSession);
    computerButton.classList.toggle('hidden', ready);
    peerHostButton.classList.toggle('hidden', ready);
    peerJoinButton.classList.toggle('hidden', ready);
    document.getElementById('peer-help').classList.toggle('hidden', ready);
    document.querySelector('.connection-details').classList.toggle('hidden', localSession);
    document.getElementById('switch-hint').classList.toggle('hidden', !ready || localSession);
    settingsButton.textContent = localSession ? 'Session' : 'Connection';
    document.getElementById('session-hint').textContent = offline
        ? 'Offline play' : 'Keep this app open and this computer awake.';
    document.getElementById('status-title').textContent = peer ? 'Your Internet game' : (offline ? 'Your computer game' : (state.connectivity?.title || 'Hosting is active'));
    document.getElementById('stop-hosting').textContent = localSession ? 'End session' : 'Stop hosting';
    document.getElementById('stop-title').textContent = localSession ? 'End this session?' : 'End hosting?';
    document.getElementById('stop-description').textContent = offline
        ? 'Your current game will end. You can start another game from the welcome screen.'
        : peer ? 'This ends your direct Internet session and disconnects your opponent.'
        : 'This ends all current games and disconnects your guests.';
    document.getElementById('confirm-stop').textContent = localSession ? 'End session' : 'End games and stop';
    document.getElementById('page-title').textContent = ready
        ? (localSession ? 'Your session' : 'Connection settings') : 'Choose your game';
    document.getElementById('page-intro').textContent = ready
        ? (localSession ? 'Return to the board, or finish and choose a new game.' : 'Your game stays open while you manage its connection.')
        : 'Play with a friend on your home network or over a direct Internet connection.';

    if (ready) {
        hideTokenSetup();
        const online = state.connectivity.mode === 'ngrok';
        document.getElementById('connection-label').textContent = peer ? 'Internet P2P' : (offline ? 'Computer' : (online ? 'ngrok relay' : 'LAN'));
        document.getElementById('status-description').textContent = offline
            ? 'This session stays on this computer. To play across devices, end it and choose a connection.' : peer
            ? 'Your app connects directly to your friend. Both players keep their apps open; there is no central game server.' : online
            ? 'Friends can join over the Internet through ngrok. Keep this app open while they play.'
            : state.connectivity.description;
        const warning = document.getElementById('warning');
        warning.textContent = state.connectivity.warning || '';
        warning.classList.toggle('hidden', !state.connectivity.warning);
        renderOrigins(state.connectivity.reachableOrigins);
    } else {
        gameFrame.removeAttribute('src');
        delete gameFrame.dataset.origin;
        showLauncher();
        hideTokenSetup();
    }
}

onlineButton.addEventListener('click', () => {
    if (currentState?.hasSavedNgrokToken || currentState?.hasSessionNgrokToken) {
        void startHosting({ mode: 'ngrok' });
    } else {
        showTokenSetup();
    }
});
computerButton.addEventListener('click', () => startHosting({ mode: 'direct', localOnly: true }));
peerHostButton.addEventListener('click', () => startHosting({ mode: 'direct', localOnly: true, peerMode: 'host' }));
peerJoinButton.addEventListener('click', () => startHosting({ mode: 'direct', localOnly: true, peerMode: 'guest' }));
lanButton.addEventListener('click', () => startHosting({
    mode: 'direct',
    advertisedOrigin: document.getElementById('advertised-origin').value,
}));
document.getElementById('join-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const invitation = joinInvitation.value.trim();
    joinInvitation.removeAttribute('aria-invalid');
    joinResult.classList.remove('error');
    joinResult.classList.add('hidden');
    if (!invitation) {
        joinResult.textContent = 'Paste the invitation link your friend shared.';
        joinResult.classList.add('error');
        joinResult.classList.remove('hidden');
        joinInvitation.setAttribute('aria-invalid', 'true');
        joinInvitation.focus();
        return;
    }
    setBusy(true, 'Opening your invitation…');
    try {
        await api.joinGame(invitation);
        joinResult.textContent = currentState?.status === 'ready'
            ? 'Opened in your browser. Your current session in this app is still running.'
            : 'Opened in your browser. Keep the host computer connected while you play.';
    } catch (error) {
        joinResult.textContent = error.message || String(error);
        joinResult.classList.add('error');
        joinInvitation.setAttribute('aria-invalid', 'true');
    } finally {
        joinResult.classList.remove('hidden');
        setBusy(false);
        if (joinInvitation.hasAttribute('aria-invalid')) joinInvitation.focus();
    }
});
// The embedded game has no desktop API access. Only its current local frame
// may ask the launcher to open a validated invitation in the system browser.
window.addEventListener('message', async event => {
    if (event.source !== gameFrame.contentWindow || event.origin !== currentState?.localOrigin
        || event.data?.type !== 'kamisado:join-invitation' || !Number.isSafeInteger(event.data.requestId)) return;
    const source = event.source;
    const origin = event.origin;
    const requestId = event.data.requestId;
    if (busy) {
        source.postMessage({ type: 'kamisado:join-result', requestId, success: false, message: 'Please wait for the current action to finish.' }, origin);
        return;
    }
    setBusy(true, 'Opening your invitation…');
    try {
        await api.joinGame(event.data.url);
        source.postMessage({ type: 'kamisado:join-result', requestId, success: true, message: 'Opened in your browser. This app stays open.' }, origin);
    } catch (error) {
        source.postMessage({ type: 'kamisado:join-result', requestId, success: false, message: error.message || String(error) }, origin);
    } finally {
        setBusy(false);
    }
});
tokenContinue.addEventListener('click', () => {
    const authToken = document.getElementById('auth-token').value.trim();
    if (!authToken) {
        showLocalError('Paste your ngrok token to continue.');
        document.getElementById('auth-token').focus();
        return;
    }
    void startHosting({
        mode: 'ngrok', authToken,
        rememberAuthToken: document.getElementById('remember-token').checked,
    });
});
document.getElementById('auth-token').addEventListener('keydown', event => {
    if (event.key === 'Enter' && !busy) tokenContinue.click();
});
document.getElementById('token-back').addEventListener('click', hideTokenSetup);
document.getElementById('change-token').addEventListener('click', () => {
    document.getElementById('advanced-options').open = false;
    showTokenSetup();
});
document.getElementById('forget-token').addEventListener('click', async () => {
    setBusy(true, 'Removing saved credentials…');
    try { render(await api.forgetNgrokToken()); }
    catch (error) { showLocalError(error.message || String(error)); }
    finally { setBusy(false); }
});
settingsButton.addEventListener('click', () => {
    if (launcher.classList.contains('hidden')) {
        showLauncher();
        document.getElementById('return-to-game').focus();
    } else {
        showGame();
    }
});
document.getElementById('return-to-game').addEventListener('click', showGame);
document.getElementById('stop-hosting').addEventListener('click', () => {
    stopConfirmation.classList.remove('hidden');
    document.getElementById('cancel-stop').focus();
});
document.getElementById('cancel-stop').addEventListener('click', () => {
    stopConfirmation.classList.add('hidden');
    document.getElementById('stop-hosting').focus();
});
document.getElementById('confirm-stop').addEventListener('click', async () => {
    if (busy) return;
    setBusy(true, currentState?.localOnly ? 'Ending your session…' : 'Stopping hosting…');
    try {
        render(await api.stopHosting());
        peerHostButton.focus();
    } catch (error) {
        showLocalError(error.message || String(error));
    } finally {
        setBusy(false);
        if (currentState?.status !== 'ready') peerHostButton.focus();
    }
});
document.querySelectorAll('[data-external]').forEach(button => {
    button.addEventListener('click', async () => {
        try { await api.openExternal(button.dataset.external); }
        catch (error) { showLocalError(error.message || String(error)); }
    });
});

setBusy(true, 'Getting ready…');
api.getState().then(state => {
    render(state);
    if (state.status === 'ready' && !hasNoNetworkAddress(state)) showGame();
}).catch(error => showLocalError(error.message || String(error))).finally(() => setBusy(false));
