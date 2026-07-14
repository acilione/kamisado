const api = window.kamisadoDesktop;
const setupPanel = document.getElementById('setup-panel');
const statusPanel = document.getElementById('status-panel');
const errorPanel = document.getElementById('error-panel');
const startButton = document.getElementById('start-button');
const ngrokOptions = document.getElementById('ngrok-options');
const directOptions = document.getElementById('direct-options');

function selectedMode() {
    return document.querySelector('input[name="mode"]:checked').value;
}

function setBusy(busy) {
    startButton.disabled = busy;
    startButton.textContent = busy ? 'Starting…' : selectedMode() === 'ngrok' ? 'Start internet room' : 'Start direct room';
    document.querySelectorAll('input').forEach(input => { input.disabled = busy; });
}

function renderOrigins(origins) {
    const container = document.getElementById('origins');
    container.replaceChildren();

    origins.forEach((origin, index) => {
        const row = document.createElement('div');
        row.className = 'origin-row';
        const content = document.createElement('div');
        const label = document.createElement('small');
        label.textContent = index === 0 ? 'Invitation base address' : 'Alternative address';
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
    document.getElementById('local-origin').textContent = state.localOrigin || 'starting…';
    document.getElementById('server-port').textContent = state.port || '—';
    errorPanel.classList.toggle('hidden', state.status !== 'error');
    errorPanel.textContent = state.error || '';

    const ready = state.status === 'ready' && state.connectivity;
    setupPanel.classList.toggle('hidden', Boolean(ready));
    statusPanel.classList.toggle('hidden', !ready);

    if (ready) {
        document.getElementById('status-title').textContent = state.connectivity.title;
        document.getElementById('status-description').textContent = state.connectivity.description;
        const warning = document.getElementById('warning');
        warning.textContent = state.connectivity.warning || '';
        warning.classList.toggle('hidden', !state.connectivity.warning);
        renderOrigins(state.connectivity.reachableOrigins);
    }
}

document.querySelectorAll('input[name="mode"]').forEach(input => {
    input.addEventListener('change', () => {
        const mode = selectedMode();
        document.querySelectorAll('.mode').forEach(label => {
            label.classList.toggle('selected', label.contains(document.querySelector('input[name="mode"]:checked')));
        });
        ngrokOptions.classList.toggle('hidden', mode !== 'ngrok');
        directOptions.classList.toggle('hidden', mode !== 'direct');
        setBusy(false);
        errorPanel.classList.add('hidden');
    });
});

startButton.addEventListener('click', async () => {
    setBusy(true);
    errorPanel.classList.add('hidden');
    const state = await api.startHosting({
        mode: selectedMode(),
        authToken: document.getElementById('auth-token').value,
        advertisedOrigin: document.getElementById('advertised-origin').value,
    });
    document.getElementById('auth-token').value = '';
    setBusy(false);
    render(state);
});

document.getElementById('change-button').addEventListener('click', async () => render(await api.stopHosting()));
document.getElementById('open-game-button').addEventListener('click', () => api.openGame());
document.querySelectorAll('[data-external]').forEach(button => {
    button.addEventListener('click', () => api.openExternal(button.dataset.external));
});

api.getState().then(render).catch(error => {
    errorPanel.textContent = error.message || String(error);
    errorPanel.classList.remove('hidden');
});
