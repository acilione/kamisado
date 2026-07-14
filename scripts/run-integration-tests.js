const { spawn } = require('child_process');

const port = process.env.TEST_PORT || String(31_000 + (process.pid % 1_000));
const serverUrl = `http://127.0.0.1:${port}`;
const tests = [
    'test_game_basics.ts',
    'test_reconnection.ts',
    'test_spectator.ts',
    'test_link_system.ts',
    'test_lobby_refresh.ts',
    'test_websocket_resilience.ts',
];

const server = spawn(process.execPath, ['dist/server/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: port },
    stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOutput = '';
server.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
server.stderr.on('data', chunk => { serverOutput += chunk.toString(); });

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        if (server.exitCode !== null) {
            throw new Error(`Server exited before tests started.\n${serverOutput}`);
        }
        try {
            const response = await fetch(`${serverUrl}/health`);
            if (response.ok) return;
        } catch {
            // The server is still starting.
        }
        await delay(100);
    }
    throw new Error(`Timed out waiting for ${serverUrl}.\n${serverOutput}`);
}

function runTest(testFile) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            ['node_modules/tsx/dist/cli.mjs', `tests/integration/${testFile}`],
            {
                cwd: process.cwd(),
                env: { ...process.env, TEST_SERVER_URL: serverUrl },
                stdio: 'inherit',
            },
        );

        child.on('error', reject);
        child.on('exit', (code, signal) => {
            if (code === 0) resolve();
            else reject(new Error(`${testFile} failed (${signal || `exit ${code}`})`));
        });
    });
}

async function main() {
    try {
        await waitForServer();
        for (const testFile of tests) await runTest(testFile);
    } finally {
        if (server.exitCode === null) server.kill();
    }
}

main().catch(error => {
    console.error(error.message || error);
    process.exitCode = 1;
});
