const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const WebSocket = require('ws');

function waitForMessage(socket, predicate) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('message', onMessage);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    const onMessage = (data) => {
      const message = data.toString();
      if (predicate(message)) {
        cleanup();
        resolve(message);
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => onError(new Error('WebSocket closed before expected message'));
    const timer = setTimeout(() => onError(new Error('Timed out waiting for WebSocket message')), 5000);
    socket.on('message', onMessage);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

test('Socket.IO and PeerJS upgrades coexist', { timeout: 15000 }, async () => {
  const child = spawn(process.execPath, ['-e', `
    const Module = require('module');
    const load = Module._load;
    Module._load = function(request, parent) {
      if (request === './config/db' || (request === '../config/db' && parent.filename.endsWith('User.js'))) return {};
      if (request === './config/mesh') return { getMeshNodes: () => [], fetchPeerRooms: async () => [] };
      return load.apply(this, arguments);
    };
    process.env.PORT = '0';
    process.stdin.resume();
    process.stdin.on('end', () => process.exit(0));
    require('./app.js');
  `], { cwd: require('node:path').resolve(__dirname, '..'), stdio: ['pipe', 'pipe', 'pipe'] });

  let output = '';
  child.stderr.on('data', (data) => { output += data; });
  let sockets = [];
  try {
    const port = await new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', (code) => reject(new Error(`Server exited (${code}): ${output}`)));
      child.stdout.on('data', (data) => {
        output += data;
        const match = output.match(/Server running on port (\d+)/);
        if (match) resolve(match[1]);
      });
    });
    const base = `http://127.0.0.1:${port}`;
    const peer = new WebSocket(`ws://127.0.0.1:${port}/peerjs/peerjs?key=peerjs&id=test-peer&token=test-token`);
    const peerOpen = waitForMessage(peer, (message) => JSON.parse(message).type === 'OPEN');
    const game = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`);
    const gameHandshake = waitForMessage(game, (message) => message.startsWith('0'));
    sockets.push(peer, game);
    await Promise.all([peerOpen, gameHandshake]);
    const gameStart = waitForMessage(game, (message) => message.startsWith('42["start",'));
    game.send('40');
    await gameStart;

    const response = await fetch(`${base}/socket.io/?EIO=4&transport=polling`);
    assert.equal(response.status, 200);
    const handshake = await response.text();
    const { sid } = JSON.parse(handshake.slice(1));
    const upgrade = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket&sid=${encodeURIComponent(sid)}`);
    sockets.push(upgrade);
    await once(upgrade, 'open');
    const probe = waitForMessage(upgrade, (message) => message === '3probe');
    upgrade.send('2probe');
    await probe;
    const upgradedStart = waitForMessage(upgrade, (message) => message.startsWith('42["start",'));
    upgrade.send('5');
    upgrade.send('40');
    await upgradedStart;

    await new Promise((resolve) => setTimeout(resolve, 1500));
    for (const socket of sockets) assert.equal(socket.readyState, WebSocket.OPEN);
  } finally {
    for (const socket of sockets) socket.terminate();
    child.stdin.end();
    if (child.exitCode === null) await once(child, 'exit');
  }
});
