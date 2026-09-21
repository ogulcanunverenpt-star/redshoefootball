const express = require('express');
const expressLayouts = require('express-ejs-layouts');
const passport = require('passport');
const flash = require('connect-flash');
const session = require('express-session');
const path = require('path');
const http = require('http');
const socketio = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const { ExpressPeerServer } = require('peer');
const { exec } = require('child_process');
const fs = require('fs');
require('dotenv').config();

const meshRegistry = require('./config/mesh');

// Express & HTTP Server Setup
const app = express();
const server = http.createServer(app);

// Socket.IO Setup
const io = socketio(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// PeerJS Setup
const peerServer = ExpressPeerServer(server, { debug: true });
app.use('/peerjs', peerServer);

// Connect SQLite Database
require('./config/db');

// Passport Config
require('./config/passport')(passport);

// Auth Middleware (from config/auth.js)
const { ensureAuthenticated, forwardAuthenticated } = require('./config/auth');

// Make Auth middleware available on app object
app.ensureAuthenticated = ensureAuthenticated;
app.forwardAuthenticated = forwardAuthenticated;

// EJS Layouts & View Engine
app.use(expressLayouts);
app.set('view engine', 'ejs');

// Body Parser Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Serve Static Files from public folder
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static('public'));

// Serve 3D Football Game Static Build from redshoefootball folder
app.use('/game', express.static(path.join(__dirname, 'redshoefootball/client/dist'), {
  etag: false,
  maxAge: 0
}));
app.use('/assets', express.static(path.join(__dirname, 'redshoefootball/client/dist/assets')));

// Express Session Middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'super_secret_mesh_key_2024',
    resave: true,
    saveUninitialized: true
  })
);

// Passport Middleware
app.use(passport.initialize());
app.use(passport.session());

// Connect Flash
app.use(flash());

// Global Variables
app.use(function(req, res, next) {
  res.locals.success_msg = req.flash('success_msg');
  res.locals.error_msg = req.flash('error_msg');
  res.locals.error = req.flash('error');
  res.locals.user = req.user || null;
  res.locals.domainName = process.env.DOMAIN_NAME || '';
  next();
});

// =========================================================
// AUTOMATED CLOUDFLARE TUNNEL RUNNER
// =========================================================
let activeCloudflareUrl = null;

function startCloudflareTunnel() {
  console.log('[Cloudflare] Starting automated Cloudflare Tunnel...');
  const tunnel = exec('npx @cloudflare/cloudflared tunnel --url http://localhost:5000');

  const processOutput = (data) => {
    const match = data.toString().match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
    if (match && !activeCloudflareUrl) {
      activeCloudflareUrl = match[0];
      console.log('=======================================================');
      console.log(` 🌐 CLOUDFLARE TUNNEL ACTIVE: ${activeCloudflareUrl} `);
      console.log('=======================================================');

      try {
        fs.writeFileSync(
          path.join(__dirname, 'public/server-url.json'),
          JSON.stringify({ url: activeCloudflareUrl, timestamp: Date.now() })
        );
      } catch (e) {
        console.warn('Could not write server-url.json:', e.message);
      }
    }
  };

  tunnel.stdout.on('data', processOutput);
  tunnel.stderr.on('data', processOutput);
}

// =========================================================
// VIDEO MEET ROOMS STATE & ENGINE
// =========================================================
const roomsMap = new Map();

function getActiveRooms() {
  const activeRooms = [];
  roomsMap.forEach((participants, roomId) => {
    if (participants.size > 0) {
      const userList = Array.from(participants.values());
      const speakersCount = userList.filter(u => u.role === 'speaker').length;
      const listenersCount = userList.filter(u => u.role === 'listener').length;
      activeRooms.push({
        roomId,
        participantCount: participants.size,
        speakersCount,
        listenersCount,
        participants: userList.map(u => ({ nickname: u.nickname, role: u.role, peerId: u.peerId }))
      });
    }
  });
  return activeRooms;
}

// =========================================================
// 3D MULTIPLAYER FOOTBALL GAME ENGINE & STATE
// =========================================================
const GAME_GRAVITY = -10;
const GRASS_E = 0.5;
const SIDE_E = 0.85;

const gameBall = {
  position: { x: 0, y: 4, z: -4 },
  velocity: { x: 0, y: 0, z: 0 },
  acceleration: { x: 0, y: GAME_GRAVITY, z: 0 },
  spin: { x: 0, y: 0, z: 0 }
};

let gameGoal = false;
let lastKick = null;
const gameTeams = [new Set(), new Set()];
const gameScore = [0, 0];
let gameTimeLeft = 300;
let gameTimerInterval;
const gamePlayers = {};

function resetGameBall() {
  gameBall.position = { x: 0, y: 4, z: 0 };
  gameBall.velocity = { x: 0, y: 0, z: 0 };
  gameBall.acceleration = { x: 0, y: GAME_GRAVITY, z: 0 };
  gameBall.spin = { x: 0, y: 0, z: 0 };
  gameGoal = false;
}

function startGameEngine() {
  resetGameBall();

  gameTimerInterval = setInterval(() => {
    gameTimeLeft = gameTimeLeft - 1;
    if (gameTimeLeft <= 0) {
      gameTimeLeft = 300;
      gameScore[0] = 0;
      gameScore[1] = 0;
    }
    io.emit("update clock", gameTimeLeft);
  }, 1000);
}

function scoreGoal(team) {
  gameGoal = true;
  gameScore[team] += 1;
  console.log("[3D Game] GOAL!", gameScore, team, lastKick);
  io.emit("goal", { score: gameScore, team, scorer: lastKick });

  setTimeout(() => {
    resetGameBall();
  }, 3000);
}

function isCloseToBall(id) {
  if (!gamePlayers[id]) return false;
  const dx = gameBall.position.x - gamePlayers[id].position.x;
  const dz = gameBall.position.z - gamePlayers[id].position.z;
  return Math.hypot(dx, dz) < 3.8;
}

function length({ x, y, z }) {
  return Math.hypot(x, y, z);
}

function normalise(vector) {
  const magnitude = length(vector);
  if (magnitude !== 0) {
    const scalar = 1 / magnitude;
    vector.x *= scalar;
    vector.y *= scalar;
    vector.z *= scalar;
  }
}

function applyQuaternion(v, q) {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = - q.x * v.x - q.y * v.y - q.z * v.z;

  v.x = ix * q.w + iw * - q.x + iy * - q.z - iz * - q.y;
  v.y = iy * q.w + iw * - q.y + iz * - q.x - ix * - q.z;
  v.z = iz * q.w + iw * - q.z + ix * - q.y - iy * - q.x;
}

function handlePlayerPlayerCollisions() {
  const playerIds = Object.keys(gamePlayers);
  const minDist = 0.95;

  for (let i = 0; i < playerIds.length; i++) {
    for (let j = i + 1; j < playerIds.length; j++) {
      const p1 = gamePlayers[playerIds[i]];
      const p2 = gamePlayers[playerIds[j]];
      if (!p1 || !p2) continue;

      const dx = p1.position.x - p2.position.x;
      const dz = p1.position.z - p2.position.z;
      const dist = Math.hypot(dx, dz);

      if (dist < minDist && dist > 0.001) {
        const overlap = (minDist - dist) / 2;
        const nx = dx / dist;
        const nz = dz / dist;
        p1.position.x += nx * overlap;
        p1.position.z += nz * overlap;
        p2.position.x -= nx * overlap;
        p2.position.z -= nz * overlap;
      }
    }
  }
}

function handleSmoothDribbling() {
  const DRIBBLE_DIST = 1.35;
  Object.entries(gamePlayers).forEach(([id, player]) => {
    const dx = gameBall.position.x - player.position.x;
    const dz = gameBall.position.z - player.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist < DRIBBLE_DIST && gameBall.position.y < 2.0) {
      const ballSpeed = Math.hypot(gameBall.velocity.x, gameBall.velocity.z);
      if (ballSpeed < 10.0) {
        const dir = { x: 0, y: 0, z: -1 };
        applyQuaternion(dir, player.looking);
        dir.y = 0; normalise(dir);

        gameBall.velocity.x = player.velocity.x * 1.1 + dir.x * 4.0;
        gameBall.velocity.z = player.velocity.z * 1.1 + dir.z * 4.0;
      }
    }
  });
}

function handlePortalTeleportation() {
  Object.entries(gamePlayers).forEach(([id, player]) => {
    const distToBluePortal = Math.hypot(player.position.x - 0, player.position.z - (-28.0));
    if (distToBluePortal < 3.5) {
      player.position.x = 0;
      player.position.y = 0;
      player.position.z = -100.0;
      return;
    }

    const distToPinkPortal = Math.hypot(player.position.x - 0, player.position.z - (-105.0));
    if (distToPinkPortal < 3.5) {
      player.position.x = 0;
      player.position.y = 0;
      player.position.z = -25.0;
      return;
    }

    if (player.position.z < -26.0 && player.position.z > -95.0) {
      if (player.position.z > -60.0) {
        player.position.z = -25.5;
      } else {
        player.position.z = -95.5;
      }
    }
  });
}

function updateGamePhysics() {
  Object.entries(gamePlayers).forEach(([id, { input, looking }]) => {
    const direction = { x: 0, y: 0, z: 0 };
    let speed = 6.5;

    if (input.has("forward")) direction.z -= 1;
    if (input.has("backward")) direction.z += 1;
    if (input.has("right")) direction.x += 1;
    if (input.has("left")) direction.x -= 1;
    if (input.has("sprint") && input.has("forward")) speed = 9.0;

    applyQuaternion(direction, looking);
    direction.y = 0;
    normalise(direction);

    gamePlayers[id].velocity.x = direction.x * speed;
    gamePlayers[id].velocity.y += GAME_GRAVITY * 0.016;
    gamePlayers[id].velocity.z = direction.z * speed;

    gamePlayers[id].position.x += gamePlayers[id].velocity.x * 0.016;
    gamePlayers[id].position.y += gamePlayers[id].velocity.y * 0.016;
    if (gamePlayers[id].position.y <= 0) {
      gamePlayers[id].position.y = 0;
      gamePlayers[id].velocity.y = 0;
    }
    gamePlayers[id].position.z += gamePlayers[id].velocity.z * 0.016;

    const isGoalArea = (gamePlayers[id].position.z > 19.0 || gamePlayers[id].position.z < -19.0) &&
                       (gamePlayers[id].position.x > -4.0 && gamePlayers[id].position.x < 4.0);

    if (!isGoalArea) {
      gamePlayers[id].position.x = Math.max(-14.8, Math.min(14.8, gamePlayers[id].position.x));
      gamePlayers[id].position.z = Math.max(-19.8, Math.min(19.8, gamePlayers[id].position.z));
    } else {
      gamePlayers[id].position.x = Math.max(-3.8, Math.min(3.8, gamePlayers[id].position.x));
      gamePlayers[id].position.z = Math.max(-21.5, Math.min(21.5, gamePlayers[id].position.z));
    }
  });

  handlePlayerPlayerCollisions();
  handleSmoothDribbling();
  handlePortalTeleportation();

  if (Math.abs(gameBall.spin.y) > 0.01) {
    const curveAcceleration = gameBall.spin.y * 0.35;
    gameBall.velocity.x += curveAcceleration * 0.016 * Math.sign(gameBall.velocity.z || 1);
    gameBall.velocity.z -= curveAcceleration * 0.016 * Math.sign(gameBall.velocity.x || 1);
    gameBall.spin.y *= 0.95;
  }

  gameBall.acceleration.x = -0.45 * gameBall.velocity.x;
  gameBall.acceleration.z = -0.45 * gameBall.velocity.z;

  gameBall.velocity.x += gameBall.acceleration.x * 0.016;
  gameBall.velocity.y += gameBall.acceleration.y * 0.016;
  gameBall.velocity.z += gameBall.acceleration.z * 0.016;

  const RADIUS = 0.2;

  gameBall.position.x += gameBall.velocity.x * 0.016;
  gameBall.position.y += gameBall.velocity.y * 0.016;

  if (gameBall.position.y <= RADIUS) {
    gameBall.position.y = RADIUS;
    gameBall.velocity.y = -GRASS_E * gameBall.velocity.y;
    gameBall.velocity.x *= 0.93;
    gameBall.velocity.z *= 0.93;
  }

  gameBall.position.z += gameBall.velocity.z * 0.016;

  if (gameBall.position.z + RADIUS > 20) {
    if (gameBall.position.x - RADIUS > -3.75 && gameBall.position.x + RADIUS < 3.75 && gameBall.position.y < 5.8) {
      if (!gameGoal) scoreGoal(1);
    } else {
      gameBall.position.z = 20 - RADIUS;
      gameBall.velocity.z = -SIDE_E * gameBall.velocity.z;
    }
  } else if (gameBall.position.z - RADIUS < -20) {
    if (gameBall.position.x - RADIUS > -3.75 && gameBall.position.x + RADIUS < 3.75 && gameBall.position.y < 5.8) {
      if (!gameGoal) scoreGoal(0);
    } else {
      gameBall.position.z = -20 + RADIUS;
      gameBall.velocity.z = -SIDE_E * gameBall.velocity.z;
    }
  } else if (gameBall.position.x + RADIUS <= -15) {
    gameBall.position.x = -15 + RADIUS;
    gameBall.velocity.x = -SIDE_E * gameBall.velocity.x;
  } else if (gameBall.position.x - RADIUS >= 15) {
    gameBall.position.x = 15 - RADIUS;
    gameBall.velocity.x = -SIDE_E * gameBall.velocity.x;
  }

  io.emit("tick", gamePlayers, gameBall);
}

startGameEngine();
setInterval(updateGamePhysics, 16);

// =========================================================
// SOCKET.IO COMBINED HANDLER (VIDEO MEET + 3D GAME + GAME CHAT)
// =========================================================
io.on('connection', (socket) => {
  // Live Game Chat broadcast
  socket.on('game_chat_message', (data) => {
    const username = (data && data.username) ? data.username : 'Oyuncu';
    const text = (data && data.text) ? data.text : '';
    if (!text) return;

    console.log(`[Game Chat] ${username}: ${text}`);
    socket.broadcast.emit('game_chat_message', { username, text });
  });

  // --- VIDEO MEET SOCKET EVENTS ---
  socket.emit('activeRoomsUpdate', getActiveRooms());

  socket.on('getRooms', () => {
    socket.emit('activeRoomsUpdate', getActiveRooms());
  });

  socket.on('newUser', (userData) => {
    let peerId = '', roomId = '', nickname = 'Kullanıcı', role = 'speaker';

    if (typeof userData === 'object' && userData !== null) {
      peerId = userData.peerId || '';
      roomId = userData.roomId ? String(userData.roomId).trim() : '';
      nickname = userData.nickname || 'Kullanıcı';
      role = userData.role || 'speaker';
    } else {
      peerId = userData || '';
      roomId = arguments[1] ? String(arguments[1]).trim() : '';
      nickname = 'Kullanıcı';
      role = 'speaker';
    }

    if (!roomId) return;

    if (socket.roomId && socket.roomId !== roomId && roomsMap.has(socket.roomId)) {
      roomsMap.get(socket.roomId).delete(socket.id);
      if (roomsMap.get(socket.roomId).size === 0) {
        roomsMap.delete(socket.roomId);
      }
    }

    socket.roomId = roomId;
    socket.peerId = peerId;
    socket.nickname = nickname;
    socket.role = role;

    socket.join(roomId);

    if (!roomsMap.has(roomId)) {
      roomsMap.set(roomId, new Map());
    }

    roomsMap.get(roomId).set(socket.id, {
      socketId: socket.id,
      peerId,
      nickname,
      role,
      roomId
    });

    console.log(`[Active Room] ${nickname} (${role}) registered in room "${roomId}" (peer: ${peerId})`);

    if (peerId) {
      socket.to(roomId).emit('userJoined', { peerId, nickname, role });
    }

    const currentParticipants = Array.from(roomsMap.get(roomId).values());
    io.to(roomId).emit('roomParticipants', currentParticipants);
    io.emit('activeRoomsUpdate', getActiveRooms());
  });

  // --- 3D MULTIPLAYER GAME SOCKET EVENTS ---
  const team = gameTeams[0].size > gameTeams[1].size ? 1 : 0;
  gameTeams[team].add(socket.id);

  const pos = { x: 0, y: 0, z: 0 };
  const vel = { x: 0, y: 0, z: 0 };
  const look = { x: 0, y: 0, z: 0, w: 1 };

  socket.broadcast.emit("player joined", {
    id: socket.id,
    state: { position: pos, velocity: vel, looking: look },
    team,
    score: gameScore,
  });

  const gameState = {
    position: pos,
    velocity: vel,
    looking: look,
    team,
    input: new Set(),
    health: 100,
    username: "Oyuncu",
    isSpeaking: false
  };
  gamePlayers[socket.id] = gameState;

  socket.emit("start", { id: socket.id, players: gamePlayers, team, score: gameScore });

  // Game PeerJS Voice Chat Registration
  socket.on("peer_register", ({ peerId, username, roomId }) => {
    socket.gamePeerId = peerId;
    socket.gameRoomId = roomId || "saha-1";

    socket.join(`game-${socket.gameRoomId}`);

    const roomSockets = io.sockets.adapter.rooms.get(`game-${socket.gameRoomId}`);
    const existingPeers = [];
    if (roomSockets) {
      roomSockets.forEach(sId => {
        const s = io.sockets.sockets.get(sId);
        if (s && s.gamePeerId && s.id !== socket.id) {
          existingPeers.push({ peerId: s.gamePeerId, socketId: s.id });
        }
      });
    }

    socket.emit("game_peer_list", existingPeers);
    socket.to(`game-${socket.gameRoomId}`).emit("game_peer_joined", { peerId, socketId: socket.id });
  });

  socket.on("set username", (username) => {
    if (gamePlayers[socket.id]) {
      gamePlayers[socket.id].username = username || "Oyuncu";
      socket.broadcast.emit("player joined", {
        id: socket.id,
        state: { position: pos, velocity: vel, looking: look, username: gamePlayers[socket.id].username },
        team,
        score: gameScore,
      });
    }
  });

  socket.on("speaking", (isSpeaking) => {
    if (gamePlayers[socket.id]) {
      gamePlayers[socket.id].isSpeaking = isSpeaking;
      io.emit("speaking_update", { id: socket.id, isSpeaking });
    }
  });

  socket.on("input down", (input) => {
    if (gamePlayers[socket.id]) gamePlayers[socket.id].input.add(input);
  });

  socket.on("input up", (input) => {
    if (gamePlayers[socket.id]) gamePlayers[socket.id].input.delete(input);
  });

  socket.on("set looking", (vector) => {
    if (gamePlayers[socket.id]) gamePlayers[socket.id].looking = vector;
  });

  socket.on("jump", () => {
    if (gamePlayers[socket.id] && gamePlayers[socket.id].position.y === 0) {
      gamePlayers[socket.id].velocity.y = 5;
    }
  });

  socket.on("shoot_hit", (targetId) => {
    if (gamePlayers[targetId] && gamePlayers[socket.id]) {
      if (gamePlayers[socket.id].position.z <= -50 && gamePlayers[targetId].position.z <= -50) {
        gamePlayers[targetId].health = Math.max(0, (gamePlayers[targetId].health || 100) - 4);

        if (gamePlayers[targetId].health === 0) {
          gamePlayers[targetId].health = 100;
          gamePlayers[targetId].position.x = 0;
          gamePlayers[targetId].position.y = 0;
          gamePlayers[targetId].position.z = -100;
        }

        io.emit("health_update", { id: targetId, health: gamePlayers[targetId].health });
      }
    }
  });

  socket.on("kick_action", (data) => {
    if (isCloseToBall(socket.id)) {
      lastKick = socket.id;
      const type = data.type || "boot";
      const power = data.power || 50;
      const normPower = Math.max(10, Math.min(100, power)) / 100;
      const curve = data.curve || 0;

      const direction = { x: 0, y: 0, z: -1 };
      applyQuaternion(direction, gamePlayers[socket.id].looking);

      if (type === "tap") {
        const speed = 6 + normPower * 10;
        direction.y = 0; normalise(direction);
        gameBall.velocity.x = direction.x * speed;
        gameBall.velocity.y = 1.2;
        gameBall.velocity.z = direction.z * speed;
      } else if (type === "through_pass") {
        const speed = 8 + normPower * 12;
        direction.y = 0; normalise(direction);
        gameBall.velocity.x = direction.x * speed;
        gameBall.velocity.y = 0.8;
        gameBall.velocity.z = direction.z * speed;
      } else if (type === "cross") {
        const speed = 10 + normPower * 14;
        normalise(direction);
        gameBall.velocity.x = direction.x * speed;
        gameBall.velocity.y = 7 + normPower * 8;
        gameBall.velocity.z = direction.z * speed;
      } else {
        const speed = 16 + normPower * 24;
        normalise(direction);
        gameBall.velocity.x = direction.x * speed;
        gameBall.velocity.y = (direction.y + 0.3) * speed * 0.55;
        gameBall.velocity.z = direction.z * speed;
      }

      if (curve !== 0) {
        gameBall.spin.y = curve * 18;
      }

      io.emit("action", { id: socket.id, type, power });
    }
  });

  socket.on('disconnect', () => {
    // Video Meet disconnect cleanup
    if (socket.roomId && roomsMap.has(socket.roomId)) {
      const roomParticipants = roomsMap.get(socket.roomId);
      roomParticipants.delete(socket.id);

      socket.to(socket.roomId).emit('userDisconnect', {
        peerId: socket.peerId,
        nickname: socket.nickname
      });

      if (roomParticipants.size === 0) {
        roomsMap.delete(socket.roomId);
      } else {
        io.to(socket.roomId).emit('roomParticipants', Array.from(roomParticipants.values()));
      }

      io.emit('activeRoomsUpdate', getActiveRooms());
    }

    // 3D Game disconnect cleanup
    io.emit("player left", socket.id);
    if (gameTeams[team]) gameTeams[team].delete(socket.id);
    delete gamePlayers[socket.id];
  });
});

// REST API for Mesh Config & Active Rooms
app.get('/api/config', (req, res) => {
  res.json({
    domainName: process.env.DOMAIN_NAME || '',
    activeCloudflareUrl: activeCloudflareUrl || '',
    nodes: meshRegistry.getMeshNodes()
  });
});

app.get('/api/rooms', async (req, res) => {
  const localRooms = getActiveRooms().map(r => ({ ...r, hostNode: process.env.DOMAIN_NAME || 'ogulcan.cfd', isRemote: false }));
  try {
    const peerRooms = await meshRegistry.fetchPeerRooms();
    const roomMap = new Map();
    localRooms.forEach(r => roomMap.set(r.roomId, r));
    peerRooms.forEach(r => {
      if (!roomMap.has(r.roomId)) {
        roomMap.set(r.roomId, r);
      }
    });
    res.json(Array.from(roomMap.values()));
  } catch (e) {
    res.json(localRooms);
  }
});

// Video Meeting Landing Page Route
app.get('/meet', ensureAuthenticated, (req, res) => {
  res.render('indexer', {
    RoomId: uuidv4(),
    user: req.user,
    layout: false
  });
});

// 3D Football Game Page Route
app.get('/game', ensureAuthenticated, (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.sendFile(path.join(__dirname, 'redshoefootball/client/dist/index.html'));
});

// Main & Users Routes
app.use('/', require('./routes/index.js'));
app.use('/users', require('./routes/users.js'));

// Video Meeting Room Route
app.get('/:room', ensureAuthenticated, (req, res, next) => {
//app.get('/:room', (req, res, next) => {
  const reserved = ['login', 'register', 'dashboard', 'users', 'meet', 'game', 'assets', 'peerjs', 'public', 'favicon.ico', 'api'];
  if (reserved.includes(req.params.room.toLowerCase())) {
    return next();
  }
  res.render('classer', {
    RoomId: req.params.room,
    user: req.user,
    layout: false
  });
});

const PORT = 4000;//process.env.PORT || 4000;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT} (Bound to 0.0.0.0)`);
  //startCloudflareTunnel();
});
