// js/webrtc.js

let peer;
let currentCall;
let localStream;
let isConnecting = false;

// Detecta el rol automáticamente leyendo la URL
const peerRole = window.location.pathname.includes('a.html') ? 'a' : 'b';
const myPeerId = peerRole === 'a' ? 'intercom-point-a' : 'intercom-point-b';
const remotePeerId = peerRole === 'a' ? 'intercom-point-b' : 'intercom-point-a';

// Elementos UI
const statusEl = document.getElementById('status');
const audioEl = document.getElementById('remoteAudio');

async function init() {
    try {
        statusEl.innerText = 'Solicitando permisos de micrófono...';

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("getUserMedia no está soportado. Esto suele ocurrir si abres el archivo localmente (browser://) o en HTTP sin SSL. Usa localhost o HTTPS.");
        }

        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });

        statusEl.innerText = 'Micrófono concedido. Conectando al servidor...';

        initializePeer();
    } catch (e) {
        console.error('Error de micrófono:', e);
        statusEl.innerText = 'Error: Necesitas permitir el micrófono y recargar. (' + e.message + ')';
    }
}

function initializePeer() {
    // Nos conectamos a los servidores gratuitos en la nube de PeerJS usando un ID estático
    peer = new Peer(myPeerId, {
        debug: 2
    });

    peer.on('open', (id) => {
        statusEl.innerText = `Servidor conectado. Mi ID: ${id}`;

        if (peerRole === 'a') {
            statusEl.innerText = 'Llamando automáticamente al Punto B...';
            // Empezamos a intentar llamar al Punto B en bucle hasta que conecte
            attemptCall();
        } else {
            statusEl.innerText = 'Esperando conexión del Punto A...';
        }
    });

    // Evento de llamada entrante (Solo debería recibirla el Punto B, pero la agregamos en ambos por seguridad)
    peer.on('call', (call) => {
        statusEl.innerText = 'Llamada entrante detectada. Respondiendo...';
        call.answer(localStream); // Responder automáticamente con nuestro micrófono
        setupCallEventHandlers(call);
    });

    peer.on('disconnected', () => {
        statusEl.innerText = 'Desconectado del servidor de señalización. Reconectando...';
        peer.reconnect();
    });

    peer.on('error', (err) => {
        console.error('Peer error:', err);
        if (err.type === 'peer-unavailable' && peerRole === 'a') {
            // El Punto B aún no está conectado.
            statusEl.innerText = 'El otro punto no está disponible aún. Reintentando...';
            setTimeout(attemptCall, 3000);
        } else if (err.type === 'unavailable-id') {
            statusEl.innerText = 'Error: ID ya en uso. ¿Tienes abierta la misma pestaña doble?';
        }
    });
}

function attemptCall() {
    if (isConnecting || currentCall) return;

    isConnecting = true;
    const call = peer.call(remotePeerId, localStream);

    if (call) {
        setupCallEventHandlers(call);
    } else {
        isConnecting = false;
        setTimeout(attemptCall, 3000); // Reintentar si falló la creación
    }
}

function setupCallEventHandlers(call) {
    currentCall = call;

    call.on('stream', (remoteStream) => {
        isConnecting = false;
        audioEl.srcObject = remoteStream;

        // Políticas de navegadores: requieren interactuar para que suene
        audioEl.play().catch(e => {
            statusEl.innerText = 'Conexión lista. ¡HAZ CLIC EN LA PANTALLA PARA ACTIVAR EL AUDIO!';
            document.body.onclick = () => { audioEl.play(); statusEl.innerText = 'Conectado. Audio en Vivo.'; }
        });

        statusEl.innerText = 'Conectado. Audio en Vivo.';
    });

    call.on('close', () => {
        handleDisconnect();
    });

    call.on('error', (err) => {
        console.error('Call error', err);
        handleDisconnect();
    });
}

function handleDisconnect() {
    statusEl.innerText = 'Llamada finalizada o caída. Reconectando...';
    currentCall = null;
    isConnecting = false;
    audioEl.srcObject = null;

    if (peerRole === 'a') {
        setTimeout(attemptCall, 2000);
    } else {
        statusEl.innerText = 'Esperando conexión del Punto A...';
    }
}

// Iniciar aplicación
window.onload = () => {
    // Si el usuario hace tap en la pantalla, aseguramos que el contexto de audio despierta (iOS Safari)
    document.body.addEventListener('click', () => { if (audioEl.paused) audioEl.play(); }, { once: true });
    init();
};
