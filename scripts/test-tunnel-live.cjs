// Optional live service check; CI uses deterministic browser tests instead.
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { io } = require('socket.io-client');
const { startServer } = require('../dist/server');
const { CloudflareConnectivityProvider } = require('../dist/desktop/connectivity/cloudflare-provider');
const { TunnlConnectivityProvider } = require('../dist/desktop/connectivity/tunnl-provider');
const connect = origin => new Promise((resolve, reject) => {
  const socket = io(origin, { transports: ['websocket'], timeout: 20000, reconnection: false });
  socket.once('connect', () => resolve(socket));
  socket.once('connect_error', error => { socket.close(); reject(error); });
});
const ack = (socket, event, data) => new Promise((resolve, reject) => socket.timeout(10000).emit(event, data,
  (error, response) => error ? reject(error) : resolve(response)));
(async () => {
  const server = await startServer({ port: 0, host: '127.0.0.1' });
  const localOrigin = `http://127.0.0.1:${server.port}`;
  const service = process.env.TUNNEL_PROVIDER || 'tunnl';
  const Provider = service === 'tunnl' ? TunnlConnectivityProvider : CloudflareConnectivityProvider;
  const provider = new Provider(path.join(os.tmpdir(), `kamisado-${service}-live`));
  let host, guest;
  try {
    const details = await provider.start({ port: server.port, localOrigin });
    host = await connect(localOrigin);
    const game = await ack(host, 'createGame', { playerId: 'tunnel-test-host', opponent: 'human', matchType: '1', timer: '0', colorMode: 'black', positionMode: 'standard' });
    assert.equal(game.success, true);
    guest = await connect(details.publicOrigin);
    const joined = await ack(guest, 'joinGame', { playerId: 'tunnel-test-guest', gameId: game.gameId });
    assert.equal(joined.success, true);
    const moved = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Move did not reach the guest')), 10000);
      guest.on('gameStateUpdate', state => {
        if (state.board[1][0]?.color === 'black' || state.turn === 'white') { clearTimeout(timer); resolve(); }
      });
    });
    host.emit('makeMove', { gameId: game.gameId, move: { fromR: 0, fromC: 0, toR: 1, toC: 0 } });
    await moved;
    console.log(`Live ${service} HTTPS/WebSocket check passed: health endpoint, guest join, move delivery.`);
  } finally { host?.close(); guest?.close(); await provider.stop(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
