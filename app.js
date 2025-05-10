const BOSH_SERVICE = 'https://xmpp.jp:5281/http-bind';
const MUC_SERVICE = 'conference.xmpp.jp'; // Servicio de salas grupales
const connection = new Strophe.Connection(BOSH_SERVICE);

// Variables de estado
let currentUser = '';
let roomJid = '';
let room = null;
let localStream = null;
let peerConnections = {};
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

// Elementos del DOM
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const attachBtn = document.getElementById('attachBtn');
const fileInput = document.getElementById('fileInput');
const recordBtn = document.getElementById('recordBtn');
const startCallBtn = document.getElementById('startCallBtn');
const joinCallBtn = document.getElementById('joinCallBtn');
const endCallBtn = document.getElementById('endCallBtn');
const videoContainer = document.getElementById('videoContainer');
const videoGrid = document.getElementById('videoGrid');
const userList = document.getElementById('userList');

// Conectar al servidor XMPP
function connect() {
    const randomId = Math.floor(Math.random() * 10000);
    currentUser = `user_${randomId}`;
    const jid = `${currentUser}@xmpp.jp`;
    const password = 'password123';
    
    connection.connect(jid, password, (status) => {
        if (status === Strophe.Status.CONNECTED) {
            console.log('Conectado a XMPP');
            addSystemMessage('Conectado al servidor');
            
            // Unirse a una sala grupal
            joinGroupChat();
            
            // Configurar handlers
            connection.addHandler(onMessage, null, 'message', null, null, null);
            
            // Habilitar UI
            sendBtn.disabled = false;
            attachBtn.disabled = false;
            recordBtn.disabled = false;
            startCallBtn.disabled = false;
        } else {
            console.error('Error de conexión');
            addSystemMessage('Error al conectar al servidor');
        }
    });
}

// Unirse a un chat grupal
function joinGroupChat() {
    roomJid = `testroom@${MUC_SERVICE}/${currentUser}`;
    room = new Strophe.MUC(connection);
    
    room.join(roomJid, null, (status) => {
        if (status === Strophe.Status.CONNECTED) {
            addSystemMessage(`Unido a la sala: ${roomJid}`);
            
            // Handler para mensajes grupales
            connection.addHandler(onGroupMessage, null, 'message', 'groupchat');
            
            // Handler para presencia (usuarios entrando/saliendo)
            connection.addHandler(onPresence, null, 'presence');
        }
    });
}

// Manejar mensajes privados
function onMessage(msg) {
    const body = msg.getElementsByTagName('body')[0];
    if (!body) return true;
    
    const text = Strophe.getText(body);
    const from = Strophe.getResourceFromJid(msg.getAttribute('from'));
    
    // Verificar si es un mensaje WebRTC
    try {
        const data = JSON.parse(text);
        if (data.type) {
            handleWebRTCMessage(data, from);
            return true;
        }
    } catch (e) {}
    
    addMessage(from, text);
    return true;
}

// Manejar mensajes grupales
function onGroupMessage(msg) {
    const body = msg.getElementsByTagName('body')[0];
    if (!body) return true;
    
    const text = Strophe.getText(body);
    const from = Strophe.getResourceFromJid(msg.getAttribute('from'));
    
    // Ignorar mensajes propios
    if (from === currentUser) return true;
    
    // Verificar si es multimedia
    if (text.startsWith('data:')) {
        addMediaMessage(from, text);
    } else {
        addMessage(from, text);
    }
    
    return true;
}

// Manejar presencia (usuarios entrando/saliendo)
function onPresence(presence) {
    const from = Strophe.getResourceFromJid(presence.getAttribute('from'));
    const type = presence.getAttribute('type');
    
    if (!type) {
        // Usuario entró
        if (from !== currentUser) {
            addSystemMessage(`${from} se ha unido al chat`);
            updateUserList();
        }
    } else if (type === 'unavailable') {
        // Usuario salió
        addSystemMessage(`${from} ha dejado el chat`);
        updateUserList();
        
        // Limpiar conexión WebRTC si existe
        if (peerConnections[from]) {
            peerConnections[from].close();
            delete peerConnections[from];
            removeVideo(from);
        }
    }
    
    return true;
}

// Actualizar lista de usuarios
function updateUserList() {
    if (!room) return;
    
    userList.innerHTML = '';
    const occupants = room.getOccupants();
    
    occupants.forEach(occupant => {
        const user = Strophe.getResourceFromJid(occupant.jid);
        if (user !== currentUser) {
            const li = document.createElement('li');
            li.textContent = user;
            userList.appendChild(li);
        }
    });
}

// Enviar mensaje
function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;
    
    // Enviar a la sala grupal
    const msg = $msg({to: roomJid, type: 'groupchat'})
        .c('body').t(text);
    
    connection.send(msg.tree());
    addMessage('Yo', text);
    messageInput.value = '';
}

// Enviar archivo multimedia
function sendMediaFile(file) {
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        const mediaData = e.target.result;
        
        // Enviar a la sala grupal
        const msg = $msg({to: roomJid, type: 'groupchat'})
            .c('body').t(mediaData);
        
        connection.send(msg.tree());
        addMediaMessage('Yo', mediaData);
    };
    
    if (file.type.startsWith('image/')) {
        reader.readAsDataURL(file);
    } else if (file.type.startsWith('video/')) {
        reader.readAsDataURL(file);
    } else if (file.type.startsWith('audio/')) {
        reader.readAsDataURL(file);
    }
}

// Grabar y enviar audio
function toggleRecording() {
    if (!isRecording) {
        startRecording();
    } else {
        stopRecording();
    }
}

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        recordedChunks = [];
        
        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) {
                recordedChunks.push(e.data);
            }
        };
        
        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(recordedChunks, { type: 'audio/webm' });
            sendMediaFile(new File([audioBlob], 'audio-message.webm'));
        };
        
        mediaRecorder.start();
        isRecording = true;
        recordBtn.textContent = '⏹️';
        recordBtn.style.color = 'red';
    } catch (error) {
        console.error('Error al grabar:', error);
    }
}

function stopRecording() {
    if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
        isRecording = false;
        recordBtn.textContent = '🎤';
        recordBtn.style.color = '#555';
    }
}

// Añadir mensaje al chat
function addMessage(sender, text) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');
    messageDiv.classList.add(sender === 'Yo' ? 'my-message' : 'other-message');
    messageDiv.innerHTML = `<strong>${sender}:</strong> ${text}`;
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Añadir mensaje multimedia
function addMediaMessage(sender, mediaData) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');
    messageDiv.classList.add(sender === 'Yo' ? 'my-message' : 'other-message');
    
    const mediaDiv = document.createElement('div');
    mediaDiv.classList.add('media-message');
    
    if (mediaData.startsWith('data:image/')) {
        mediaDiv.innerHTML = `<strong>${sender}:</strong><img src="${mediaData}" alt="Imagen">`;
    } else if (mediaData.startsWith('data:video/')) {
        mediaDiv.innerHTML = `<strong>${sender}:</strong><video controls src="${mediaData}"></video>`;
    } else if (mediaData.startsWith('data:audio/')) {
        mediaDiv.innerHTML = `<strong>${sender}:</strong><audio controls src="${mediaData}"></audio>`;
    }
    
    messageDiv.appendChild(mediaDiv);
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Añadir mensaje del sistema
function addSystemMessage(text) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message');
    messageDiv.classList.add('system-message');
    messageDiv.innerHTML = `<em>${text}</em>`;
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// WebRTC - Configuración inicial
async function setupWebRTC() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: true, 
            audio: true 
        });
        
        // Añadir mi propio video
        addVideoStream(currentUser, localStream);
    } catch (error) {
        console.error('Error al acceder a medios:', error);
    }
}

// Iniciar llamada grupal
async function startGroupCall() {
    if (!room) return;
    
    videoContainer.style.display = 'flex';
    startCallBtn.disabled = true;
    joinCallBtn.disabled = true;
    endCallBtn.disabled = false;
    
    const occupants = room.getOccupants();
    occupants.forEach(occupant => {
        const user = Strophe.getResourceFromJid(occupant.jid);
        if (user !== currentUser) {
            initiatePeerConnection(user);
        }
    });
}

// Unirse a llamada existente
async function joinGroupCall() {
    videoContainer.style.display = 'flex';
    startCallBtn.disabled = true;
    joinCallBtn.disabled = true;
    endCallBtn.disabled = false;
    
    // Enviar señal a todos para unirse
    const occupants = room.getOccupants();
    occupants.forEach(occupant => {
        const user = Strophe.getResourceFromJid(occupant.jid);
        if (user !== currentUser) {
            sendWebRTCMessage(user, { type: 'join-request' });
        }
    });
}

// Finalizar llamada
function endGroupCall() {
    // Cerrar todas las conexiones
    Object.keys(peerConnections).forEach(user => {
        peerConnections[user].close();
        delete peerConnections[user];
    });
    
    // Limpiar videos (excepto el local)
    const videos = videoGrid.querySelectorAll('.video-item');
    videos.forEach(video => {
        if (video.id !== `video-${currentUser}`) {
            video.remove();
        }
    });
    
    videoContainer.style.display = 'none';
    startCallBtn.disabled = false;
    joinCallBtn.disabled = false;
    endCallBtn.disabled = true;
}

// Iniciar conexión peer-to-peer
async function initiatePeerConnection(user) {
    if (peerConnections[user]) return;
    
    const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    
    peerConnections[user] = pc;
    
    // Añadir stream local
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });
    
    // Manejar candidatos ICE
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            sendWebRTCMessage(user, {
                type: 'ice-candidate',
                candidate: event.candidate
            });
        }
    };
    
    // Manejar stream remoto
    pc.ontrack = (event) => {
        addVideoStream(user, event.streams[0]);
    };
    
    // Crear oferta
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    sendWebRTCMessage(user, {
        type: 'offer',
        sdp: offer.sdp
    });
}

// Manejar mensajes WebRTC
function handleWebRTCMessage(data, from) {
    if (!peerConnections[from] && data.type !== 'offer' && data.type !== 'join-request') {
        return;
    }
    
    switch (data.type) {
        case 'offer':
            handleOffer(from, data);
            break;
        case 'answer':
            handleAnswer(from, data);
            break;
        case 'ice-candidate':
            handleICECandidate(from, data);
            break;
        case 'join-request':
            initiatePeerConnection(from);
            break;
    }
}

async function handleOffer(from, offer) {
    const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    
    peerConnections[from] = pc;
    
    // Añadir stream local
    localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
    });
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            sendWebRTCMessage(from, {
                type: 'ice-candidate',
                candidate: event.candidate
            });
        }
    };
    
    pc.ontrack = (event) => {
        addVideoStream(from, event.streams[0]);
    };
    
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    
    sendWebRTCMessage(from, {
        type: 'answer',
        sdp: answer.sdp
    });
}

async function handleAnswer(from, answer) {
    const pc = peerConnections[from];
    if (!pc) return;
    
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
}

async function handleICECandidate(from, data) {
    const pc = peerConnections[from];
    if (!pc) return;
    
    try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (e) {
        console.error('Error al añadir candidato ICE:', e);
    }
}

// Enviar mensaje WebRTC
function sendWebRTCMessage(to, data) {
    const msg = $msg({to: `${to}@xmpp.jp`, type: 'chat'})
        .c('body').t(JSON.stringify(data));
    
    connection.send(msg.tree());
}

// Añadir stream de video a la UI
function addVideoStream(userId, stream) {
    // Eliminar si ya existe
    const existingVideo = document.getElementById(`video-${userId}`);
    if (existingVideo) {
        existingVideo.remove();
    }
    
    const videoContainer = document.createElement('div');
    videoContainer.id = `video-${userId}`;
    videoContainer.classList.add('video-item');
    
    const videoElement = document.createElement('video');
    videoElement.autoplay = true;
    videoElement.playsInline = true;
    videoElement.srcObject = stream;
    
    const nameLabel = document.createElement('div');
    nameLabel.classList.add('user-name');
    nameLabel.textContent = userId;
    
    videoContainer.appendChild(videoElement);
    videoContainer.appendChild(nameLabel);
    videoGrid.appendChild(videoContainer);
}

// Eliminar stream de video
function removeVideo(userId) {
    const videoElement = document.getElementById(`video-${userId}`);
    if (videoElement) {
        videoElement.remove();
    }
}

// Event listeners
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendMessage();
});

attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
    if (fileInput.files.length > 0) {
        sendMediaFile(fileInput.files[0]);
        fileInput.value = '';
    }
});

recordBtn.addEventListener('click', toggleRecording);
startCallBtn.addEventListener('click', startGroupCall);
joinCallBtn.addEventListener('click', joinGroupCall);
endCallBtn.addEventListener('click', endGroupCall);

// Inicialización
window.onload = () => {
    connect();
    setupWebRTC();
};