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
const tokenContinue = document.getElementById('token-continue');
const stopConfirmation = document.getElementById('stop-confirmation');
let currentState = null;
let busy = false;
let storagePreferenceInitialized = false;

function setBusy(value, message = 'Connecting…') {
    busy = value;
    document.querySelectorAll('button, input').forEach(control => { control.disabled = value; });
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
        gameFrame.src = currentState.localOrigin;
    }
    launcher.classList.add('hidden');
    gamePanel.classList.remove('hidden');
    document.body.classList.add('playing');
    settingsButton.setAttribute('aria-expanded', 'false');
    gameFrame.focus();
}

function showTokenSetup() {
    quickActions.classList.add('hidden');
    tokenSetup.classList.remove('hidden');
    errorPanel.classList.add('hidden');
    document.getElementById('auth-token').focus();
}

function hideTokenSetup() {
    tokenSetup.classList.add('hidden');
    quickActions.classList.remove('hidden');
}

function showLocalError(message) {
    errorPanel.textContent = message;
    errorPanel.classList.remove('hidden');
}

async function startHosting(request) {
    if (busy) return;
    setBusy(true);
    errorPanel.classList.add('hidden');
    try {
        const state = await api.startHosting(request);
        render(state);
        if (state.status === 'ready' && !state.error) showGame();
    } catch (error) {
        showLocalError(error.message || String(error));
    } finally {
        document.getElementById('auth-token').value = '';
        setBusy(false);
    }
}

function renderOrigins(origins) {
    const container = document.getElementById('origins');
    container.replaceChildren();
    origins.forEach((origin, index) => {
        const row = document.createElement('div');
        row.className = 'origin-row';
        const content = document.createElement('div');
        const label = document.createElement('small');
        label.textContent = index === 0 ? 'Primary address' : 'Alternative address';
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
        row.append(content, copy);
        container.append(row);
    });
}

function render(state) {
    currentState = state;
    const ready = state.status === 'ready' && Boolean(state.connectivity);
    const hasToken = state.hasSavedNgrokToken || state.hasSessionNgrokToken;
    document.getElementById('local-origin').textContent = state.localOrigin || 'Not running';
    document.getElementById('port-description').textContent = state.port
        ? 'The current local port is ' + state.port + '.'
        : 'The app chooses a free local port when you connect.';
    document.getElementById('saved-token-row').classList.toggle('hidden', !hasToken);
    document.getElementById('token-status').textContent = state.hasSavedNgrokToken
        ? 'Credentials saved securely' : 'Credentials available until you quit';
    document.getElementById('online-description').textContent = hasToken
        ? 'Ready to connect. Your friend can join from another network.'
        : 'For friends elsewhere. Requires a free ngrok account on this computer.';

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
    document.getElementById('switch-hint').classList.toggle('hidden', !ready);
    document.getElementById('page-title').textContent = ready ? 'Connection settings' : 'Play with a friend';
    document.getElementById('page-intro').textContent = ready
        ? 'Your game stays open while you manage its connection.'
        : 'Choose a connection, set your rules, and share an invitation. Your friend only needs a browser.';

    if (ready) {
        hideTokenSetup();
        const online = state.connectivity.mode === 'ngrok';
        document.getElementById('connection-label').textContent = online ? 'Internet' : 'Same network';
        document.getElementById('status-description').textContent = online
            ? 'Friends can join over the Internet.'
            : 'Friends on your network can join from their browser.';
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
lanButton.addEventListener('click', () => startHosting({
    mode: 'direct',
    advertisedOrigin: document.getElementById('advertised-origin').value,
}));
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
    setBusy(true, 'Stopping hosting…');
    try {
        render(await api.stopHosting());
        lanButton.focus();
    } catch (error) {
        showLocalError(error.message || String(error));
    } finally {
        setBusy(false);
        if (currentState?.status !== 'ready') lanButton.focus();
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
    if (state.status === 'ready') showGame();
}).catch(error => showLocalError(error.message || String(error))).finally(() => setBusy(false));