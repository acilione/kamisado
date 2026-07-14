import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '../../src/shared/types.js';

export type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const SOCKET_URL = process.env.TEST_SERVER_URL || 'http://localhost:3000';

export function createClient(): TestSocket {
    return io(SOCKET_URL, {
        forceNew: true,
        reconnection: false
    }) as TestSocket;
}

export async function createGame(
    client: TestSocket,
    playerId: string,
    options: { matchType?: string; timer?: string; colorMode?: string; positionMode?: string } = {}
): Promise<any> {
    return new Promise((resolve, reject) => {
        client.emit('createGame', {
            matchType: options.matchType || '1',
            timer: options.timer || '0',
            colorMode: options.colorMode || 'black',
            positionMode: options.positionMode || 'standard',
            playerId
        }, (res: any) => {
            if (res.success) resolve(res);
            else reject(new Error(res.message));
        });
    });
}

export async function joinGame(client: TestSocket, gameId: string, playerId: string): Promise<any> {
    return new Promise((resolve, reject) => {
        client.emit('joinGame', { gameId, playerId }, (res: any) => {
            if (res.success) resolve(res);
            else reject(new Error(res.message || 'Join failed'));
        });
    });
}

export async function checkSession(client: TestSocket, playerId: string): Promise<any> {
    return new Promise((resolve) => {
        client.emit('checkActiveSession', { playerId }, resolve);
    });
}

export async function cancelGame(client: TestSocket, gameId: string): Promise<any> {
    return new Promise((resolve) => {
        client.emit('cancelGame', { gameId }, resolve);
    });
}

export async function makeMove(
    client: TestSocket,
    gameId: string,
    move: { fromR: number; fromC: number; toR: number; toC: number }
): Promise<void> {
    return new Promise((resolve) => {
        client.emit('makeMove', { gameId, move });
        setTimeout(resolve, 100);
    });
}

export async function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Test framework ---

let passed = 0;
let failed = 0;

export function assert(condition: boolean, message?: string): void {
    if (!condition) throw new Error(message || 'Assertion failed');
}

export async function test(name: string, fn: () => Promise<void>): Promise<void> {
    try {
        await fn();
        console.log(`✓ PASS: ${name}`);
        passed++;
    } catch (e: any) {
        console.error(`✗ FAIL: ${name}`);
        console.error(`  Error: ${e.message}`);
        failed++;
    }
}

export function printSummary(): void {
    console.log('\n=== Test Summary ===');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total:  ${passed + failed}`);
}

export function exitWithStatus(): never {
    printSummary();
    process.exit(failed > 0 ? 1 : 0);
}

export function resetCounters(): void {
    passed = 0;
    failed = 0;
}

export function getResults(): { passed: number; failed: number } {
    return { passed, failed };
}
