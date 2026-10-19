import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

// COLOQUE SUAS CHAVES AQUI
const supabaseUrl = 'https://wxtywhqmhvhuygcuzaqy.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind4dHl3aHFtaHZodXlnY3V6YXF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0MjQ1MTUsImV4cCI6MjEwODAwMDUxNX0.-mlQ1uowx0CW1a5NcYYzH8LRWIwDVrEgAL_O3_xocB8';
const supabase = createClient(supabaseUrl, supabaseKey);

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const videoGrid = document.getElementById('video-grid');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const fileInput = document.getElementById('file-input');

let currentUser = null;
let peer = null;
let isLoginMode = true;

// --- AUTENTICAÇÃO NATIVAA ---
document.getElementById('toggle-auth').addEventListener('click', () => {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title').innerText = isLoginMode ? 'Entrar na Call' : 'Criar Conta';
    document.getElementById('auth-btn').innerText = isLoginMode ? 'Entrar' : 'Cadastrar';
    document.getElementById('toggle-auth').innerText = isLoginMode ? 'Primeira vez aqui? Crie uma conta' : 'Já tem uma conta? Entre aqui';
    document.getElementById('auth-name').classList.toggle('hidden', isLoginMode);
    document.getElementById('auth-error').classList.add('hidden');
});

document.getElementById('auth-btn').addEventListener('click', async () => {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-pass').value;
    const name = document.getElementById('auth-name').value;
    const errorEl = document.getElementById('auth-error');
    errorEl.classList.add('hidden');

    if (!email || !password) {
        errorEl.innerText = "Preencha e-mail e senha.";
        errorEl.classList.remove('hidden');
        return;
    }

    if (isLoginMode) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            errorEl.innerText = "Erro: " + error.message;
            errorEl.classList.remove('hidden');
        } else {
            window.location.reload();
        }
    } else {
        if (!name) {
            errorEl.innerText = "Digite um nome para a conta.";
            errorEl.classList.remove('hidden');
            return;
        }
        
        const avatarUrl = `https://api.dicebear.com/7.x/identicon/svg?seed=${email}`;
        const { error } = await supabase.auth.signUp({
            email, password, options: { data: { full_name: name, avatar_url: avatarUrl } }
        });

        if (error) {
            errorEl.innerText = "Erro ao criar: " + error.message;
            errorEl.classList.remove('hidden');
        } else {
            alert('Conta criada com sucesso! Você já pode entrar.');
            document.getElementById('toggle-auth').click();
        }
    }
});

async function checkUser() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        currentUser = session.user;
        showApp(currentUser);
    } else {
        loginScreen.classList.remove('hidden');
        appScreen.classList.add('hidden');
    }
}

document.getElementById('logout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.reload();
});

function showApp(user) {
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    
    const name = user.user_metadata.full_name || 'Usuário';
    const avatar = user.user_metadata.avatar_url || 'https://cdn.discordapp.com/embed/avatars/0.png';
    
    document.getElementById('user-name').innerText = name;
    document.getElementById('user-avatar').src = avatar;

    initWebRTC();
    loadChat();
    subscribeToChat();
}

checkUser();

// --- WEBRTC & PEERJS ---
function initWebRTC() {
    peer = new Peer(); 
    peer.on('open', id => { document.getElementById('my-peer-id').value = id; });

    peer.on('call', call => {
        navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
            addVideoStream(stream, true); 
            call.answer(stream);
            call.on('stream', remoteStream => { addVideoStream(remoteStream); });
        });
    });
}

document.getElementById('connect-call').addEventListener('click', () => {
    const friendId = document.getElementById('friend-id').value;
    if(!friendId) return;
    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
        addVideoStream(stream, true);
        const call = peer.call(friendId, stream);
        call.on('stream', remoteStream => { addVideoStream(remoteStream); });
    });
});

document.getElementById('share-screen').addEventListener('click', async () => {
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        addVideoStream(screenStream, true);
        const friendId = document.getElementById('friend-id').value;
        if(friendId) peer.call(friendId, screenStream);
    } catch (e) { console.error("Erro no compartilhamento", e); }
});

function addVideoStream(stream, isLocal = false) {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.className = "max-w-full max-h-64 rounded-lg bg-discord-dark border border-discord-darker shadow-lg object-cover";
    video.addEventListener('loadedmetadata', () => { video.play(); });
    if(isLocal) video.muted = true;
    videoGrid.append(video);
}

// --- CHAT & SUPABASE DATABASE ---
async function loadChat() {
    const { data: messages, error } = await supabase
        .from('messages')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(50);
        
    if (!error && messages) {
        messagesDiv.innerHTML = '';
        messages.forEach(renderMessage);
        scrollToBottom();
    }
}

function subscribeToChat() {
    supabase.channel('public:messages')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
            renderMessage(payload.new);
            scrollToBottom();
        })
        .subscribe();
}

function renderMessage(msg) {
    const msgEl = document.createElement('div');
    msgEl.className = 'flex gap-4 hover:bg-discord-darker p-2 -mx-2 rounded transition';
    
    let content = msg.content;
    if (msg.file_url) {
        content = `<a href="${msg.file_url}" target="_blank" class="text-blue-400 hover:underline flex items-center gap-1">📄 ${msg.content || 'Baixar Arquivo'}</a>`;
    }

    msgEl.innerHTML = `
        <img src="${msg.user_avatar}" class="w-10 h-10 rounded-full mt-0.5">
        <div>
            <div class="flex items-baseline gap-2">
                <span class="font-semibold text-white">${msg.user_name}</span>
                <span class="text-xs text-gray-400">${new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            </div>
            <div class="text-gray-300 text-sm mt-1">${content}</div>
        </div>
    `;
    messagesDiv.appendChild(msgEl);
}

function scrollToBottom() {
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

messageInput.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter' && (messageInput.value || fileInput.files.length > 0)) {
        let fileUrl = null;
        let text = messageInput.value;

        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const fileName = `${Date.now()}_${file.name}`;
            
            const { data, error } = await supabase.storage.from('chat-files').upload(fileName, file);
            if (!error) {
                const { data: publicData } = supabase.storage.from('chat-files').getPublicUrl(fileName);
                fileUrl = publicData.publicUrl;
                text = text || file.name; 
            }
        }

        await supabase.from('messages').insert([{
            user_name: currentUser.user_metadata.full_name || 'Usuário',
            user_avatar: currentUser.user_metadata.avatar_url,
            content: text,
            file_url: fileUrl
        }]);

        messageInput.value = '';
        fileInput.value = '';
    }
});