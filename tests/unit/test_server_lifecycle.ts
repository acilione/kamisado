import assert from 'assert';

import { setPublicOrigin, startServer } from '../../src/server/index.js';

async function main(): Promise<void> {
    setPublicOrigin('https://invite.example.test/path-is-discarded');
    const server = await startServer({ port: 0, host: '127.0.0.1' });

    try {
        const baseUrl = `http://127.0.0.1:${server.port}`;
        const health = await fetch(`${baseUrl}/health`);
        assert.equal(health.status, 200);
        assert.deepEqual(await health.json(), { status: 'ok' });

        const config = await fetch(`${baseUrl}/runtime-config.js`);
        assert.equal(config.headers.get('cache-control'), 'no-store');
        assert.match(await config.text(), /https:\/\/invite\.example\.test/);
    } finally {
        await server.close();
    }

    console.log('Embeddable server lifecycle test passed.');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
