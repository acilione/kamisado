const api = window.kamisadoDesktop;
const setupPanel = document.getElementById('setup-panel');
const statusPanel = document.getElementById('status-panel');
const tokenSetup = document.getElementById('token-setup');
const quickActions = document.querySelector('.quick-actions');
const errorPanel = document.getElementById('error-panel');
const onlineButton = document.getElementById('online-button');
const lanButton = document.getElementById('lan-button');
const tokenContinue = document.getElementById('token-continue');
let currentState = null;

function setBusy(busy, message = 'Connecting…') {
    [onlineButton, lanButton, tokenContinue].forEach(button => { button.disabled = busy; });
    tokenContinue.textContent = busy ? message : 'Save and continue';
    document.querySelectorAll('input').forEach(input => {
        input.disabled = busy || (input.id === 'remember-token' && currentState && !currentState.canSaveNgrokToken);
    });
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
    setBusy(true);
    errorPanel.classList.add('hidden');
    try {
        render(await api.startHosting(request));
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
            await api.copyText(origin);
            copy.textContent = 'Copied';
            setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
        });
        row.append(content, copy);
        container.append(row);
    });
}

function render(state) {
    currentState = state;
    document.getElementById('local-origin').textContent = state.localOrigin || 'starting…';
    document.getElementById('server-port').textContent = state.port || '—';
    document.getElementById('saved-token-row').classList.toggle('hidden', !state.hasSavedNgrokToken);
    document.getElementById('online-description').textContent = state.hasSavedNgrokToken
        ? 'Ready to use. The other player can join from any browser.'
        : 'Works from any network. The first time requires a free account.';

    const remember = document.getElementById('remember-token');
    remember.disabled = !state.canSaveNgrokToken;
    remember.checked = state.canSaveNgrokToken;
    document.getElementById('remember-row').classList.toggle('disabled', !state.canSaveNgrokToken);
    document.getElementById('storage-note').textContent = state.canSaveNgrokToken
        ? 'The token is encrypted by the operating system and is never displayed.'
        : 'Secure storage is unavailable: the token will only last for this session.';

    errorPanel.classList.toggle('hidden', state.status !== 'error');
    errorPanel.textContent = state.error || '';

    const ready = state.status === 'ready' && state.connectivity;
    setupPanel.classList.toggle('hidden', Boolean(ready));
    statusPanel.classList.toggle('hidden', !ready);

    if (ready) {
        hideTokenSetup();
        document.getElementById('status-description').textContent = state.connectivity.mode === 'ngrok'
            ? 'The game is reachable over the Internet.'
            : 'The game is reachable directly on this network.';
        const warning = document.getElementById('warning');
        warning.textContent = state.connectivity.warning || '';
        warning.classList.toggle('hidden', !state.connectivity.warning);
        renderOrigins(state.connectivity.reachableOrigins);
    }
}

onlineButton.addEventListener('click', () => {
    if (currentState?.hasSavedNgrokToken) {
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
        return;
    }
    void startHosting({
        mode: 'ngrok',
        authToken,
        rememberAuthToken: document.getElementById('remember-token').checked,
    });
});

document.getElementById('token-back').addEventListener('click', hideTokenSetup);
document.getElementById('change-token').addEventListener('click', () => {
    document.getElementById('advanced-options').open = false;
    showTokenSetup();
});
document.getElementById('forget-token').addEventListener('click', async () => render(await api.forgetNgrokToken()));
document.getElementById('change-button').addEventListener('click', async () => render(await api.stopHosting()));
document.getElementById('open-game-button').addEventListener('click', () => api.openGame());
document.querySelectorAll('[data-external]').forEach(button => {
    button.addEventListener('click', () => api.openExternal(button.dataset.external));
});

api.getState().then(render).catch(error => showLocalError(error.message || String(error)));
