// Socket.IO configuration compatible with ngrok / HTTPS / proxies
const socket = io({
    transports: ['polling', 'websocket'],
    extraHeaders: {
        "ngrok-skip-browser-warning": "true"
    }
});

let peer = null;
let myPeerId = null;

// Extract nickname from URL parameter, localStorage or default
const urlParams = new URLSearchParams(window.location.search);
const userNickname = urlParams.get('nickname') || localStorage.getItem('userNickname') || (typeof defaultNickname !== 'undefined' ? defaultNickname : 'Kullanıcı');

let myVideoStream = null;
let userRole = 'listener'; // 'speaker' or 'listener'
let isMicMuted = false;
let isCamOff = true;
let currentFacingMode = 'user'; // 'user' (front) or 'environment' (back)

const videoGrid = document.getElementById('videoDiv') || document.getElementById('video-container');

// Track active participant cards & PeerJS calls
// participantCards: Map<peerId, { wrapperEl, cardEl, videoEl, role, nickname }>
const participantCards = new Map();
const peerCalls = new Map();

document.addEventListener('DOMContentLoaded', () => {
    registerPresence();
    initMediaAndJoin();
    checkAvailableCameras();
});

socket.on('connect', () => {
    console.log("Socket.IO connected:", socket.id);
    registerPresence();
});

function registerPresence() {
    socket.emit('newUser', {
        peerId: myPeerId || '',
        roomId: roomID,
        nickname: userNickname,
        role: userRole
    });
}

function initMediaAndJoin() {
    updateRoleBadge('checking');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setAsListener("Tarayıcınız kamera/mikrofon erişimini desteklemiyor.");
        initPeerJS();
        return;
    }

    // Attempt 1: Video + Audio
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        .then(stream => {
            isCamOff = false;
            setAsSpeaker(stream, true);
            initPeerJS();
        })
        .catch(err => {
            console.warn("Video + Audio failed, trying Audio only:", err);
            // Attempt 2: Audio only
            navigator.mediaDevices.getUserMedia({ audio: true, video: false })
                .then(stream => {
                    isCamOff = true;
                    setAsSpeaker(stream, false);
                    initPeerJS();
                })
                .catch(err2 => {
                    console.warn("Audio failed or no microphone found. Setting role as Listener:", err2);
                    setAsListener("Mikrofon/Kamera algılanamadı veya izin verilmedi. Odaya Dinleyici olarak katıldınız.");
                    initPeerJS();
                });
        });
}

function setAsSpeaker(stream, hasVideo) {
    myVideoStream = stream;
    userRole = 'speaker';
    updateRoleBadge('speaker');

    const msg = hasVideo
        ? "🎤 Kamera/Mikrofon algılandı. Odaya Konuşmacı olarak katıldınız."
        : "🎙️ Mikrofon algılandı (Kamera kapalı/yok). Dilediğiniz zaman 'Kamerayı Aç' butonu ile kameranızı başlatabilirsiniz.";

    showMediaAlert(msg, "success");
    updateCamBtnUI();
    registerPresence();
}

function setAsListener(message) {
    myVideoStream = null;
    userRole = 'listener';
    updateRoleBadge('listener');

    showMediaAlert(`🎧 ${message}`, "warning");
    registerPresence();
}

function updateRoleBadge(role) {
    const badge = document.getElementById('roleBadge');
    if (!badge) return;

    if (role === 'speaker') {
        badge.className = 'badge bg-success fs-6';
        badge.innerHTML = '<i class="fas fa-microphone me-1"></i>Konuşmacı';
    } else if (role === 'listener') {
        badge.className = 'badge bg-warning text-dark fs-6';
        badge.innerHTML = '<i class="fas fa-headphones me-1"></i>Dinleyici';
    } else {
        badge.className = 'badge bg-secondary fs-6';
        badge.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Kontrol ediliyor...';
    }
}

function showMediaAlert(text, type) {
    const alert = document.getElementById('mediaAlert');
    const alertText = document.getElementById('mediaAlertText');
    if (alert && alertText) {
        alertText.textContent = text;
        alert.className = `alert alert-${type} alert-dismissible fade show`;
        alert.classList.remove('d-none');
    }
}

function initPeerJS() {
    const isHttps = location.protocol === 'https:';
    const peerPort = location.port ? parseInt(location.port) : (isHttps ? 443 : 80);

    peer = new Peer(undefined, {
        host: location.hostname,
        port: peerPort,
        path: '/peerjs',
        secure: isHttps
    });

    peer.on('open', id => {
        console.log("PeerJS Connected. ID:", id);
        myPeerId = id;

        // Render self card immediately
        getOrCreateParticipantCard(id, `${userNickname} (Siz)`, userRole, true);
        if (userRole === 'speaker' && myVideoStream) {
            attachRemoteStream(id, myVideoStream, true);
        }

        registerPresence();
    });

    peer.on('error', err => {
        console.error("PeerJS error:", err);
        if (typeof newNotify === 'function') newNotify("Bağlantı uyarısı: " + err.message);
    });

    peer.on('call', call => {
        console.log("Incoming call from peer:", call.peer);
        peerCalls.set(call.peer, call);

        if (userRole === 'speaker' && myVideoStream) {
            call.answer(myVideoStream);
        } else {
            call.answer(); // Answer without local stream
        }

        call.on('stream', remoteStream => {
            console.log("Stream received from incoming call peer:", call.peer);
            attachRemoteStream(call.peer, remoteStream);
        });

        call.on('close', () => {
            removeParticipantCard(call.peer);
        });

        call.on('error', err => {
            console.error("Call error from peer:", call.peer, err);
        });
    });
}

// Socket.IO Events
socket.on('userJoined', ({ peerId, nickname, role }) => {
    const roleText = role === 'speaker' ? 'Konuşmacı' : 'Dinleyici';
    if (typeof newNotify === 'function') {
        newNotify(`${nickname} (${roleText}) odaya katıldı`);
    }

    if (peerId) {
        getOrCreateParticipantCard(peerId, nickname, role, false);

        if (userRole === 'speaker' && myVideoStream && peerId !== myPeerId) {
            callPeer(peerId, nickname, role);
        }
    }
});

socket.on('roomParticipants', participants => {
    renderParticipantsList(participants);

    if (!participants) return;

    participants.forEach(p => {
        if (!p.peerId || p.peerId === myPeerId) return;

        getOrCreateParticipantCard(p.peerId, p.nickname, p.role, false);

        if (userRole === 'speaker' && myVideoStream && p.role === 'speaker' && !peerCalls.has(p.peerId)) {
            callPeer(p.peerId, p.nickname, p.role);
        }
    });
});

socket.on('userDisconnect', ({ peerId, nickname }) => {
    if (typeof newNotify === 'function') {
        newNotify(`${nickname || 'Kullanıcı'} ayrıldı`);
    }
    if (peerId && peerCalls.has(peerId)) {
        try { peerCalls.get(peerId).close(); } catch (e) {}
        peerCalls.delete(peerId);
    }
    if (peerId) {
        removeParticipantCard(peerId);
    }
});

function callPeer(peerId, nickname, role) {
    if (!peer || !myVideoStream || peerCalls.has(peerId)) return;

    console.log("Calling peer:", peerId, nickname);
    const call = peer.call(peerId, myVideoStream);
    peerCalls.set(peerId, call);

    call.on('stream', remoteStream => {
        console.log("Stream received from called peer:", peerId);
        attachRemoteStream(peerId, remoteStream);
    });

    call.on('close', () => {
        removeParticipantCard(peerId);
    });

    call.on('error', err => {
        console.error("Error calling peer:", peerId, err);
    });
}

// Media Control Functions (Mic Toggle, Camera Toggle, Camera Switch)

function toggleMic() {
    if (!myVideoStream) return;
    const audioTracks = myVideoStream.getAudioTracks();
    if (audioTracks.length === 0) return;

    isMicMuted = !isMicMuted;
    audioTracks.forEach(track => track.enabled = !isMicMuted);

    const btn = document.getElementById('toggleMicBtn');
    if (btn) {
        if (isMicMuted) {
            btn.className = 'btn btn-danger btn-sm';
            btn.innerHTML = '<i class="fas fa-microphone-slash me-1"></i> Sesi Aç';
        } else {
            btn.className = 'btn btn-outline-primary btn-sm';
            btn.innerHTML = '<i class="fas fa-microphone me-1"></i> Sesi Kapat';
        }
    }
}

async function toggleCamera() {
    if (!myVideoStream && userRole === 'listener') {
        alert("Konuşmacı yetkisi verilmedi. Mikrofon veya kameranızı etkinleştirip tekrar deneyin.");
        return;
    }

    if (!myVideoStream) {
        myVideoStream = new MediaStream();
    }

    const videoTracks = myVideoStream.getVideoTracks();

    if (videoTracks.length > 0) {
        // Toggle existing video track
        isCamOff = !isCamOff;
        videoTracks.forEach(track => track.enabled = !isCamOff);
        updateCamBtnUI();

        if (myPeerId) {
            attachRemoteStream(myPeerId, myVideoStream, true);
        }
    } else {
        // No video track exists yet, request camera stream
        try {
            const constraints = {
                video: { facingMode: currentFacingMode }
            };
            const camStream = await navigator.mediaDevices.getUserMedia(constraints);
            const newVideoTrack = camStream.getVideoTracks()[0];

            if (newVideoTrack) {
                myVideoStream.addTrack(newVideoTrack);
                isCamOff = false;
                updateCamBtnUI();

                // Replace track on all active peer connections
                replaceVideoTrackOnPeerCalls(newVideoTrack);

                // Update local video element
                if (myPeerId) {
                    attachRemoteStream(myPeerId, myVideoStream, true);
                }

                checkAvailableCameras();
            }
        } catch (err) {
            console.error("Error enabling camera:", err);
            alert("Kamera açılamadı: " + err.message);
        }
    }
}

function updateCamBtnUI() {
    const btn = document.getElementById('toggleCamBtn');
    if (!btn) return;

    if (isCamOff) {
        btn.className = 'btn btn-outline-secondary btn-sm';
        btn.innerHTML = '<i class="fas fa-video-slash me-1"></i> Kamerayı Aç';
    } else {
        btn.className = 'btn btn-primary btn-sm';
        btn.innerHTML = '<i class="fas fa-video me-1"></i> Kamerayı Kapat';
    }
}

async function switchCamera() {
    currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';

    try {
        const constraints = {
            video: { facingMode: { exact: currentFacingMode } }
        };

        let newCamStream;
        try {
            newCamStream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch (e) {
            // Fallback if exact facingMode fails
            newCamStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: currentFacingMode }
            });
        }

        const newVideoTrack = newCamStream.getVideoTracks()[0];

        if (newVideoTrack && myVideoStream) {
            // Stop old video tracks
            myVideoStream.getVideoTracks().forEach(track => {
                track.stop();
                myVideoStream.removeTrack(track);
            });

            // Add new video track
            myVideoStream.addTrack(newVideoTrack);
            isCamOff = false;
            updateCamBtnUI();

            // Replace track on all active peer calls
            replaceVideoTrackOnPeerCalls(newVideoTrack);

            // Update local display
            if (myPeerId) {
                attachRemoteStream(myPeerId, myVideoStream, true);
            }

            if (typeof newNotify === 'function') {
                newNotify(`Kamera değiştirildi: ${currentFacingMode === 'user' ? 'Ön Kamera' : 'Arka Kamera'}`);
            }
        }
    } catch (err) {
        console.error("Camera switch error:", err);
        alert("Kamera değiştirilemedi veya alternatif kamera bulunamadı: " + err.message);
    }
}

async function selectCameraDevice(deviceId) {
    if (!deviceId || !myVideoStream) return;

    try {
        const newCamStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: deviceId } }
        });

        const newVideoTrack = newCamStream.getVideoTracks()[0];

        if (newVideoTrack) {
            myVideoStream.getVideoTracks().forEach(track => {
                track.stop();
                myVideoStream.removeTrack(track);
            });

            myVideoStream.addTrack(newVideoTrack);
            isCamOff = false;
            updateCamBtnUI();

            replaceVideoTrackOnPeerCalls(newVideoTrack);

            if (myPeerId) {
                attachRemoteStream(myPeerId, myVideoStream, true);
            }
        }
    } catch (err) {
        console.error("Select camera device error:", err);
        alert("Seçilen kamera başlatılamadı: " + err.message);
    }
}

function replaceVideoTrackOnPeerCalls(newVideoTrack) {
    peerCalls.forEach((call) => {
        if (call.peerConnection) {
            const senders = call.peerConnection.getSenders();
            const videoSender = senders.find(s => s.track && s.track.kind === 'video');
            if (videoSender) {
                videoSender.replaceTrack(newVideoTrack);
            } else if (typeof call.peerConnection.addTrack === 'function') {
                call.peerConnection.addTrack(newVideoTrack, myVideoStream);
            }
        }
    });
}

function checkAvailableCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;

    navigator.mediaDevices.enumerateDevices().then(devices => {
        const videoDevices = devices.filter(d => d.kind === 'videoinput');
        const switchBtn = document.getElementById('switchCamBtn');
        const cameraSelect = document.getElementById('cameraSelect');

        if (videoDevices.length > 0) {
            if (switchBtn) switchBtn.classList.remove('d-none');
        }

        if (cameraSelect && videoDevices.length > 1) {
            cameraSelect.innerHTML = '';
            videoDevices.forEach((device, index) => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.text = device.label || `Kamera ${index + 1}`;
                cameraSelect.appendChild(option);
            });
            cameraSelect.classList.remove('d-none');
        }
    }).catch(err => console.warn("Error enumerating devices:", err));
}

// UI Rendering Functions

function getOrCreateParticipantCard(peerId, nickname, role, isSelf = false) {
    if (!peerId) return null;

    if (participantCards.has(peerId)) {
        return participantCards.get(peerId);
    }

    const grid = document.getElementById('videoDiv') || document.getElementById('video-container');
    if (!grid) return null;

    const wrapperEl = document.createElement('div');
    wrapperEl.className = 'col-md-6 col-lg-4 video-card-wrapper';
    wrapperEl.id = `card-wrapper-${peerId}`;

    const cardEl = document.createElement('div');
    cardEl.className = 'card bg-dark text-white shadow-sm h-100 overflow-hidden position-relative rounded-3 video-card-container';

    let videoEl = null;

    if (role === 'speaker') {
        videoEl = document.createElement('video');
        videoEl.autoplay = true;
        videoEl.playsInline = true;
        videoEl.className = 'w-100 h-100 object-fit-cover';
        if (isSelf) videoEl.muted = true; // Mute self video

        const placeholder = document.createElement('div');
        placeholder.className = 'position-absolute top-50 start-50 translate-middle text-center text-muted opacity-75';
        placeholder.id = `placeholder-${peerId}`;
        placeholder.innerHTML = `<i class="fas fa-microphone-alt fa-3x mb-2 text-success"></i><p class="small mb-0 fw-semibold text-light">${escapeHtml(nickname)}</p>`;

        const labelEl = document.createElement('div');
        labelEl.className = 'position-absolute bottom-0 start-0 w-100 p-2 bg-dark bg-opacity-75 d-flex justify-content-between align-items-center small';
        labelEl.innerHTML = `
            <span class="text-truncate me-2"><i class="fas fa-microphone text-success me-1"></i><strong>${escapeHtml(nickname)}</strong></span>
            <span class="badge bg-success">Konuşmacı</span>
        `;

        cardEl.appendChild(placeholder);
        cardEl.appendChild(videoEl);
        cardEl.appendChild(labelEl);
    } else {
        // Listener card
        cardEl.className = 'card bg-secondary text-white shadow-sm h-100 d-flex flex-column align-items-center justify-content-center p-4 rounded-3 text-center video-card-container';
        cardEl.innerHTML = `
            <div class="mb-2">
                <i class="fas fa-headphones fa-3x text-warning"></i>
            </div>
            <h6 class="fw-bold mb-1">${escapeHtml(nickname)}</h6>
            <span class="badge bg-dark">Dinleyici</span>
        `;
    }

    wrapperEl.appendChild(cardEl);
    grid.appendChild(wrapperEl);

    const cardData = {
        wrapperEl,
        cardEl,
        videoEl,
        role,
        nickname,
        audioDetectorSetup: false
    };

    participantCards.set(peerId, cardData);

    if (typeof resizeVideos === 'function') {
        try { resizeVideos(); } catch(e) {}
    }

    return cardData;
}

function attachRemoteStream(peerId, stream, isSelf = false) {
    if (!peerId) return;
    const cardData = participantCards.get(peerId);
    if (!cardData) return;

    const hasVideoTracks = stream && stream.getVideoTracks && stream.getVideoTracks().length > 0 && stream.getVideoTracks().some(t => t.enabled);

    if (cardData.videoEl) {
        cardData.videoEl.srcObject = stream;
        cardData.videoEl.play().catch(e => console.warn("Stream play error:", e));

        const placeholder = document.getElementById(`placeholder-${peerId}`);

        if (hasVideoTracks) {
            cardData.videoEl.style.display = 'block';
            if (placeholder) placeholder.style.display = 'none';
        } else {
            // Audio only
            cardData.videoEl.style.display = 'none';
            if (placeholder) {
                placeholder.style.display = 'block';
                placeholder.innerHTML = `
                    <div class="mb-2"><i class="fas fa-microphone-alt fa-3x text-success"></i></div>
                    <p class="fw-bold mb-0 text-light">${escapeHtml(cardData.nickname)}</p>
                    <span class="badge bg-success opacity-75 mt-1">Ses Yayını Aktif</span>
                `;
            }
        }
    }

    // Set up green speaking border detection
    if (!cardData.audioDetectorSetup && stream) {
        cardData.audioDetectorSetup = true;
        setupAudioSpeakingDetector(stream, cardData.cardEl);
    }
}

function removeParticipantCard(peerId) {
    if (peerId && participantCards.has(peerId)) {
        const { wrapperEl } = participantCards.get(peerId);
        if (wrapperEl) wrapperEl.remove();
        participantCards.delete(peerId);
        peerCalls.delete(peerId);
        if (typeof resizeVideos === 'function') {
            try { resizeVideos(); } catch(e) {}
        }
    }
}

function setupAudioSpeakingDetector(stream, cardElement) {
    if (!stream || stream.getAudioTracks().length === 0) return;

    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;

        const audioCtx = new AudioContext();

        // Ensure AudioContext starts
        if (audioCtx.state === 'suspended') {
            const resumeAudio = () => {
                audioCtx.resume();
                document.removeEventListener('click', resumeAudio);
            };
            document.addEventListener('click', resumeAudio);
            audioCtx.resume();
        }

        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        function checkSpeaking() {
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
            }
            const average = sum / dataArray.length;

            // Volume threshold for speaking detection
            if (average > 12) {
                cardElement.classList.add('is-speaking');
            } else {
                cardElement.classList.remove('is-speaking');
            }

            requestAnimationFrame(checkSpeaking);
        }

        checkSpeaking();
    } catch (err) {
        console.warn("Could not setup audio speaking detector:", err);
    }
}

function renderParticipantsList(participants) {
    const listEl = document.getElementById('participantsList');
    const countEl = document.getElementById('participantCount');

    if (countEl) countEl.textContent = participants ? participants.length : 0;
    if (!listEl) return;

    if (!participants || participants.length === 0) {
        listEl.innerHTML = '<li class="list-group-item text-muted small">Oda boş</li>';
        return;
    }

    let html = '';
    participants.forEach(p => {
        const isSpeaker = p.role === 'speaker';
        const icon = isSpeaker ? '<i class="fas fa-microphone text-success me-2"></i>' : '<i class="fas fa-headphones text-warning me-2"></i>';
        const roleBadge = isSpeaker ? '<span class="badge bg-success-subtle text-success border border-success">Konuşmacı</span>' : '<span class="badge bg-warning-subtle text-warning border border-warning">Dinleyici</span>';

        html += `
            <li class="list-group-item d-flex justify-content-between align-items-center py-2 px-0">
                <span class="text-truncate fw-semibold me-2">${icon}${escapeHtml(p.nickname)}</span>
                ${roleBadge}
            </li>
        `;
    });

    listEl.innerHTML = html;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
