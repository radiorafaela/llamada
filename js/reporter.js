// js/reporter.js

const MASTER_ID = 'l-prompter-radio-master-id';
let peer;
let localStream;
let currentCall;
let isConnecting = false;

// Generate a random string to ID this mobile in the central Radio
const myReporterId = 'movil-' + Math.floor(Math.random() * 10000).toString().padStart(4, '0');

// UI Elements
const statusText = document.getElementById('connectionStatus');
const connectionDetail = document.getElementById('connectionDetail');
const indicator = document.getElementById('onAirIndicator');
const audioEl = document.getElementById('returnAudio');
const returnVol = document.getElementById('returnVolume');
const toggleMicBtn = document.getElementById('toggleMicBtn');

let isMicOpen = true;

async function init() {
    try {
        statusText.innerText = 'Iniciando Micrófono...';

        // Mobile-optimized constraints for street reporters
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                sampleRate: 48000
            },
            video: false
        });

        statusText.innerText = 'Buscando Estudio...';
        connectionDetail.innerText = 'Tu ID: ' + myReporterId.split('-')[1];

        initializePeer();
    } catch (e) {
        console.error('Reporter Init Error:', e);
        setUIState('error', 'Error Micrófono', 'La aplicación no tiene permisos. Verifica el candado del navegador.');
    }
}

function initializePeer() {
    peer = new Peer(myReporterId, { debug: 1 });

    peer.on('open', () => {
        attemptCall();
    });

    peer.on('disconnected', () => {
        setUIState('warning', 'Conexión Perdida', 'Reconectando con el servidor PeerJS...');
        peer.reconnect();
    });

    peer.on('error', (err) => {
        console.error('Peer error:', err);
        if (err.type === 'peer-unavailable') {
            setUIState('warning', 'ESPERANDO ESTUDIO', 'El Master de la Radio no está abierto aún. Retentando en 5s...');
            setTimeout(attemptCall, 5000);
        } else {
            setUIState('error', 'Error de Conexión', err.message);
        }
    });

    // In a broadcast context, a reporter shouldn't receive calls, but just in case
    peer.on('call', (call) => {
        call.answer(localStream);
        setupCallEventHandlers(call);
    });
}

function attemptCall() {
    if (isConnecting || currentCall) return;

    isConnecting = true;
    setUIState('warning', 'MARCANDO AL STUDY...', 'Estableciendo P2P con el Master.');

    const call = peer.call(MASTER_ID, localStream);

    if (call) {
        setupCallEventHandlers(call);
    } else {
        isConnecting = false;
        setTimeout(attemptCall, 3000);
    }
}

function setupCallEventHandlers(call) {
    currentCall = call;

    call.on('stream', (remoteStream) => {
        isConnecting = false;
        audioEl.srcObject = remoteStream;

        audioEl.play().then(() => {
            setUIState('live', '¡AL AIRE!', 'Estás transmitiendo en vivo.');
        }).catch(e => {
            setUIState('live', '¡AL AIRE!', 'Toca la pantalla para oir el retorno');
            document.body.onclick = () => audioEl.play();
        });
    });

    call.on('close', handleDisconnect);
    call.on('error', handleDisconnect);
}

function handleDisconnect() {
    setUIState('danger', 'CAÍDOS DEL SISTEMA', 'La llamada se cortó. Volviendo a marcar...');
    currentCall = null;
    isConnecting = false;
    audioEl.srcObject = null;

    setTimeout(attemptCall, 2000);
}

function setUIState(state, mainText, detailText) {
    statusText.innerText = mainText;
    connectionDetail.innerText = detailText;

    indicator.className = 'status-circle ' + state;
    statusText.className = 'status-text ' + state;

    if (state === 'live') {
        indicator.classList.add('pulse');
    } else {
        indicator.classList.remove('pulse');
    }
}

// User Controls
returnVol.oninput = (e) => {
    audioEl.volume = e.target.value;
};

toggleMicBtn.onclick = () => {
    isMicOpen = !isMicOpen;
    localStream.getAudioTracks().forEach(track => track.enabled = isMicOpen);

    if (isMicOpen) {
        toggleMicBtn.innerText = 'MI MICRÓFONO: ABIERTO';
        toggleMicBtn.className = 'big-btn success';
        indicator.querySelector('.icon').innerText = '🎙️';
    } else {
        toggleMicBtn.innerText = 'MI MICRÓFONO: MUTED';
        toggleMicBtn.className = 'big-btn danger';
        indicator.querySelector('.icon').innerText = '🔇';
    }
};

window.onload = () => {
    // Awake audio context
    document.body.addEventListener('click', () => { if (audioEl.paused) audioEl.play(); }, { once: true });
    init();
};
