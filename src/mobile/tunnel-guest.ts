import { connectHttpSocket } from '../client/http-socket.js';
window.__KAMISADO_SOCKET_FACTORY__ = connectHttpSocket;
document.getElementById('create-game-options')!.classList.add('hidden');
void import('../client/client.js');
