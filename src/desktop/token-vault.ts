import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';

export interface TokenCipher {
    encrypt(value: string): Buffer;
    decrypt(value: Buffer): string;
}

interface StoredToken {
    version: 1;
    encryptedToken: string;
}

export class TokenVault {
    constructor(
        private readonly filePath: string,
        private readonly cipher: TokenCipher,
    ) {}

    async load(): Promise<string | null> {
        try {
            const content = await readFile(this.filePath, 'utf8');
            const stored = JSON.parse(content) as Partial<StoredToken>;
            if (stored.version !== 1 || typeof stored.encryptedToken !== 'string') {
                throw new Error('Unsupported token storage format');
            }
            const token = this.cipher.decrypt(Buffer.from(stored.encryptedToken, 'base64')).trim();
            if (!token) throw new Error('Stored token is empty');
            return token;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
            await this.clear();
            return null;
        }
    }

    async save(token: string): Promise<void> {
        const value = token.trim();
        if (!value) throw new Error('Cannot save an empty token');

        const stored: StoredToken = {
            version: 1,
            encryptedToken: this.cipher.encrypt(value).toString('base64'),
        };
        await mkdir(path.dirname(this.filePath), { recursive: true });
        await writeFile(this.filePath, `${JSON.stringify(stored)}\n`, { encoding: 'utf8', mode: 0o600 });
    }

    async clear(): Promise<void> {
        await rm(this.filePath, { force: true });
    }
}
