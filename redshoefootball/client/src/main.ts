import { Game } from "./game";
import { io } from "socket.io-client";
import * as THREE from "three";

declare const Peer: any;

const urlParams = new URLSearchParams(window.location.search);
const defaultServer = window.location.origin;
const customServer = urlParams.get('server') || localStorage.getItem('customServerUrl') || defaultServer;

// Connect Socket.IO directly to HTTP/HTTPS server
const socket = io(customServer, {
  transports: ['polling', 'websocket'],
  extraHeaders: {
    "ngrok-skip-browser-warning": "true"
  }
});

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
    const target = e.target as HTMLElement;
    if (target && (target.tagName === "CANVAS" || target === document.body)) {
      if (!document.pointerLockElement) {
        document.body.requestPointerLock();
      }
    }
  });

  document.addEventListener("mousemove", (e) => {
    const movementX = e.movementX || 0;
    const movementY = e.movementY || 0;

    if (movementX === 0 && movementY === 0) return;

    const sensitivity = 0.0025;
    currentYaw -= movementX * sensitivity;
    currentPitch -= movementY * sensitivity;

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

// --- Action Power Charge System ---
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

  bindPowerButton("btn-circle", "boot");
  bindPowerButton("btn-cross", "tap");
  bindPowerButton("btn-triangle", "through_pass");
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

// PC Keyboard Controls
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

// PC Mouse Controls
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

// =========================================================
// PEERJS VOICE CHAT & SCREEN SHARE ENGINE
// =========================================================

let peer: any = null;
let myPeerId: string | null = null;
let localAudioStream: MediaStream | null = null;
let isGameMicMuted = false;
const peerCalls = new Map<string, any>();

function setupInGameButtons() {
  const micBtn = document.getElementById("game-mic-btn");
  const micIcon = document.getElementById("game-mic-icon");
  const micStatus = document.getElementById("game-mic-status");
  const screenBtn = document.getElementById("game-screenshare-btn");

  if (micBtn) {
    micBtn.style.display = "flex";
    micBtn.addEventListener("click", () => {
      if (!localAudioStream) return;
      isGameMicMuted = !isGameMicMuted;
      localAudioStream.getAudioTracks().forEach(track => track.enabled = !isGameMicMuted);

      if (micStatus) micStatus.textContent = isGameMicMuted ? "Sesi Aç" : "Sesi Kapat";
      if (micIcon) micIcon.className = isGameMicMuted ? "fas fa-microphone-slash" : "fas fa-microphone";
      micBtn.style.borderColor = isGameMicMuted ? "#ff3355" : "#00ff9b";
      micBtn.style.color = isGameMicMuted ? "#ff3355" : "#00ff9b";
    });
  }

  if (screenBtn) {
    screenBtn.style.display = "flex";
  }
}

async function startPeerScreenShare() {
  console.log("Starting Screen Share for Web / Android...");

  if ((window as any).Capacitor && (window as any).Capacitor.isNativePlatform()) {
    try {
      const { ScreenShare } = (window as any).Capacitor.Plugins;
      if (ScreenShare) {
        await ScreenShare.startScreenShare({ rtspUrl: "rtsp://localhost:8554/live" });
        alert("Android Ekran Paylaşımı Servisi Başlatıldı!");
        return;
      }
    } catch (e: any) {
      console.warn("Capacitor ScreenShare plugin error:", e);
      alert("Android Ekran Paylaşımı Başlatılamadı: " + (e.message || e));
      return;
    }
  }

  if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });

      console.log("Web Screen Share stream obtained successfully.");

      const videoElem = document.createElement("video");
      videoElem.srcObject = screenStream;
      videoElem.autoplay = true;
      videoElem.playsInline = true;
      videoElem.muted = true;
      videoElem.play().catch(e => console.warn("Video play error:", e));

      if (activeGame) {
        activeGame.setBillboardElement(0, videoElem);
      }

      peerCalls.forEach((_call, remotePeerId) => {
        if (peer) {
          peer.call(remotePeerId, screenStream, {
            metadata: { type: "screenshare" }
          });
        }
      });

      alert("Ekran Paylaşımı Başlatıldı ve Stadyum Panosuna Yansıtıldı!");

      if (screenStream.getVideoTracks()[0]) {
        screenStream.getVideoTracks()[0].onended = () => {
          console.log("Screen share stopped by user.");
        };
      }

    } catch (err: any) {
      console.error("Screen Share error:", err);
      alert("Ekran Paylaşımı İzni Alınamadı veya İptal Edildi: " + err.message);
    }
  } else {
    if ((window as any).Capacitor) {
      try {
        const { ScreenShare } = (window as any).Capacitor.Plugins;
        if (ScreenShare) {
          await ScreenShare.startScreenShare({ rtspUrl: "rtsp://localhost:8554/live" });
          alert("Android Ekran Paylaşımı Servisi Başlatıldı!");
          return;
        }
      } catch (e) {}
    }
    alert("Cihazınızda / Tarayıcınızda getDisplayMedia desteklenmiyor.");
  }
}

(window as any).startPeerScreenShare = startPeerScreenShare;

function initPeerJSVoiceChat(username: string, roomId: string) {
  socket.emit("set username", username);

  let peerHost = location.hostname;
  let peerPort = location.port ? parseInt(location.port) : (location.protocol === 'https:' ? 443 : 80);
  let peerSecure = location.protocol === 'https:';

  const savedServer = localStorage.getItem('customServerUrl') || urlParams.get('server');
  if (savedServer) {
    try {
      const parsed = new URL(savedServer);
      peerHost = parsed.hostname;
      peerPort = parsed.port ? parseInt(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80);
      peerSecure = parsed.protocol === 'https:';
    } catch (e) {}
  }

  if (typeof Peer !== 'undefined') {
    peer = new Peer(undefined, {
      host: peerHost,
      port: peerPort,
      path: '/peerjs',
      secure: peerSecure,
      pingInterval: 5000
    });

    peer.on('open', (id: string) => {
      console.log("PeerJS Voice Chat Connected. ID:", id);
      myPeerId = id;
      socket.emit("peer_register", { peerId: id, username, roomId });
    });

    peer.on('disconnected', () => {
      console.warn("PeerJS disconnected, attempting reconnect...");
      if (peer) peer.reconnect();
    });

    peer.on('error', (err: any) => {
      console.error("PeerJS error:", err);
    });

    peer.on('call', (call: any) => {
      console.log("Incoming PeerJS call from peer:", call.peer);
      peerCalls.set(call.peer, call);

      const isScreenShare = call.metadata && call.metadata.type === "screenshare";

      if (isScreenShare) {
        call.answer();
      } else if (localAudioStream) {
        call.answer(localAudioStream);
      } else {
        call.answer();
      }

      call.on('stream', (remoteStream: MediaStream) => {
        if (isScreenShare || (remoteStream.getVideoTracks && remoteStream.getVideoTracks().length > 0)) {
          console.log("Remote Screen Share Stream received on Billboard 1!");
          const videoElem = document.createElement("video");
          videoElem.srcObject = remoteStream;
          videoElem.autoplay = true;
          videoElem.playsInline = true;
          videoElem.muted = false;
          videoElem.play().catch(e => console.warn("Remote screen play error:", e));

          if (activeGame) {
            activeGame.setBillboardElement(0, videoElem);
          }
        } else {
          console.log("Remote voice stream received from peer:", call.peer);
          playRemoteAudioStream(call.peer, remoteStream);
        }
      });

      call.on('close', () => {
        removeAudioElement(call.peer);
        peerCalls.delete(call.peer);
      });
    });
  }

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then(stream => {
        localAudioStream = stream;
        console.log("Microphone connected. PeerJS voice chat active.");

        setupAudioSpeakingDetector(stream, (isSpeaking: boolean) => {
          socket.emit("speaking", isSpeaking);
        });
      })
      .catch(err => {
        console.warn("Microphone not found or permission denied. Listening mode active.", err);
      });
  }
}

function callPeerVoice(peerId: string) {
  if (!peer || !localAudioStream || peerCalls.has(peerId) || peerId === myPeerId) return;

  console.log("Calling peer for voice chat:", peerId);
  const call = peer.call(peerId, localAudioStream);
  peerCalls.set(peerId, call);

  call.on('stream', (remoteStream: MediaStream) => {
    console.log("Remote voice stream received from called peer:", peerId);
    playRemoteAudioStream(peerId, remoteStream);
  });

  call.on('close', () => {
    removeAudioElement(peerId);
    peerCalls.delete(peerId);
  });

  call.on('error', (err: any) => {
    console.error("Error calling peer voice:", peerId, err);
  });
}

function playRemoteAudioStream(peerId: string, stream: MediaStream) {
  let audioElem = document.getElementById(`audio-${peerId}`) as HTMLAudioElement;
  if (!audioElem) {
    audioElem = document.createElement("audio");
    audioElem.id = `audio-${peerId}`;
    audioElem.autoplay = true;
    audioElem.setAttribute("playsinline", "true");
    audioElem.controls = false;
    audioElem.style.display = "none";
    document.body.appendChild(audioElem);
  }
  audioElem.srcObject = stream;
  audioElem.muted = false;
  audioElem.volume = 1.0;
  audioElem.play().catch(e => console.warn("Audio play error:", e));
}

function removeAudioElement(peerId: string) {
  const audioElem = document.getElementById(`audio-${peerId}`);
  if (audioElem) audioElem.remove();
}

function setupAudioSpeakingDetector(stream: MediaStream, onSpeakingCallback: (isSpeaking: boolean) => void) {
  if (!stream || stream.getAudioTracks().length === 0) return;

  try {
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;

    const audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') {
      const resumeAudio = () => { audioCtx.resume(); document.removeEventListener('click', resumeAudio); };
      document.addEventListener('click', resumeAudio);
      audioCtx.resume();
    }

    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    let lastSpeaking = false;

    function checkSpeaking() {
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const average = sum / dataArray.length;
      const isSpeaking = average > 12;

      if (isSpeaking !== lastSpeaking) {
        lastSpeaking = isSpeaking;
        onSpeakingCallback(isSpeaking);
      }

      requestAnimationFrame(checkSpeaking);
    }

    checkSpeaking();
  } catch (err) {
    console.warn("Could not setup audio speaking detector:", err);
  }
}

socket.on("game_peer_list", (peers: { peerId: string; socketId: string }[]) => {
  if (!peers) return;
  peers.forEach(p => {
    if (p.peerId && p.peerId !== myPeerId) {
      callPeerVoice(p.peerId);
    }
  });
});

socket.on("game_peer_joined", ({ peerId }) => {
  if (peerId && peerId !== myPeerId) {
    callPeerVoice(peerId);
  }
});

window.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("enter-game-btn");
  const input = document.getElementById("username-input") as HTMLInputElement;
  const serverInput = document.getElementById("serverurl-input") as HTMLInputElement;
  const roomInput = document.getElementById("gameroom-input") as HTMLInputElement;
  const modal = document.getElementById("name-modal");

  const prefilledNickname = urlParams.get('nickname') || localStorage.getItem('userNickname') || "";

  if (input && prefilledNickname) input.value = prefilledNickname;
  if (serverInput) serverInput.value = customServer;

  const startGame = () => {
    const username = input ? input.value.trim() || "Oyuncu" : "Oyuncu";
    const gameRoomId = roomInput ? roomInput.value.trim() || "saha-1" : "saha-1";

    localStorage.setItem('userNickname', username);
    if (modal) modal.style.display = "none";
    setupInGameButtons();

    initPeerJSVoiceChat(username, gameRoomId);
  };

  if (btn) btn.addEventListener("click", startGame);
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") startGame();
    });
  }
});
