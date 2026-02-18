/**
 * Start server with ngrok tunnel for sharing over the internet.
 *
 * Usage: npm run ngrok
 *
 * Requires ngrok to be installed: https://ngrok.com/download
 */

const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.PORT || 3000;

console.log('Starting Kamisado server with ngrok...\n');

const serverProcess = spawn('node', ['dist/server/index.js'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit'
});

setTimeout(() => {
    console.log('\nStarting ngrok tunnel...\n');

    const ngrokProcess = spawn('ngrok', ['http', PORT.toString()], {
        stdio: 'inherit'
    });

    ngrokProcess.on('error', (err) => {
        if (err.code === 'ENOENT') {
            console.error('\n[ERROR] ngrok not found!');
            console.error('Install it from https://ngrok.com/download');
            console.error('\nAlternatively, start in separate terminals:');
            console.error('  Terminal 1: npm start');
            console.error('  Terminal 2: ngrok http 3000');
            serverProcess.kill();
            process.exit(1);
        }
        console.error('ngrok error:', err);
    });

    ngrokProcess.on('close', (code) => {
        serverProcess.kill();
        process.exit(code);
    });

}, 2000);

process.on('SIGINT', () => {
    serverProcess.kill();
    process.exit(0);
});

serverProcess.on('close', (code) => {
    process.exit(code);
});
