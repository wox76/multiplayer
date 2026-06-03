import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getDatabase, ref, set, push, onValue, onDisconnect, onChildAdded } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

// --- CONFIGURAZIONE FIREBASE ---
const firebaseConfig = {
    apiKey: "AIzaSyD_-zCP4SduEdEj2syEp9IjhvM1frWkaR0",
    authDomain: "multiplayer-3e890.firebaseapp.com",
    projectId: "multiplayer-3e890",
    databaseURL: "https://multiplayer-3e890-default-rtdb.firebaseio.com",
    storageBucket: "multiplayer-3e890.firebasestorage.app",
    messagingSenderId: "868532708740",
    appId: "1:868532708740:web:62907517b3cf8f008e29d1"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const playerId = 'player_' + Math.random().toString(36).substr(2, 9);
const playerRef = ref(db, `players/${playerId}`);
const bulletsRef = ref(db, 'bullets');

// --- STATO DEL GIOCO ---
let scene, camera, renderer, controls;
let localPlayerMesh;
let otherPlayers = {}; 
let remoteBullets = [];
let keys = { w: false, a: false, s: false, d: false, ' ': false };
let isPlaying = false;

let lastUpdateTime = 0;
const updateInterval = 50; 

let playerData = {
    name: "Player",
    x: Math.random() * 20 - 10,
    y: 0.5,
    z: Math.random() * 20 - 10,
    ry: 0,
    color: Math.random() * 0xffffff
};

const playerSpeed = 0.15;
const bulletSpeed = 0.4;
const maxBulletLife = 2000; 

// --- FUNZIONE CREAZIONE SCRITTA NOME ---
function createNameTag(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(10, 10, 236, 44);
    
    ctx.font = 'Bold 24px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2, 0.5, 1);
    sprite.position.y = 1.2; 
    return sprite;
}

// --- CREAZIONE AVATAR COMPLETO ---
function createAvatarMesh(color, name) {
    const group = new THREE.Group();
    
    const bodyGeo = new THREE.BoxGeometry(1, 1, 1);
    const bodyMat = new THREE.MeshStandardMaterial({ color: color });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    const pointerGeo = new THREE.BoxGeometry(0.3, 0.2, 0.3);
    const pointerMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const pointer = new THREE.Mesh(pointerGeo, pointerMat);
    pointer.position.set(0, 0.2, 0.5);
    group.add(pointer);

    const nameTag = createNameTag(name);
    group.add(nameTag);

    return group;
}

// --- LOGICA DI SPARO ---
function fireBullet() {
    if (!localPlayerMesh) return;
    const dirX = Math.sin(localPlayerMesh.rotation.y);
    const dirZ = Math.cos(localPlayerMesh.rotation.y);

    const spawnX = localPlayerMesh.position.x + dirX * 0.6;
    const spawnY = localPlayerMesh.position.y + 0.2;
    const spawnZ = localPlayerMesh.position.z + dirZ * 0.6;

    const bulletData = {
        ownerId: playerId,
        x: spawnX,
        y: spawnY,
        z: spawnZ,
        dx: dirX * bulletSpeed,
        dz: dirZ * bulletSpeed,
        createdAt: Date.now()
    };

    push(bulletsRef, bulletData);
}

// --- GESTIONE INPUT (Ancorata a document per massima compatibilità) ---
document.addEventListener('keydown', (e) => {
    if (!isPlaying) return;
    const key = e.key.toLowerCase();
    
    if (keys.hasOwnProperty(key)) {
        if (key === ' ' && !keys[' ']) {
            fireBullet(); 
        }
        keys[key] = true;
        // Impedisce alla barra spaziatrice di fare lo scroll della pagina web
        if(key === ' ') e.preventDefault();
    }
});

document.addEventListener('keyup', (e) => {
    if (!isPlaying) return;
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = false;
});

// --- INIZIALIZZAZIONE ELEMENTI 3D ---
function initEngine() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a24);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);

    const gridHelper = new THREE.GridHelper(50, 50, 0x444455, 0x444455);
    scene.add(gridHelper);

    localPlayerMesh = createAvatarMesh(playerData.color, playerData.name);
    localPlayerMesh.position.set(playerData.x, playerData.y, playerData.z);
    scene.add(localPlayerMesh);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controls.minDistance = 4;
    controls.maxDistance = 12;

    camera.position.set(playerData.x, playerData.y + 4, playerData.z - 6);
    controls.target.copy(localPlayerMesh.position);

    window.addEventListener('resize', onWindowResize);
}

// --- CONNESSIONE RETE E LISTENERS ---
function initNetwork() {
    set(playerRef, playerData);
    onDisconnect(playerRef).remove();

    const playersRef = ref(db, 'players');
    onValue(playersRef, (snapshot) => {
        const data = snapshot.val() || {};
        
        Object.keys(otherPlayers).forEach(id => {
            if (!data[id]) {
                scene.remove(otherPlayers[id]);
                delete otherPlayers[id];
            }
        });

        Object.keys(data).forEach(id => {
            if (id === playerId) return;
            const pData = data[id];

            if (!otherPlayers[id]) {
                otherPlayers[id] = createAvatarMesh(pData.color, pData.name);
                scene.add(otherPlayers[id]);
            }

            otherPlayers[id].position.set(pData.x, pData.y, pData.z);
            if (pData.ry !== undefined) otherPlayers[id].rotation.y = pData.ry;
        });
    });

    onChildAdded(bulletsRef, (snapshot) => {
        const bData = snapshot.val();
        
        const bGeo = new THREE.SphereGeometry(0.15, 8, 8);
        const bMat = new THREE.MeshBasicMaterial({ color: bData.ownerId === playerId ? 0xffcc00 : 0xff3333 });
        const bMesh = new THREE.Mesh(bGeo, bMat);
        bMesh.position.set(bData.x, bData.y, bData.z);
        scene.add(bMesh);

        remoteBullets.push({
            mesh: bMesh,
            dx: bData.dx,
            dz: bData.dz,
            createdAt: bData.createdAt
        });
    });
}

// --- LOOP DI GIOCO ---
function update() {
    requestAnimationFrame(update);
    if (!isPlaying) return;

    let moved = false;
    const camDirection = new THREE.Vector3();
    camera.getWorldDirection(camDirection);
    camDirection.y = 0;
    camDirection.normalize();

    const camSide = new THREE.Vector3();
    camSide.crossVectors(camera.up, camDirection).normalize();

    let moveVector = new THREE.Vector3(0, 0, 0);

    if (keys.w) { moveVector.add(camDirection); moved = true; }
    if (keys.s) { moveVector.sub(camDirection); moved = true; }
    if (keys.a) { moveVector.add(camSide); moved = true; }
    if (keys.d) { moveVector.sub(camSide); moved = true; }

    if (moved) {
        moveVector.normalize().multiplyScalar(playerSpeed);
        localPlayerMesh.position.add(moveVector);

        const angle = Math.atan2(moveVector.x, moveVector.z);
        localPlayerMesh.rotation.y = angle;

        playerData.x = localPlayerMesh.position.x;
        playerData.z = localPlayerMesh.position.z;
        playerData.ry = localPlayerMesh.rotation.y;

        const currentTime = performance.now();
        if (currentTime - lastUpdateTime > updateInterval) {
            set(playerRef, playerData);
            lastUpdateTime = currentTime;
        }
    }

    // --- FISICA DEI PROIETTILI ---
    const now = Date.now();
    for (let i = remoteBullets.length - 1; i >= 0; i--) {
        const b = remoteBullets[i];
        
        if (now - b.createdAt > maxBulletLife) {
            scene.remove(b.mesh);
            b.mesh.geometry.dispose();
            b.mesh.material.dispose();
            remoteBullets.splice(i, 1);
        } else {
            b.mesh.position.x += b.dx;
            b.mesh.position.z += b.dz;
        }
    }

    controls.target.copy(localPlayerMesh.position);
    controls.update();
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- AVVIO SICURO GESTITO DAL DOM ---
const setupLogin = () => {
    const startBtn = document.getElementById('start-btn');
    const usernameInput = document.getElementById('username-input');

    if (startBtn && usernameInput) {
        startBtn.addEventListener('click', () => {
            const inputName = usernameInput.value.trim();
            if (inputName !== "") {
                playerData.name = inputName;
                
                // Forziamo il rilascio del focus dall'input di testo
                usernameInput.blur();
                startBtn.blur();
                
                document.getElementById('login-screen').style.display = 'none';
                document.getElementById('ui').style.display = 'block';
                
                // Ritorniamo il focus globale alla finestra per catturare WASD e Spazio
                window.focus();
                
                isPlaying = true;
                
                initEngine();
                initNetwork();
                update();
            } else {
                alert("Inserisci un nome valido per giocare!");
            }
        });

        usernameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                startBtn.click();
            }
        });
    }
};

// Se il DOM è già pronto lo esegue, altrimenti aspetta il caricamento
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupLogin);
} else {
    setupLogin();
}