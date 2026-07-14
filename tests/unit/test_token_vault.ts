import assert from 'assert';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { TokenVault, type TokenCipher } from '../../src/desktop/token-vault.js';

const cipher: TokenCipher = {
    encrypt: value => Buffer.from(value, 'utf8').reverse(),
    decrypt: value => Buffer.from(value).reverse().toString('utf8'),
};

async function main(): Promise<void> {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'kamisado-token-vault-'));
    const filePath = path.join(directory, 'settings.json');
    const vault = new TokenVault(filePath, cipher);

    try {
        assert.equal(await vault.load(), null, 'missing settings should behave like an empty vault');

        await vault.save('secret-token');
        assert.equal(await vault.load(), 'secret-token');
        assert.doesNotMatch(await readFile(filePath, 'utf8'), /secret-token/, 'plain token must never reach disk');

        await writeFile(filePath, '{invalid json', 'utf8');
        assert.equal(await vault.load(), null, 'corrupt settings should be discarded safely');

        await vault.save('replacement-token');
        await vault.clear();
        assert.equal(await vault.load(), null);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }

    console.log('Secure token vault tests passed.');
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
