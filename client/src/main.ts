import { Game } from "./game";
import { io } from "socket.io-client";
import * as THREE from "three";

// Dynamic socket connection URL for local network / mobile access
const serverHost = window.location.hostname || "localhost";
const socket = io(`https://${serverHost}`);

export interface Quaternion {
  x: number;
  y: number;
  z: number;
  w: number;
}

let activeGame: Game | null = null;
let currentYaw = 0;
let currentPitch = 0;

const keysPressed: { [key: string]: boolean } = {};

function setScores(score: [number, number]) {
  const team1 = document.getElementById("team0");
  const team2 = document.getElementById("team1");

  if (team1 && team2) {
    team1.innerText = score[0].toString();
    team2.innerText = score[1].toString();
  }
}

// --- PC Mouse Look Controls (Pointer Lock & Free Mouse Movement) ---
function setupMouseLookControls() {
  document.body.addEventListener("click", (e) => {
    // Enable Pointer Lock on click if clicking canvas/body
    const target = e.target as HTMLElement;
    if (target && (target.tagName === "CANVAS" || target === document.body)) {
      if (!document.pointerLockElement) {
        document.body.requestPointerLock();
      }
    }
  });

  document.addEventListener("mousemove", (e) => {
    // Rotate camera on mouse movement (PointerLock active or active mouse move)
    const movementX = e.movementX || 0;
    const movementY = e.movementY || 0;

    if (movementX === 0 && movementY === 0) return;

    const sensitivity = 0.0025;
    currentYaw -= movementX * sensitivity;
    currentPitch -= movementY * sensitivity;

    // Limit pitch angle (look up/down limits)
    currentPitch = Math.max(-Math.PI / 2.3, Math.min(Math.PI / 2.3, currentPitch));

    const euler = new THREE.Euler(currentPitch, currentYaw, 0, "YXZ");
    const q = new THREE.Quaternion().setFromEuler(euler);

    socket.emit("set looking", { x: q.x, y: q.y, z: q.z, w: q.w });

    if (activeGame) {
      activeGame.camera.quaternion.copy(q);
    }
  });
}

// --- Left Movement Analog Touch Joystick ---
function setupMoveTouchJoystick() {
  const container = document.getElementById("move-joystick-container");
  const thumb = document.getElementById("move-joystick-thumb");
  if (!container || !thumb) return;

  let activeTouchId: number | null = null;
  let centerX = 0, centerY = 0;
  const maxRadius = 45;

  let activeInputs = new Set<string>();

  const updateJoystick = (clientX: number, clientY: number) => {
    let dx = clientX - centerX;
    let dy = clientY - centerY;
    const distance = Math.hypot(dx, dy);

    if (distance > maxRadius) {
      dx = (dx / distance) * maxRadius;
      dy = (dy / distance) * maxRadius;
    }

    thumb.style.transform = `translate(${dx}px, ${dy}px)`;

    const normX = dx / maxRadius;
    const normY = dy / maxRadius;
    const threshold = 0.22;

    const newInputs = new Set<string>();
    if (normY < -threshold) newInputs.add("forward");
    if (normY > threshold) newInputs.add("backward");
    if (normX < -threshold) newInputs.add("left");
    if (normX > threshold) newInputs.add("right");

    activeInputs.forEach((input) => {
      if (!newInputs.has(input)) {
        socket.emit("input up", input);
      }
    });

    newInputs.forEach((input) => {
      if (!activeInputs.has(input)) {
        socket.emit("input down", input);
      }
    });

    activeInputs = newInputs;
  };

  const handleTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    if (activeTouchId !== null) return;
    const touch = e.changedTouches[0];
    activeTouchId = touch.identifier;

    const rect = container.getBoundingClientRect();
    centerX = rect.left + rect.width / 2;
    centerY = rect.top + rect.height / 2;
    updateJoystick(touch.clientX, touch.clientY);
  };

  const handleTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    if (activeTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === activeTouchId) {
        updateJoystick(e.changedTouches[i].clientX, e.changedTouches[i].clientY);
        break;
      }
    }
  };

  const handleTouchEnd = (e: TouchEvent) => {
    if (activeTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === activeTouchId) {
        activeTouchId = null;
        thumb.style.transform = `translate(0px, 0px)`;

        activeInputs.forEach((input) => {
          socket.emit("input up", input);
        });
        activeInputs.clear();
        break;
      }
    }
  };

  container.addEventListener("touchstart", handleTouchStart, { passive: false });
  window.addEventListener("touchmove", handleTouchMove, { passive: false });
  window.addEventListener("touchend", handleTouchEnd, { passive: false });
  window.addEventListener("touchcancel", handleTouchEnd, { passive: false });
}

// --- Right Camera Angle Touch Joystick ---
function setupCameraTouchJoystick() {
  const container = document.getElementById("camera-joystick-container");
  const thumb = document.getElementById("camera-joystick-thumb");
  if (!container || !thumb) return;

  let activeTouchId: number | null = null;
  let centerX = 0, centerY = 0;
  const maxRadius = 38;

  const updateCameraOrientation = (clientX: number, clientY: number) => {
    let dx = clientX - centerX;
    let dy = clientY - centerY;
    const distance = Math.hypot(dx, dy);

    if (distance > maxRadius) {
      dx = (dx / distance) * maxRadius;
      dy = (dy / distance) * maxRadius;
    }

    thumb.style.transform = `translate(${dx}px, ${dy}px)`;

    const speed = 0.035;
    currentYaw -= (dx / maxRadius) * speed;
    currentPitch -= (dy / maxRadius) * speed;

    currentPitch = Math.max(-Math.PI / 2.3, Math.min(Math.PI / 2.3, currentPitch));

    const euler = new THREE.Euler(currentPitch, currentYaw, 0, "YXZ");
    const q = new THREE.Quaternion().setFromEuler(euler);

    socket.emit("set looking", { x: q.x, y: q.y, z: q.z, w: q.w });

    if (activeGame) {
      activeGame.camera.quaternion.copy(q);
    }
  };

  const handleTouchStart = (e: TouchEvent) => {
    e.preventDefault();
    if (activeTouchId !== null) return;
    const touch = e.changedTouches[0];
    activeTouchId = touch.identifier;

    const rect = container.getBoundingClientRect();
    centerX = rect.left + rect.width / 2;
    centerY = rect.top + rect.height / 2;
    updateCameraOrientation(touch.clientX, touch.clientY);
  };

  const handleTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    if (activeTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === activeTouchId) {
        updateCameraOrientation(e.changedTouches[i].clientX, e.changedTouches[i].clientY);
        break;
      }
    }
  };

  const handleTouchEnd = (e: TouchEvent) => {
    if (activeTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === activeTouchId) {
        activeTouchId = null;
        thumb.style.transform = `translate(0px, 0px)`;
        break;
      }
    }
  };

  container.addEventListener("touchstart", handleTouchStart, { passive: false });
  window.addEventListener("touchmove", handleTouchMove, { passive: false });
  window.addEventListener("touchend", handleTouchEnd, { passive: false });
  window.addEventListener("touchcancel", handleTouchEnd, { passive: false });
}

// --- Action Power Charge System (Hold Mouse Left/Right Click or Touch Buttons) ---
let powerChargeTimer: number | null = null;
let currentActionPower = 0;
let activeActionType: string | null = null;

function startActionCharging(actionType: string) {
  if (powerChargeTimer !== null) return;

  activeActionType = actionType;
  currentActionPower = 0;

  const powerMeterContainer = document.getElementById("power-meter-container");
  const powerMeterBar = document.getElementById("power-meter-bar");

  if (powerMeterContainer) powerMeterContainer.style.display = "block";
  if (powerMeterBar) powerMeterBar.style.width = "0%";

  powerChargeTimer = window.setInterval(() => {
    currentActionPower += 4.5;
    if (currentActionPower > 100) currentActionPower = 100;

    if (powerMeterBar) powerMeterBar.style.width = `${currentActionPower}%`;

    if (activeGame && activeActionType) {
      activeGame.updateTrajectoryLine(
        activeActionType,
        currentActionPower,
        0,
        -1
      );
    }
  }, 25);
}

function releaseAndExecuteAction(actionType: string) {
  if (powerChargeTimer !== null) {
    clearInterval(powerChargeTimer);
    powerChargeTimer = null;
  }

  const powerMeterContainer = document.getElementById("power-meter-container");
  if (powerMeterContainer) powerMeterContainer.style.display = "none";

  socket.emit("kick_action", {
    type: actionType,
    power: Math.max(20, currentActionPower),
    curve: 0
  });

  if (activeGame) {
    activeGame.hideTrajectoryLine();
  }

  currentActionPower = 0;
  activeActionType = null;
}

// --- PlayStation Touch Action Buttons Setup ---
function setupPlayStationActionButtons() {
  const bindPowerButton = (btnId: string, actionType: string) => {
    const el = document.getElementById(btnId);
    if (!el) return;

    const onStart = (e: Event) => {
      e.preventDefault();
      startActionCharging(actionType);
    };

    const onEnd = (e: Event) => {
      e.preventDefault();
      releaseAndExecuteAction(actionType);
    };

    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: false });
    el.addEventListener("mousedown", onStart);
    el.addEventListener("mouseup", onEnd);
  };

  // ◯ Circle (Red) = ŞUT (Shoot / Boot)
  bindPowerButton("btn-circle", "boot");

  // ✖ Cross (Blue) = PAS (Short Pass / Tap)
  bindPowerButton("btn-cross", "tap");

  // Δ Triangle (Green) = ARA PAS (Through Pass)
  bindPowerButton("btn-triangle", "through_pass");

  // ▢ Square (Pink) = ORTA (High Cross)
  bindPowerButton("btn-square", "cross");
}

socket.on("start", ({ id, players, score, team }) => {
  setScores(score);

  const scoreElement = document.getElementById(`team${team}`);
  if (scoreElement) {
    scoreElement.style.color = "yellow";
  }

  console.log("Game started:", id, players);
  activeGame = new Game(id, players, (quaternion: Quaternion) => {
    socket.emit("set looking", quaternion);
  });

  setupMouseLookControls();
  setupMoveTouchJoystick();
  setupCameraTouchJoystick();
  setupPlayStationActionButtons();

  socket.on("update clock", (time) => {
    const element = document.getElementById("timer");
    if (element) {
      const mins = Math.floor(time / 60);
      const sec = time % 60;
      element.innerText = `${mins}m${sec}`;
    }
  });

  socket.on("player joined", ({ id, state: { position, username }, team }) => {
    if (activeGame) activeGame.playerJoined(id, position, team, username);
  });

  socket.on("player left", (id) => {
    if (activeGame) activeGame.playerLeft(id);
  });

  socket.on("action", ({ id, type }) => {
    if (activeGame) activeGame.playAction(id, type);
  });

  socket.on("speaking_update", ({ id, isSpeaking }) => {
    if (activeGame) activeGame.setPlayerSpeaking(id, isSpeaking);
  });

  socket.on("goal", ({ score }) => {
    setScores(score);
    const goalElement = document.getElementById("goal");
    if (goalElement) {
      goalElement.style.visibility = "visible";
      setTimeout(() => (goalElement.style.visibility = "hidden"), 5000);
    }
  });

  socket.on("tick", (players, ball) => {
    if (activeGame) activeGame.tick(players, ball);
  });
});

// PC Keyboard Controls: WASD for Movement
document.addEventListener("keydown", (e) => {
  const key = e.key;
  keysPressed[key] = true;

  switch (key) {
    case "w":
    case "W":
    case "ArrowUp":
      socket.emit("input down", "forward");
      break;

    case "a":
    case "A":
    case "ArrowLeft":
      socket.emit("input down", "left");
      break;

    case "s":
    case "S":
    case "ArrowDown":
      socket.emit("input down", "backward");
      break;

    case "d":
    case "D":
    case "ArrowRight":
      socket.emit("input down", "right");
      break;

    case "Shift":
      socket.emit("input down", "sprint");
      break;

    case " ":
      socket.emit("jump");
      break;
  }
});

document.addEventListener("keyup", (e) => {
  const key = e.key;
  keysPressed[key] = false;

  switch (key) {
    case "w":
    case "W":
    case "ArrowUp":
      socket.emit("input up", "forward");
      break;

    case "a":
    case "A":
    case "ArrowLeft":
      socket.emit("input up", "left");
      break;

    case "s":
    case "S":
    case "ArrowDown":
      socket.emit("input up", "backward");
      break;

    case "d":
    case "D":
    case "ArrowRight":
      socket.emit("input up", "right");
      break;

    case "Shift":
      socket.emit("input up", "sprint");
      break;
  }
});

// PC Mouse Controls: Sol Tık = ŞUT (Shoot), Sağ Tık = PAS (Pass) with Power Meter Charging
document.addEventListener("mousedown", (e) => {
  const target = e.target as HTMLElement;
  if (target && target.closest("#mobile-controls")) return;

  if (e.button === 0) {
    startActionCharging("boot");
  } else if (e.button === 2) {
    startActionCharging("tap");
  }
});

document.addEventListener("mouseup", (e) => {
  const target = e.target as HTMLElement;
  if (target && target.closest("#mobile-controls")) return;

  if (e.button === 0) {
    releaseAndExecuteAction("boot");
  } else if (e.button === 2) {
    releaseAndExecuteAction("tap");
  }
});

document.addEventListener("contextmenu", (event) => event.preventDefault());

async function initAudioChat(username: string) {
  socket.emit("set username", username);

  const playbackCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

  document.addEventListener("click", () => {
    if (playbackCtx.state === "suspended") {
      playbackCtx.resume();
    }
  });

  socket.on("voice_audio", ({ data }) => {
    try {
      if (playbackCtx.state === "suspended") {
        playbackCtx.resume();
      }
      const float32Array = new Float32Array(data);
      const buffer = playbackCtx.createBuffer(1, float32Array.length, playbackCtx.sampleRate);
      buffer.getChannelData(0).set(float32Array);

      const sourceNode = playbackCtx.createBufferSource();
      sourceNode.buffer = buffer;
      sourceNode.connect(playbackCtx.destination);
      sourceNode.start();
    } catch (e) {
      console.error("Audio playback error:", e);
    }
  });

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    console.log("Microphone connected. Voice chat active.");

    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    const source = audioCtx.createMediaStreamSource(stream);

    const processor = audioCtx.createScriptProcessor(2048, 1, 1);
    const silentGain = audioCtx.createGain();
    silentGain.gain.value = 0;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let lastSpeaking = false;

    setInterval(() => {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length;
      const isSpeaking = avg > 8; // Lowered threshold for speech detection

      if (isSpeaking !== lastSpeaking) {
        lastSpeaking = isSpeaking;
        socket.emit("speaking", isSpeaking);
      }
    }, 200);

    processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < inputData.length; i++) {
        sum += inputData[i] * inputData[i];
      }
      const rms = Math.sqrt(sum / inputData.length);

      if (rms > 0.003) { // Lowered RMS threshold for transmitting audio
        const pcmBuffer = new Float32Array(inputData);
        socket.emit("voice_audio", pcmBuffer.buffer);
      }
    };

    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(audioCtx.destination);

  } catch (err) {
    console.log("No microphone or permission denied. Operating in Listen-Only mode.", err);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("enter-game-btn");
  const input = document.getElementById("username-input") as HTMLInputElement;
  const modal = document.getElementById("name-modal");

  const startGame = () => {
    const username = input ? input.value.trim() || "Oyuncu" : "Oyuncu";
    if (modal) modal.style.display = "none";
    initAudioChat(username);
  };

  if (btn) btn.addEventListener("click", startGame);
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") startGame();
    });
  }
});
