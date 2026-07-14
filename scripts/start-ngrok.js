/**
 * Build first, then start the same embedded server/provider used by Electron.
 *
 * PowerShell: $env:NGROK_AUTHTOKEN = '<token>'; npm run ngrok
 * Bash:       NGROK_AUTHTOKEN='<token>' npm run ngrok
 */

const { NgrokConnectivityProvider } = require('../dist/desktop/connectivity/ngrok-provider.js');
const { setPublicOrigin, startServer } = require('../dist/server/index.js');

async function main() {
    const provider = new NgrokConnectivityProvider();
    const server = await startServer({ host: '127.0.0.1' });
    const localOrigin = `http://127.0.0.1:${server.port}`;

    try {
        const details = await provider.start({ port: server.port, localOrigin }, {});
        setPublicOrigin(details.publicOrigin);
        console.log(`Kamisado is available at ${details.publicOrigin}`);
        console.log('Press Ctrl+C to stop.');

        const shutdown = async () => {
            await provider.stop().catch(() => undefined);
            await server.close().catch(() => undefined);
            process.exit(0);
        };
        process.once('SIGINT', shutdown);
        process.once('SIGTERM', shutdown);
    } catch (error) {
        await provider.stop().catch(() => undefined);
        await server.close().catch(() => undefined);
        throw error;
    }
}

main().catch(error => {
    console.error(error.message || error);
    process.exitCode = 1;
});
