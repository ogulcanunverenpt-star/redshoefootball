const GRAVITY = -10;
const GRASS_E = 0.5;
const SIDE_E = 0.85;
const NET_E = 0.2;

const express = require("express");
const http = require("http");
const path = require("path");
const app = express();
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, { cors: { origin: "*" }});

// Serve compiled client static build files from ../client/dist
app.use(express.static(path.join(__dirname, "../client/dist")));
// Serve talk-to-me frontend app under /talk
app.use("/talk", express.static(path.join(__dirname, "../talk-to-me/frontend")));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` Football Game Server running on http://localhost:${PORT} `);
  console.log(` Serving client static build from ../client/dist       `);
  console.log(`=======================================================`);
});

const ball = {
  position: { x: 0, y: 4, z: -4 },
  velocity: { x: 0, y: 0, z: 0 },
  acceleration: { x: 0, y: GRAVITY, z: 0 },
  spin: { x: 0, y: 0, z: 0 }
};

let goal = false;
let lastKick = null;
const teams = [new Set(), new Set()];
const score = [0, 0];
let timeLeft = 300;
let timerInterval;

function reset() {
  ball.position = { x: 0, y: 4, z: 0 };
  ball.velocity = { x: 0, y: 0, z: 0 };
  ball.acceleration = { x: 0, y: GRAVITY, z: 0 };
  ball.spin = { x: 0, y: 0, z: 0 };
  goal = false;
}

function startGame() {
  reset();

  timerInterval = setInterval(() => {
    timeLeft = timeLeft - 1;
    if (timeLeft === 0) {
      clearInterval(timerInterval);
    }
    io.emit("update clock", timeLeft);
  }, 1000);
}

function scoreGoal(team) {
  goal = true;
  score[team] += 1;
  console.log("GOAL!", score, team, lastKick);
  io.emit("goal", { score, team, scorer: lastKick });

  setTimeout(() => {
    reset();
  }, 3000);
}

const players = {};

function closeEnough(id) {
  if (!players[id]) return false;
  const dx = ball.position.x - players[id].position.x;
  const dz = ball.position.z - players[id].position.z;
  return Math.hypot(dx, dz) < 3.8;
}

startGame();

io.on("connection", (socket) => {
  console.log("a user connected:", socket.id);

  const team = teams[0].size > teams[1].size ? 1 : 0;
  teams[team].add(socket.id);

  const position = { x: 0, y: 0, z: 0};
  const velocity = { x: 0, y: 0, z: 0 };
  const looking = { x: 0, y: 0, z: 0, w: 1 };

  socket.broadcast.emit("player joined", {
    id: socket.id,
    state: { position, velocity, looking },
    team,
    score,
  });

  const state = { position, velocity, looking, team, input: new Set(), health: 100, username: "Oyuncu", isSpeaking: false };
  players[socket.id] = state;

  socket.on("set username", (username) => {
    if (players[socket.id]) {
      players[socket.id].username = username || "Oyuncu";
      socket.broadcast.emit("player joined", {
        id: socket.id,
        state: { position, velocity, looking, username: players[socket.id].username },
        team,
        score,
      });
    }
  });

  socket.on("speaking", (isSpeaking) => {
    if (players[socket.id]) {
      players[socket.id].isSpeaking = isSpeaking;
      io.emit("speaking_update", { id: socket.id, isSpeaking });
    }
  });

  socket.on("voice_audio", (audioData) => {
    socket.broadcast.emit("voice_audio", { id: socket.id, data: audioData });
    if (players[socket.id]) {
      players[socket.id].isSpeaking = true;
      io.emit("speaking_update", { id: socket.id, isSpeaking: true });

      clearTimeout(players[socket.id].speakTimeout);
      players[socket.id].speakTimeout = setTimeout(() => {
        if (players[socket.id]) {
          players[socket.id].isSpeaking = false;
          io.emit("speaking_update", { id: socket.id, isSpeaking: false });
        }
      }, 400);
    }
  });

  socket.emit("start", { id: socket.id, players, team, score });

  socket.on("input down", (input) => {
    if (players[socket.id]) players[socket.id].input.add(input);
  });

  socket.on("input up", (input) => {
    if (players[socket.id]) players[socket.id].input.delete(input);
  });

  socket.on("set looking", (vector) => {
    if (players[socket.id]) players[socket.id].looking = vector;
  });

  socket.on("jump", () => {
    if (players[socket.id] && players[socket.id].position.y === 0) {
      players[socket.id].velocity.y = 5;
    }
  });

  // FPS Combat: 4 health loss per hit in Town mode
  socket.on("shoot_hit", (targetId) => {
    if (players[targetId] && players[socket.id]) {
      if (players[socket.id].position.z <= -50 && players[targetId].position.z <= -50) {
        players[targetId].health = Math.max(0, (players[targetId].health || 100) - 4);
        console.log(`[FPS Combat] Player ${socket.id} hit Player ${targetId}! Health: ${players[targetId].health}`);

        if (players[targetId].health === 0) {
          players[targetId].health = 100;
          players[targetId].position.x = 0;
          players[targetId].position.y = 0;
          players[targetId].position.z = -100;
        }

        io.emit("health_update", { id: targetId, health: players[targetId].health });
      }
    }
  });

  // Action with Power, Type & Curve (Shoot, Pass, Through Pass, Cross)
  socket.on("kick_action", (data) => {
    if (closeEnough(socket.id)) {
      lastKick = socket.id;
      const type = data.type || "boot";
      const power = data.power || 50;
      const normPower = Math.max(10, Math.min(100, power)) / 100;
      const curve = data.curve || 0;

      const direction = { x: 0, y: 0, z: -1 };
      applyQuaternion(direction, players[socket.id].looking);

      if (type === "tap") {
        // Short Pass
        const speed = 6 + normPower * 10;
        direction.y = 0; normalise(direction);
        ball.velocity.x = direction.x * speed;
        ball.velocity.y = 1.2;
        ball.velocity.z = direction.z * speed;
      } else if (type === "through_pass") {
        // Through Pass / Ara Pası
        const speed = 8 + normPower * 12;
        direction.y = 0; normalise(direction);
        ball.velocity.x = direction.x * speed;
        ball.velocity.y = 0.8;
        ball.velocity.z = direction.z * speed;
      } else if (type === "cross") {
        // High Cross / Orta
        const speed = 10 + normPower * 14;
        normalise(direction);
        ball.velocity.x = direction.x * speed;
        ball.velocity.y = 7 + normPower * 8;
        ball.velocity.z = direction.z * speed;
      } else {
        // Power Shoot / Şut
        const speed = 16 + normPower * 24;
        normalise(direction);
        ball.velocity.x = direction.x * speed;
        ball.velocity.y = (direction.y + 0.3) * speed * 0.55;
        ball.velocity.z = direction.z * speed;
      }

      if (curve !== 0) {
        ball.spin.y = curve * 18;
      }

      io.emit("action", { id: socket.id, type, power });
    }
  });

  // Legacy events fallback
  socket.on("tap", () => {
    if (closeEnough(socket.id)) {
      lastKick = socket.id;
      const direction = { x: 0, y: 0, z: -1 };
      applyQuaternion(direction, players[socket.id].looking);
      direction.y = 0; normalise(direction);
      ball.velocity.x = direction.x * 8;
      ball.velocity.y = 1.5;
      ball.velocity.z = direction.z * 8;
      io.emit("action", { id: socket.id, type: "tap", power: 50 });
    }
  });

  socket.on("boot", () => {
    if (closeEnough(socket.id)) {
      lastKick = socket.id;
      const direction = { x: 0, y: 0, z: -1 };
      applyQuaternion(direction, players[socket.id].looking);
      normalise(direction);
      ball.velocity.x = direction.x * 24;
      ball.velocity.y = (direction.y + 0.4) * 18;
      ball.velocity.z = direction.z * 24;
      io.emit("action", { id: socket.id, type: "boot", power: 75 });
    }
  });

  socket.on("disconnect", () => {
    io.emit("player left", socket.id);
    teams[team].delete(socket.id);
    delete players[socket.id];
  });
});

// Express 5 compatible fallback middleware
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "../client/dist/index.html"));
});

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
  const playerIds = Object.keys(players);
  const minDist = 0.95;

  for (let i = 0; i < playerIds.length; i++) {
    for (let j = i + 1; j < playerIds.length; j++) {
      const p1 = players[playerIds[i]];
      const p2 = players[playerIds[j]];
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
  Object.entries(players).forEach(([id, player]) => {
    const dx = ball.position.x - player.position.x;
    const dz = ball.position.z - player.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist < DRIBBLE_DIST && ball.position.y < 2.0) {
      const ballSpeed = Math.hypot(ball.velocity.x, ball.velocity.z);
      if (ballSpeed < 10.0) {
        const dir = { x: 0, y: 0, z: -1 };
        applyQuaternion(dir, player.looking);
        dir.y = 0; normalise(dir);

        ball.velocity.x = player.velocity.x * 1.1 + dir.x * 4.0;
        ball.velocity.z = player.velocity.z * 1.1 + dir.z * 4.0;
      }
    }
  });
}

function handlePortalTeleportation() {
  Object.entries(players).forEach(([id, player]) => {
    // Mavi Portal (Stadium -> Town): Located behind Billboard at (x = 0, z = -28.0)
    const distToBluePortal = Math.hypot(player.position.x - 0, player.position.z - (-28.0));
    if (distToBluePortal < 3.5) {
      player.position.x = 0;
      player.position.y = 0;
      player.position.z = -100.0;
      console.log(`[Portal Teleport SUCCESS] Player ${id} entered Blue Portal -> FPS Town!`);
      return;
    }

    // Pembe Portal (Town -> Stadium): Located inside Town at (x = 0, z = -105.0)
    const distToPinkPortal = Math.hypot(player.position.x - 0, player.position.z - (-105.0));
    if (distToPinkPortal < 3.5) {
      player.position.x = 0;
      player.position.y = 0;
      player.position.z = -25.0;
      console.log(`[Portal Teleport SUCCESS] Player ${id} entered Pink Portal -> Stadium!`);
      return;
    }

    // Boundary Isolation: Block walking across open space between Stadium (z = -25.0) and Town (z = -95.0)
    if (player.position.z < -26.0 && player.position.z > -95.0) {
      if (player.position.z > -60.0) {
        player.position.z = -25.5;
      } else {
        player.position.z = -95.5;
      }
    }
  });
}

function update() {
  // Update Player Movements
  Object.entries(players).forEach(([id, { input, looking }]) => {
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

    players[id].velocity.x = direction.x * speed;
    players[id].velocity.y += GRAVITY * 0.016;
    players[id].velocity.z = direction.z * speed;

    players[id].position.x += players[id].velocity.x * 0.016;
    players[id].position.y += players[id].velocity.y * 0.016;
    if (players[id].position.y <= 0) {
      players[id].position.y = 0;
      players[id].velocity.y = 0;
    }
    players[id].position.z += players[id].velocity.z * 0.016;

    // Strict Field Boundary Clamping: Prevent players from walking outside the pitch into the void
    const isGoalArea = (players[id].position.z > 19.0 || players[id].position.z < -19.0) &&
                       (players[id].position.x > -4.0 && players[id].position.x < 4.0);

    if (!isGoalArea) {
      players[id].position.x = Math.max(-14.8, Math.min(14.8, players[id].position.x));
      players[id].position.z = Math.max(-19.8, Math.min(19.8, players[id].position.z));
    } else {
      players[id].position.x = Math.max(-3.8, Math.min(3.8, players[id].position.x));
      players[id].position.z = Math.max(-21.5, Math.min(21.5, players[id].position.z));
    }
  });

  handlePlayerPlayerCollisions();
  handleSmoothDribbling();
  handlePortalTeleportation();

  if (Math.abs(ball.spin.y) > 0.01) {
    const curveAcceleration = ball.spin.y * 0.35;
    ball.velocity.x += curveAcceleration * 0.016 * Math.sign(ball.velocity.z || 1);
    ball.velocity.z -= curveAcceleration * 0.016 * Math.sign(ball.velocity.x || 1);
    ball.spin.y *= 0.95;
  }

  ball.acceleration.x = -0.45 * ball.velocity.x;
  ball.acceleration.z = -0.45 * ball.velocity.z;

  ball.velocity.x += ball.acceleration.x * 0.016;
  ball.velocity.y += ball.acceleration.y * 0.016;
  ball.velocity.z += ball.acceleration.z * 0.016;

  const RADIUS = 0.2;

  ball.position.x += ball.velocity.x * 0.016;
  ball.position.y += ball.velocity.y * 0.016;

  if (ball.position.y <= RADIUS) {
    ball.position.y = RADIUS;
    ball.velocity.y = -GRASS_E * ball.velocity.y;
    ball.velocity.x *= 0.93;
    ball.velocity.z *= 0.93;
  }

  ball.position.z += ball.velocity.z * 0.016;

  if (ball.position.z + RADIUS > 20) {
    if (ball.position.x - RADIUS > -3.75 && ball.position.x + RADIUS < 3.75 && ball.position.y < 5.8) {
      if (!goal) scoreGoal(1);
    } else {
      ball.position.z = 20 - RADIUS;
      ball.velocity.z = -SIDE_E * ball.velocity.z;
    }
  } else if (ball.position.z - RADIUS < -20) {
    if (ball.position.x - RADIUS > -3.75 && ball.position.x + RADIUS < 3.75 && ball.position.y < 5.8) {
      if (!goal) scoreGoal(0);
    } else {
      ball.position.z = -20 + RADIUS;
      ball.velocity.z = -SIDE_E * ball.velocity.z;
    }
  } else if (ball.position.x + RADIUS <= -15) {
    ball.position.x = -15 + RADIUS;
    ball.velocity.x = -SIDE_E * ball.velocity.x;
  } else if (ball.position.x - RADIUS >= 15) {
    ball.position.x = 15 - RADIUS;
    ball.velocity.x = -SIDE_E * ball.velocity.x;
  }

  io.emit("tick", players, ball);
}

function tick() {
  update();
}

setInterval(tick, 16);
