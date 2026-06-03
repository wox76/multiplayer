import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getDatabase, ref, set, onValue, onDisconnect, remove } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js';

// --- CONFIGURAZIONE FIREBASE ---
const firebaseConfig = {
    apiKey: "IL_TUO_API_KEY",
    authDomain: "IL_TUO_AUTH_DOMAIN",
    databaseURL: "IL_TUO_DATABASE_URL",
    projectId: "IL_TUO_PROJECT_ID",
    storageBucket: "IL_TUO_STORAGE_BUCKET",
    messagingSenderId: "IL_TUO_MESSAGING_SENDER_ID",
    appId: "IL_TUO_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// ID Unico per questo giocatore
const playerId = 'player_' + Math.random().toString(36).substr(2, 9);
const playerRef = ref(db, `players/${playerId}`);

// --- STATO DEL GIOCO ---
let scene, camera, renderer, controls;
let localPlayerMesh;
let otherPlayers = {}; // Mappa per memorizzare gli altri avatar in scena
let keys = { w: false, a: false, s: false, d: false };

// Dati locali del giocatore
let playerData = {
    x: Math.random() * 10 - 5,
    y: 0.5,
    z: Math.random() * 10 - 5,
    color: Math.random() * 0xffffff
};

const playerSpeed = 0.15;

// --- INIZIALIZZAZIONE THREE.JS ---
function initEngine() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x202030);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // Luci
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(10, 20, 10);
    scene.add(dirLight);

    // Terreno (Griglia di riferimento)
    const gridHelper = new THREE.GridHelper(50, 50, 0x444455, 0x444455);
    scene.add(gridHelper);

    // Creazione Avatar Locale (Cubo con un "naso" per capire la direzione)
    localPlayerMesh = createAvatarMesh(playerData.color);
    localPlayerMesh.position.set(playerData.x, playerData.y, playerData.z);
    scene.add(localPlayerMesh);

    // Configurazione Telecamera (Terza Persona base via OrbitControls)
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2 - 0.05; // Evita di scendere sotto il terreno
    controls.minDistance = 3;
    controls.maxDistance = 15;

    // Posizione iniziale telecamera rispetto al giocatore
    camera.position.set(playerData.x, playerData.y + 4, playerData.z - 6);
    controls.target.copy(localPlayerMesh.position);

    // Eventi di ridimensionamento finestra
    window.addEventListener('resize', onWindowResize);
}

// Funzione helper per creare l'aspetto visivo dell'avatar
function createAvatarMesh(color) {
    const group = new THREE.Group();
    
    // Corpo
    const bodyGeo = new THREE.BoxGeometry(1, 1, 1);
    const bodyMat = new THREE.MeshStandardMaterial({ color: color });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    // "Naso" o direzione frontale dell'avatar
    const pointerGeo = new THREE.BoxGeometry(0.2, 0.2, 0.4);
    const pointerMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const pointer = new THREE.Mesh(pointerGeo, pointerMat);
    pointer.position.set(0, 0.2, 0.6);
    group.add(pointer);

    return group;
}

// --- INPUT DI GIOCO ---
window.addEventListener('keydown', (e) => {
    if (keys.hasOwnProperty(e.key.toLowerCase())) keys[e.key.toLowerCase()] = true;
});

window.addEventListener('keyup', (e) => {
    if (keys.hasOwnProperty(e.key.toLowerCase())) keys[e.key.toLowerCase()] = false;
});

// --- LOGICA DI RETE (FIREBASE) ---
function initNetwork() {
    // 1. Scrivi la presenza sul DB e gestisci la disconnessione automatica
    set(playerRef, playerData);
    onDisconnect(playerRef).remove();

    // 2. Ascolta i cambiamenti di tutti i giocatori sul DB
    const playersRef = ref(db, 'players');
    onValue(playersRef, (snapshot) => {
        const data = snapshot.val() || {};
        
        // Rimuovi i player che non sono più nel DB
        Object.keys(otherPlayers).forEach(id => {
            if (!data[id]) {
                scene.remove(otherPlayers[id]);
                delete otherPlayers[id];
            }
        });

        // Aggiorna o crea gli altri giocatori
        Object.keys(data).forEach(id => {
            if (id === playerId) return; // Salta se stesso

            const pData = data[id];

            if (!otherPlayers[id]) {
                // Nuovo giocatore connesso, crea la mesh
                otherPlayers[id] = createAvatarMesh(pData.color);
                scene.add(otherPlayers[id]);
            }

            // Aggiorna posizione (e rotazione opzionale) del player remoto
            otherPlayers[id].position.set(pData.x, pData.y, pData.z);
            if(pData.ry) otherPlayers[id].rotation.y = pData.ry;
        });
    });
}

// --- LOOP DI AGGIORNAMENTO ---
function update() {
    requestAnimationFrame(update);

    let moved = false;

    // Calcolo vettori di movimento basati sull'angolo della telecamera (Visuale in terza persona)
    const camDirection = new THREE.Vector3();
    camera.getWorldDirection(camDirection);
    camDirection.y = 0; // Mantieni il movimento sul piano XZ
    camDirection.normalize();

    const camSide = new THREE.Vector3();
    camSide.crossVectors(camera.up, camDirection).normalize(); // Direzione laterale rispetto alla cam

    let moveVector = new THREE.Vector3(0, 0, 0);

    if (keys.w) { moveVector.add(camDirection); moved = true; }
    if (keys.s) { moveVector.sub(camDirection); moved = true; }
    if (keys.a) { moveVector.add(camSide); moved = true; }
    if (keys.d) { moveVector.sub(camSide); moved = true; }

    if (moved) {
        moveVector.normalize().multiplyScalar(playerSpeed);
        localPlayerMesh.position.add(moveVector);

        // Ruota l'avatar verso la direzione in cui si sta muovendo
        const angle = Math.atan2(moveVector.x, moveVector.z);
        localPlayerMesh.rotation.y = angle;

        // Aggiorna lo stato locale
        playerData.x = localPlayerMesh.position.x;
        playerData.z = localPlayerMesh.position.z;
        playerData.ry = localPlayerMesh.rotation.y;

        // Invia i nuovi dati a Firebase
        set(playerRef, playerData);

        // Sposta il target dei controlli insieme al player
        controls.target.copy(localPlayerMesh.position);
    } else {
        // Se non ci muoviamo, blocca comunque i controlli sulla posizione corrente del player
        controls.target.copy(localPlayerMesh.position);
    }

    controls.update(); // Necessario per il damping dell'OrbitControls
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// --- AVVIO GIOCO ---
initEngine();
initNetwork();
update();