// js/webrtc.js

// Usa STUNs de Google gratuitos para descubrir IPs a través del NAT.
const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] };
let peerConnection;
let localStream;
let iceQueue = [];
let pollingInterval;

// Detecta el rol automáticamente leyendo la URL
const peerRole = window.location.pathname.includes('a.html') ? 'a' : 'b';
// Elementos UI
const statusEl = document.getElementById('status');
const audioEl = document.getElementById('remoteAudio');

async function init() {
    try {
        statusEl.innerText = 'Solicitando permisos de micrófono...';
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

        statusEl.innerText = peerRole === 'a' ? 'Iniciando llamada (Punto A)...' : 'Esperando conexión (Punto B)...';

        createPeerConnection();
        // Empezamos a revisar el servidor cada 2 segundos
        pollingInterval = setInterval(pollSignals, 2000);

        if (peerRole === 'a') {
            // "A" siempre lidera. Enviamos señal de reset para limpiar bugs de sesiones previas en B
            sendSignal({ type: 'reset', timestamp: Date.now() });
            setTimeout(makeCall, 1000);
        }
    } catch (e) {
        console.error('Error de micrófono:', e);
        statusEl.innerText = 'Error: Necesitas permitir el micrófono y recargar.';
    }
}

function createPeerConnection() {
    if (peerConnection) peerConnection.close();

    peerConnection = new RTCPeerConnection(config);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = e => {
        audioEl.srcObject = e.streams[0];

        // Políticas de navegadores: requieren interactuar para que suene
        audioEl.play().catch(e => {
            statusEl.innerText = 'Conexión lista. ¡HAZ CLIC EN LA PANTALLA PARA ACTIVAR EL AUDIO!';
            document.body.onclick = () => { audioEl.play(); statusEl.innerText = 'Conectado. Audio Vivo.'; }
        });

        statusEl.innerText = 'Conectado. Audio Vivo.';
    };

    peerConnection.onicecandidate = e => {
        if (e.candidate) sendSignal({ type: 'candidate', candidate: e.candidate, timestamp: Date.now() });
    };

    peerConnection.oniceconnectionstatechange = () => {
        if (peerConnection.iceConnectionState === 'disconnected' || peerConnection.iceConnectionState === 'failed') {
            statusEl.innerText = 'Conexión perdida. Reconectando...';
            if (peerRole === 'a') {
                createPeerConnection();
                makeCall();
            }
        }
    };
}

async function makeCall() {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    sendSignal({ type: 'offer', offer: offer, timestamp: Date.now() });
}

async function handleSignal(msg) {
    // Evitar procesar mensajes fantasmas de más de 45 segundos
    if (Date.now() - msg.timestamp > 45000) return;

    if (msg.type === 'reset' && peerRole === 'b') {
        createPeerConnection();
    } else if (msg.type === 'offer' && peerRole === 'b') {
        createPeerConnection();
        await peerConnection.setRemoteDescription(msg.offer);
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        sendSignal({ type: 'answer', answer: answer, timestamp: Date.now() });
        processIceQueue();
    } else if (msg.type === 'answer' && peerRole === 'a') {
        try {
            await peerConnection.setRemoteDescription(msg.answer);
            processIceQueue();
        } catch (e) {
            console.log("Ignorando answer duplicado", e);
        }
    } else if (msg.type === 'candidate') {
        if (peerConnection.remoteDescription) {
            peerConnection.addIceCandidate(msg.candidate).catch(e => console.error(e));
        } else {
            iceQueue.push(msg.candidate); // Guardamos IP si llega antes que la oferta
        }
    }
}

function processIceQueue() {
    iceQueue.forEach(c => peerConnection.addIceCandidate(c).catch(e => console.error(e)));
    iceQueue = [];
}

async function sendSignal(data) {
    try {
        await fetch(`signal.php?action=send&sender=${peerRole}`, {
            method: 'POST',
            body: JSON.stringify(data),
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (e) { }
}

async function pollSignals() {
    try {
        const res = await fetch(`signal.php?action=receive&sender=${peerRole}`);
        const messages = await res.json();
        if (messages && messages.length > 0) {
            for (let msg of messages) {
                await handleSignal(msg);
            }
        }
    } catch (e) { }
}

// Iniciar aplicación
window.onload = () => {
    // Si el usuario hace tap en la pantalla, aseguramos que el contexto de audio despierta (iOS Safari)
    document.body.addEventListener('click', () => { if (audioEl.paused) audioEl.play(); }, { once: true });
    init();
};
