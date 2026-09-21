// indexer.js - Client script for Decentralized Mesh Lobby
const socket = io({
    transports: ['polling', 'websocket'],
    extraHeaders: {
        "ngrok-skip-browser-warning": "true"
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const savedNickname = localStorage.getItem('userNickname');
    const nicknameInput = document.getElementById('nicknameInput');
    if (savedNickname && nicknameInput && !nicknameInput.value.trim()) {
        nicknameInput.value = savedNickname;
    }

    socket.on('activeRoomsUpdate', (rooms) => {
        fetchActiveRooms();
    });

    fetchActiveRooms();
    // Poll mesh peer rooms every 5 seconds for decentralized discovery
    setInterval(fetchActiveRooms, 5000);
});

function fetchActiveRooms() {
    fetch('/api/rooms', {
        headers: {
            "ngrok-skip-browser-warning": "true"
        }
    })
        .then(res => res.json())
        .then(rooms => renderActiveRooms(rooms))
        .catch(err => console.error("Error fetching mesh rooms:", err));
}

function refreshRooms() {
    socket.emit('getRooms');
    fetchActiveRooms();
}

function renderActiveRooms(rooms) {
    const container = document.getElementById('activeRoomsContainer');
    if (!container) return;

    if (!rooms || rooms.length === 0) {
        container.innerHTML = `
            <div class="col-12">
                <div class="dark-card p-5 text-center rounded-3">
                    <div class="mb-3">
                        <i class="fas fa-door-closed fa-4x text-secondary opacity-50"></i>
                    </div>
                    <h4 class="fw-bold text-white">Şu Anda Ağda Aktif Oda Bulunmuyor</h4>
                    <p class="text-secondary mb-0">Yukarıdaki formu kullanarak yeni bir mesh odası başlatabilirsiniz!</p>
                </div>
            </div>
        `;
        return;
    }

    let html = '';
    rooms.forEach(room => {
        const participantNames = (room.participants || []).map(p => {
            const roleIcon = p.role === 'speaker' ? '🎤' : '🎧';
            return `<span class="badge bg-dark border border-secondary text-light me-1 mb-1">${roleIcon} ${escapeHtml(p.nickname)}</span>`;
        }).join(' ');

        const hostBadge = room.hostNode ? `<span class="badge bg-info text-dark mb-2"><i class="fas fa-server me-1"></i>${escapeHtml(room.hostNode)}</span>` : '<span class="badge bg-success mb-2"><i class="fas fa-home me-1"></i>Lokal Düğüm</span>';

        const nickname = localStorage.getItem('userNickname') || 'Oyuncu';
        const joinUrl = room.isRemote && room.hostNode ? `https://${room.hostNode}/${encodeURIComponent(room.roomId)}?nickname=${encodeURIComponent(nickname)}` : `/${encodeURIComponent(room.roomId)}?nickname=${encodeURIComponent(nickname)}`;

        html += `
            <div class="col-md-6 col-lg-4">
                <div class="dark-card p-4 h-100 d-flex flex-column shadow-sm">
                    <div class="d-flex justify-content-between align-items-start mb-2">
                        <div>
                            <h5 class="fw-bold text-white text-truncate mb-1" title="${escapeHtml(room.roomId)}">
                                <i class="fas fa-users text-success me-2"></i>${escapeHtml(room.roomId)}
                            </h5>
                            ${hostBadge}
                        </div>
                        <span class="badge bg-success rounded-pill px-3 py-2">${room.participantCount} Kişi</span>
                    </div>
                    <div class="mb-3 text-secondary small">
                        <span class="me-2"><i class="fas fa-microphone text-success me-1"></i>${room.speakersCount || 0} Konuşmacı</span>
                        <span><i class="fas fa-headphones text-warning me-1"></i>${room.listenersCount || 0} Dinleyici</span>
                    </div>
                    <div class="mb-4 flex-grow-1">
                        <p class="text-secondary small mb-1 fw-semibold">Katılımcılar:</p>
                        <div>${participantNames || '<span class="text-muted small">Kimse yok</span>'}</div>
                    </div>
                    <a href="${joinUrl}" class="btn btn-success w-100 fw-bold mt-auto text-decoration-none">
                        <i class="fas fa-sign-in-alt me-1"></i> Odaya Katıl
                    </a>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function handleJoinRoom(e) {
    e.preventDefault();
    const nicknameInput = document.getElementById('nicknameInput');
    const roomIdInput = document.getElementById('roomIdInput');

    const nickname = nicknameInput ? nicknameInput.value.trim() : '';
    const roomId = roomIdInput ? roomIdInput.value.trim() : '';

    if (!nickname) {
        alert('Lütfen bir takma ad giriniz.');
        return;
    }
    if (!roomId) {
        alert('Lütfen bir oda adı/ID giriniz.');
        return;
    }

    localStorage.setItem('userNickname', nickname);
    window.location.href = `/${encodeURIComponent(roomId)}?nickname=${encodeURIComponent(nickname)}`;
}

function generateNewRoomId() {
    const roomIdInput = document.getElementById('roomIdInput');
    if (roomIdInput) {
        const randomId = 'room-' + Math.random().toString(36).substring(2, 8);
        roomIdInput.value = randomId;
    }
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
