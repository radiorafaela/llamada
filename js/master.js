// js/master.js

const MASTER_ID = 'l-prompter-radio-master-id';
let peer;
let localStream;
let audioContext;
let masterAnalyser;
const connectedPeers = new Map(); // Store call objects and their UI elements

// HTML Elements
const statusEl = document.getElementById('master-status');
const audioSourceSelect = document.getElementById('audioSource');
const toggleReturnBtn = document.getElementById('toggleReturnBtn');
const reportersGrid = document.getElementById('reportersGrid');
const masterCanvas = document.getElementById('masterVuMeter');

let isReturnMuted = true;

async function init() {
    try {
        // Enforce AudioContext creation on user interaction
        document.body.addEventListener('click', () => {
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                setupMasterVU();
            }
        }, { once: true });

        // Get microphone for the return feed
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

        // Mute tracks by default to prevent unexpected feedback if not ready
        localStream.getAudioTracks().forEach(track => track.enabled = !isReturnMuted);

        setupDeviceSelector();
        initializePeer();
    } catch (e) {
        console.error('Master Init Error:', e);
        statusEl.className = 'status-badge danger';
        statusEl.innerText = 'Error Micrófono';
        alert('La Consola Master requiere permisos de micrófono para enviar el retorno a los móviles. Por favor, recarga y acepta.');
    }
}

async function setupDeviceSelector() {
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');

        audioSourceSelect.innerHTML = '';
        audioInputs.forEach(device => {
            const option = document.createElement('option');
            option.value = device.deviceId;
            option.text = device.label || `Micrófono ${audioSourceSelect.length + 1}`;
            audioSourceSelect.appendChild(option);
        });

        audioSourceSelect.onchange = async () => {
            try {
                const newStream = await navigator.mediaDevices.getUserMedia({
                    audio: { deviceId: { exact: audioSourceSelect.value } }
                });

                // Replace track in localStream
                const oldTrack = localStream.getAudioTracks()[0];
                const newTrack = newStream.getAudioTracks()[0];
                newTrack.enabled = !isReturnMuted;
                localStream.removeTrack(oldTrack);
                localStream.addTrack(newTrack);

                // Notify all connected peers of track replacement using PeerJS trick:
                // We actually need to replace the track on their RTCSenders
                connectedPeers.forEach(({ call }) => {
                    const sender = call.peerConnection.getSenders().find(s => s.track.kind === 'audio');
                    if (sender) sender.replaceTrack(newTrack);
                });
            } catch (err) {
                console.error('Error changing mic:', err);
            }
        };
    } catch (e) {
        console.log("Enumeration blocked", e);
    }
}

function initializePeer() {
    peer = new Peer(MASTER_ID, { debug: 1 });

    peer.on('open', (id) => {
        statusEl.className = 'status-badge success';
        statusEl.innerText = 'Master Online (Escuchando)';
    });

    peer.on('call', (call) => {
        console.log('Incoming call from', call.peer);
        // Answer automatically with the return audio
        call.answer(localStream);
        setupReporterCard(call);
    });

    peer.on('disconnected', () => {
        statusEl.className = 'status-badge danger';
        statusEl.innerText = 'Desconectado. Reconectando...';
        peer.reconnect();
    });

    peer.on('error', (err) => {
        console.error('Master Peer Error:', err);
        if (err.type === 'unavailable-id') {
            statusEl.className = 'status-badge danger';
            statusEl.innerText = 'ERROR: El Master ya está abierto en otra pestaña.';
            alert("No puedes tener dos Consolas Master abiertas al mismo tiempo.");
        }
    });
}

function setupReporterCard(call) {
    const peerId = call.peer;
    const shortName = peerId.split('-')[1] || peerId.substring(0, 6);

    // If already exists, do not duplicate UI, just replace call
    if (connectedPeers.has(peerId)) {
        connectedPeers.get(peerId).call.close();
        document.getElementById(`card-${peerId}`)?.remove();
    }

    // Create UI Card
    const card = document.createElement('div');
    card.className = 'reporter-card glass-panel fade-in';
    card.id = `card-${peerId}`;
    card.innerHTML = `
        <div class="card-header">
            <h3>Movil: ${shortName}</h3>
            <span class="pulse-indicator live" id="live-${peerId}">Conectando</span>
        </div>
        <div class="vu-meter-container">
            <canvas class="vu-meter" id="canvas-${peerId}" width="200" height="20"></canvas>
        </div>
        <div class="controls">
            <input type="range" class="vol-slider" id="vol-${peerId}" min="0" max="1" step="0.05" value="1">
            <button class="mute-btn control-btn danger" id="mute-${peerId}">SILENCIAR</button>
        </div>
        <!-- Hidden Audio Element -->
        <audio id="audio-${peerId}" autoplay></audio>
    `;
    reportersGrid.appendChild(card);

    const audioEl = document.getElementById(`audio-${peerId}`);
    const volSlider = document.getElementById(`vol-${peerId}`);
    const muteBtn = document.getElementById(`mute-${peerId}`);
    const liveTick = document.getElementById(`live-${peerId}`);
    const canvas = document.getElementById(`canvas-${peerId}`);

    let reporterAnalyser = null;
    let isMuted = false;

    // Handle incoming stream
    call.on('stream', (remoteStream) => {
        liveTick.innerText = 'EN EL AIRE';
        audioEl.srcObject = remoteStream;

        // Visualizer Setup via Web Audio API
        if (audioContext && audioContext.state === 'running') {
            const source = audioContext.createMediaStreamSource(remoteStream);
            reporterAnalyser = audioContext.createAnalyser();
            reporterAnalyser.fftSize = 256;
            source.connect(reporterAnalyser);
            drawVU(canvas, reporterAnalyser);
        }
    });

    // Fallbacks and cleanup
    call.on('close', () => removeReporter(peerId, card));
    call.on('error', () => removeReporter(peerId, card));

    // UI Events
    volSlider.oninput = (e) => {
        audioEl.volume = e.target.value;
    };

    muteBtn.onclick = () => {
        isMuted = !isMuted;
        audioEl.muted = isMuted;
        if (isMuted) {
            muteBtn.innerText = 'DESILENCIAR';
            muteBtn.classList.replace('danger', 'success');
            card.classList.add('muted');
        } else {
            muteBtn.innerText = 'SILENCIAR';
            muteBtn.classList.replace('success', 'danger');
            card.classList.remove('muted');
        }
    };

    connectedPeers.set(peerId, { call, card });
}

function removeReporter(peerId, card) {
    if (connectedPeers.has(peerId)) {
        connectedPeers.delete(peerId);
    }
    card.classList.add('fade-out');
    setTimeout(() => card.remove(), 500);
}

// Global Return Mute Button
toggleReturnBtn.onclick = () => {
    isReturnMuted = !isReturnMuted;
    localStream.getAudioTracks().forEach(track => track.enabled = !isReturnMuted);

    if (isReturnMuted) {
        toggleReturnBtn.innerText = 'Retorno: MUTED';
        toggleReturnBtn.className = 'control-btn danger';
    } else {
        toggleReturnBtn.innerText = 'Retorno: EN VIVO (AL AIRE)';
        toggleReturnBtn.className = 'control-btn live-btn';
    }
};

// Canvas VU Meter Drawer
function drawVU(canvas, analyser) {
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function renderFrame() {
        requestAnimationFrame(renderFrame);
        analyser.getByteFrequencyData(dataArray);

        // Get average volume
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) { sum += dataArray[i]; }
        let average = sum / bufferLength;

        // Normalize 0 to 1
        const vol = Math.min(1, average / 100);

        ctx.clearRect(0, 0, width, height);

        // Background
        ctx.fillStyle = '#222';
        ctx.fillRect(0, 0, width, height);

        // Gradient based on volume
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, '#4CAF50'); // Green
        gradient.addColorStop(0.7, '#FFC107'); // Yellow
        gradient.addColorStop(1, '#F44336'); // Red

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width * vol, height);
    }
    renderFrame();
}

function setupMasterVU() {
    if (!audioContext) return;
    const source = audioContext.createMediaStreamSource(localStream);
    masterAnalyser = audioContext.createAnalyser();
    masterAnalyser.fftSize = 256;
    source.connect(masterAnalyser);
    drawVU(masterCanvas, masterAnalyser);
}

window.onload = () => {
    init();
};
