import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

// COLOQUE SUAS CHAVES AQUI
const supabaseUrl = 'https://wxtywhqmhvhuygcuzaqy.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind4dHl3aHFtaHZodXlnY3V6YXF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0MjQ1MTUsImV4cCI6MjEwODAwMDUxNX0.-mlQ1uowx0CW1a5NcYYzH8LRWIwDVrEgAL_O3_xocB8';
const supabase = createClient(supabaseUrl, supabaseKey);

const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const videoGrid = document.getElementById('video-grid');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const callContainer = document.getElementById('call-container');

let currentUser = null;
let peer = null;
let myPeerId = null;
let localStream = null;
let activeTextChannelId = null;
let activeVoiceChannelId = null;
let activeCalls = {};

// Configuração de áudio otimizada para evitar cortes
const audioConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
};

// --- AUTENTICAÇÃO ---
let isLoginMode = true;
document.getElementById('toggle-auth').addEventListener('click', () => {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title').innerText = isLoginMode ? 'Entrar no WebCord' : 'Criar Conta';
    document.getElementById('auth-btn').innerText = isLoginMode ? 'Entrar' : 'Registrar';
    document.getElementById('toggle-auth').innerText = isLoginMode ? 'Precisa de conta? Registre-se' : 'Já tem conta? Entre';
    document.getElementById('auth-name').classList.toggle('hidden', isLoginMode);
});

document.getElementById('auth-btn').addEventListener('click', async () => {
    const email = document.getElementById('auth-email').value;
    const pass = document.getElementById('auth-pass').value;
    const name = document.getElementById('auth-name').value;
    if (isLoginMode) {
        await supabase.auth.signInWithPassword({ email, password: pass });
        window.location.reload();
    } else {
        await supabase.auth.signUp({ email, password: pass, options: { data: { full_name: name, avatar_url: `https://api.dicebear.com/7.x/identicon/svg?seed=${email}` } } });
        alert('Conta criada! Faça o login.');
    }
});

async function initApp() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        currentUser = session.user;
        loginScreen.classList.add('hidden');
        appScreen.classList.remove('hidden');
        document.getElementById('user-name').innerText = currentUser.user_metadata.full_name;
        document.getElementById('user-avatar').src = currentUser.user_metadata.avatar_url;
        
        // Copiar ID consertado
        document.getElementById('copy-id-area').addEventListener('click', () => {
            if(myPeerId) {
                navigator.clipboard.writeText(myPeerId);
                alert('Sua ID foi copiada: ' + myPeerId);
            }
        });

        initPeer();
        loadChannels();
        subscribeToChannels();
        subscribeToPresence();
    }
}
initApp();

document.getElementById('logout-btn').addEventListener('click', async () => {
    await leaveVoiceChannel();
    await supabase.auth.signOut();
    window.location.reload();
});

// --- PEER JS ---
function initPeer() {
    peer = new Peer();
    peer.on('open', id => {
        myPeerId = id;
        document.getElementById('my-peer-id').innerText = "Online";
    });

    peer.on('call', call => {
        call.answer(localStream);
        call.on('stream', remoteStream => addVideoStream(remoteStream, call.peer));
        call.on('close', () => removeVideoStream(call.peer));
        activeCalls[call.peer] = call;
    });
}

// --- CRUD DE CANAIS ---
window.openChannelModal = (type, id = '', name = '') => {
    document.getElementById('modal-channel-type').value = type;
    document.getElementById('modal-channel-id').value = id;
    document.getElementById('modal-channel-name').value = name;
    document.getElementById('modal-title').innerText = id ? 'Editar Canal' : 'Criar Canal';
    document.getElementById('channel-modal').classList.remove('hidden');
};

document.getElementById('close-modal').addEventListener('click', () => {
    document.getElementById('channel-modal').classList.add('hidden');
});

document.getElementById('save-channel').addEventListener('click', async () => {
    const name = document.getElementById('modal-channel-name').value;
    const type = document.getElementById('modal-channel-type').value;
    const id = document.getElementById('modal-channel-id').value;
    
    if (!name) return;
    
    if (id) {
        await supabase.from('channels').update({ name }).eq('id', id);
    } else {
        await supabase.from('channels').insert([{ name, type }]);
    }
    document.getElementById('channel-modal').classList.add('hidden');
    loadChannels();
});

window.deleteChannel = async (id) => {
    if(confirm('Tem certeza que deseja apagar este canal?')) {
        await supabase.from('channels').delete().eq('id', id);
        loadChannels();
    }
}

function subscribeToChannels() {
    supabase.channel('channels').on('postgres_changes', { event: '*', schema: 'public', table: 'channels' }, loadChannels).subscribe();
}

async function loadChannels() {
    const { data: channels } = await supabase.from('channels').select('*').order('name');
    const { data: presence } = await supabase.from('voice_presence').select('*');

    const textList = document.getElementById('text-channels-list');
    const voiceList = document.getElementById('voice-channels-list');
    textList.innerHTML = ''; voiceList.innerHTML = '';

    if(!channels) return;

    channels.forEach(ch => {
        const div = document.createElement('div');
        div.className = "channel-hover px-2 py-1 text-gray-400 hover:bg-discord-chat hover:text-gray-300 rounded flex justify-between items-center mb-1 group transition";
        
        if (ch.type === 'text') {
            div.innerHTML = `
                <div class="flex items-center gap-2 cursor-pointer w-full font-medium" onclick="joinTextChannel('${ch.id}', '${ch.name}')">
                    <span class="text-gray-400 text-lg">#</span> ${ch.name}
                </div>
                <div class="channel-actions hidden gap-2">
                    <button onclick="openChannelModal('text', '${ch.id}', '${ch.name}')" class="hover:text-discord-blurple">⚙️</button>
                    <button onclick="deleteChannel('${ch.id}')" class="hover:text-red-500">🗑️</button>
                </div>
            `;
            textList.appendChild(div);
            if (!activeTextChannelId) joinTextChannel(ch.id, ch.name);
        } else {
            const usersInChannel = presence ? presence.filter(p => p.channel_id === ch.id) : [];
            let usersHTML = usersInChannel.map(u => `
                <div class="flex items-center gap-2 pl-6 mt-1 text-xs text-gray-300 font-medium">
                    <img src="${u.user_avatar}" class="w-5 h-5 rounded-full"> ${u.user_name}
                </div>
            `).join('');

            div.innerHTML = `
                <div class="flex items-center gap-2 cursor-pointer w-full font-medium" onclick="joinVoiceChannel('${ch.id}')">
                    🔊 ${ch.name}
                </div>
                <div class="channel-actions hidden gap-2">
                    <button onclick="openChannelModal('voice', '${ch.id}', '${ch.name}')" class="hover:text-discord-blurple">⚙️</button>
                    <button onclick="deleteChannel('${ch.id}')" class="hover:text-red-500">🗑️</button>
                </div>
            `;
            const wrapper = document.createElement('div');
            wrapper.appendChild(div);
            if(usersHTML) wrapper.insertAdjacentHTML('beforeend', usersHTML);
            voiceList.appendChild(wrapper);
        }
    });
}

// --- LÓGICA DE TEXTO ---
window.joinTextChannel = (id, name) => {
    activeTextChannelId = id;
    document.getElementById('current-channel-title').innerText = name;
    loadChatMessages();
}

async function loadChatMessages() {
    const { data: messages } = await supabase.from('messages').select('*').eq('channel', activeTextChannelId).order('created_at', { ascending: true }).limit(50);
    messagesDiv.innerHTML = '';
    if (messages) messages.forEach(renderMessage);
}

// --- LÓGICA DE VOZ E TELA ---
window.joinVoiceChannel = async (channelId) => {
    if (activeVoiceChannelId === channelId) return;
    await leaveVoiceChannel();
    
    activeVoiceChannelId = channelId;
    document.getElementById('voice-controls').classList.remove('hidden');
    callContainer.classList.remove('hidden');

    // Liga câmara e microfone com melhor qualidade
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: audioConstraints });
    addVideoStream(localStream, 'local', true);

    await supabase.from('voice_presence').insert([{
        channel_id: channelId, peer_id: myPeerId,
        user_name: currentUser.user_metadata.full_name,
        user_avatar: currentUser.user_metadata.avatar_url
    }]);

    const { data: others } = await supabase.from('voice_presence').select('*').eq('channel_id', channelId).neq('peer_id', myPeerId);
    if (others) {
        others.forEach(person => {
            const call = peer.call(person.peer_id, localStream);
            call.on('stream', remoteStream => addVideoStream(remoteStream, person.peer_id));
            call.on('close', () => removeVideoStream(person.peer_id));
            activeCalls[person.peer_id] = call;
        });
    }
    loadChannels();
}

document.getElementById('disconnect-voice').addEventListener('click', leaveVoiceChannel);

async function leaveVoiceChannel() {
    if (!activeVoiceChannelId) return;
    await supabase.from('voice_presence').delete().eq('peer_id', myPeerId);
    
    Object.values(activeCalls).forEach(call => call.close());
    activeCalls = {};
    
    if(localStream) localStream.getTracks().forEach(track => track.stop());
    videoGrid.innerHTML = '';
    
    activeVoiceChannelId = null;
    document.getElementById('voice-controls').classList.add('hidden');
    callContainer.classList.add('hidden');
    loadChannels();
}

function subscribeToPresence() {
    supabase.channel('presence').on('postgres_changes', { event: '*', schema: 'public', table: 'voice_presence' }, loadChannels).subscribe();
}

// Renderiza vídeo e permite Tela Cheia com Duplo Clique
function addVideoStream(stream, peerId, isLocal = false) {
    if(document.getElementById(`video-${peerId}`)) return;
    const video = document.createElement('video');
    video.id = `video-${peerId}`;
    video.srcObject = stream;
    video.autoplay = true; 
    video.playsInline = true;
    video.title = "Duplo clique para Tela Cheia";
    video.className = "w-full max-w-[450px] h-[300px] rounded-lg bg-discord-servers shadow-lg object-cover border border-discord-channels cursor-pointer hover:ring-2 hover:ring-discord-blurple transition";
    
    if(isLocal) video.muted = true;
    
    // TELA CHEIA (FULLSCREEN) COM DUPLO CLIQUE
    video.addEventListener('dblclick', () => {
        if (video.requestFullscreen) {
            video.requestFullscreen();
        } else if (video.webkitRequestFullscreen) { /* Safari */
            video.webkitRequestFullscreen();
        } else if (video.msRequestFullscreen) { /* IE11 */
            video.msRequestFullscreen();
        }
    });

    videoGrid.append(video);
}

function removeVideoStream(peerId) {
    const video = document.getElementById(`video-${peerId}`);
    if(video) video.remove();
}

// Compartilhamento de tela com Áudio embutido
document.getElementById('share-screen').addEventListener('click', async () => {
    try {
        // Pede vídeo e áudio do sistema
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        const screenVideoTrack = screenStream.getVideoTracks()[0];
        const screenAudioTrack = screenStream.getAudioTracks()[0]; // Pode ser nulo se o usuário não marcar a caixa
        
        Object.values(activeCalls).forEach(call => {
            const videoSender = call.peerConnection.getSenders().find(s => s.track.kind === 'video');
            if(videoSender && screenVideoTrack) videoSender.replaceTrack(screenVideoTrack);
            
            // Se a tela tiver áudio, substitui o microfone pelo áudio do PC
            const audioSender = call.peerConnection.getSenders().find(s => s.track.kind === 'audio');
            if(audioSender && screenAudioTrack) audioSender.replaceTrack(screenAudioTrack);
        });

        const localVideo = document.getElementById('video-local');
        if(localVideo) {
            localVideo.srcObject = screenStream;
            localVideo.classList.replace('object-cover', 'object-contain');
        }

        // Ao encerrar o compartilhamento, volta para a Webcam e Microfone
        screenVideoTrack.onended = async () => { 
            const camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: audioConstraints });
            const camVideoTrack = camStream.getVideoTracks()[0];
            const camAudioTrack = camStream.getAudioTracks()[0];

            Object.values(activeCalls).forEach(call => {
                const videoSender = call.peerConnection.getSenders().find(s => s.track.kind === 'video');
                if(videoSender && camVideoTrack) videoSender.replaceTrack(camVideoTrack);

                const audioSender = call.peerConnection.getSenders().find(s => s.track.kind === 'audio');
                if(audioSender && camAudioTrack) audioSender.replaceTrack(camAudioTrack);
            });

            if(localVideo) {
                // Atualiza também a variável global localStream para não perdermos a referência
                localStream = camStream;
                localVideo.srcObject = camStream;
                localVideo.classList.replace('object-contain', 'object-cover');
            }
        };
    } catch (e) {
        console.error("Compartilhamento cancelado ou não suportado", e);
    }
});

window.addEventListener('beforeunload', () => leaveVoiceChannel());

// --- CHAT ---
messageInput.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter' && messageInput.value) {
        await supabase.from('messages').insert([{ 
            user_name: currentUser.user_metadata.full_name, 
            user_avatar: currentUser.user_metadata.avatar_url, 
            content: messageInput.value, 
            channel: activeTextChannelId 
        }]);
        messageInput.value = '';
    }
});

function renderMessage(msg) {
    const msgEl = document.createElement('div');
    msgEl.className = 'flex gap-4 hover:bg-[#32353b] p-1 px-2 -mx-2 rounded transition';
    msgEl.innerHTML = `<img src="${msg.user_avatar}" class="w-10 h-10 rounded-full mt-1">
        <div><div class="flex items-baseline gap-2"><span class="font-medium text-white">${msg.user_name}</span></div><div class="text-gray-200">${msg.content}</div></div>`;
    messagesDiv.appendChild(msgEl);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}