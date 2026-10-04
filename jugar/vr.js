// Chupi Gualy en realidad virtual (WebXR): para las gafas Meta Quest 2, 3, 3S y Pro, desde su navegador.
// Entras DENTRO de Chupicity, a escala real: andas con la palanca, giras con la otra, usas las cosas con A, la linterna con el gatillo
// y los menús del juego (tienda, bolsillo, dinero…) salen flotando delante de ti y se tocan apuntando con el mando.
// El juego (index.html) sigue siendo el mismo: aquí solo se mueve la cámara, se leen los mandos y se pintan los menús en 3D.
(() => {
'use strict';
const VRX = window.__vrx;
if (!VRX) return;
const $ = id => document.getElementById(id);
const SCALE = 15; // unidades del juego por metro: una persona de 1,6 m tiene los ojos a 24 unidades (las del juego miden unas 27)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const PI = Math.PI;
const INK = '#2a2140', PAPER = '#fff8e8', SUN = '#ffd23f', ACCENT = '#ff6b4a';
const FONT = '"Fredoka", "Trebuchet MS", "Segoe UI", system-ui, sans-serif';

// ---------- ajustes de las gafas (se guardan en el navegador) ----------
const DEF = { snap: 45, speed: 1, vignette: true, comfort: true, seated: false, helpSeen: false };
const cfg = (() => { try { return Object.assign({}, DEF, JSON.parse(localStorage.getItem('chupi.vr') || '{}')); } catch (e) { return Object.assign({}, DEF); } })();
const saveCfg = () => { try { localStorage.setItem('chupi.vr', JSON.stringify(cfg)); } catch (e) {} };

const VR = {
  session: null, rig: null, cam: null, ctrl: [], pads: {}, panels: {}, modal: null, rigYaw: 0, baseY: 0, prevHead: null, anchor: null,
  fade: 0, lastT: 0, frames: 0, eyeOffset: 0, lastState: '', lastPose: 'stand', wasPaused: false, haptic: {}, shot: null, dom: { hoverEl: null, info: null, dirty: true, lastPaint: 0, el: null }
};
window.__vrDebug = VR; // para las pruebas

// ---------- ¿hay gafas? botones para entrar ----------
let supported = false;
const WEB_URL = 'https://manuelbd145.github.io/chupi-gualy-descargas/jugar/'; // la versión web, donde el navegador de las gafas deja entrar en VR
const inApp = !!(window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform());
const onQuest = /Quest|Oculus/i.test(navigator.userAgent);
function addButtons(mode) {
  const style = document.createElement('style');
  style.textContent = '#vrBtn { font-size: 21px; padding: 10px 24px; margin-top: 6px; background: #9be7ff; } #vrHint { font-size: 14px; opacity: .85; margin: 0; }';
  document.head.appendChild(style);
  const go = mode === 'app' ? openWeb : enter;
  const play = $('playBtn');
  if (play && play.parentNode) {
    const b = document.createElement('button'); b.className = 'btn'; b.id = 'vrBtn'; b.textContent = mode === 'app' ? '🥽 Jugar en VR' : '🥽 Jugar con gafas VR';
    play.insertAdjacentElement('afterend', b); b.addEventListener('click', go);
    const p = document.createElement('p'); p.className = 'keys'; p.id = 'vrHint';
    p.textContent = mode === 'app' ? 'Se abre en el navegador de las gafas, que es el que deja entrar en VR.' : 'Gafas detectadas: entras dentro de Chupicity y andas con las palancas.';
    b.insertAdjacentElement('afterend', p);
  }
  const row = $('fsBtn') && $('fsBtn').parentNode;
  if (row) { const b = document.createElement('button'); b.className = 'btn'; b.id = 'vrBtn2'; b.textContent = mode === 'app' ? '🥽 Jugar en VR' : '🥽 Entrar en VR'; row.appendChild(b); b.addEventListener('click', go); }
}
// la app de Android instalada en unas gafas Meta Quest se ve como una ventana plana: para entrar en VR hay que abrir la versión web en el navegador de las gafas
function openWeb() { try { location.assign(WEB_URL); } catch (e) { window.open(WEB_URL, '_blank'); } } // Capacitor abre las direcciones de fuera de la app en el navegador del sistema
(async () => {
  try { supported = !!(navigator.xr && navigator.xr.isSessionSupported && await navigator.xr.isSessionSupported('immersive-vr')); } catch (e) { supported = false; }
  VR.supported = supported;
  if (supported) addButtons('vr');
  else if (inApp && onQuest) addButtons('app');
})();

async function enter() {
  const A = VRX.api;
  if (!A || VR.session) return;
  VRX.entering = true; // para que ¡Jugar! no pida pantalla completa
  try {
    if (!$('start').classList.contains('hidden')) $('playBtn').click();
    else if (!$('menu').classList.contains('hidden')) $('menuClose').click();
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] });
    await begin(session);
  } catch (e) {
    VRX.entering = false;
    console.warn('VR:', e);
    try { if (VR.session) VR.session.end(); } catch (e2) {}
    if (A.toast) A.toast('No se ha podido entrar en VR: ' + ((e && e.message) || e), 5);
  }
}

// ---------- dentro de las gafas ----------
function collectLights(scene) { pointLights.length = 0; scene.traverse(o => { if ((o.isPointLight || o.isSpotLight) && o.distance > 0) pointLights.push(o); }); }
let Tj, tmpV, tmpV2, tmpQ, tmpM, Yaxis;
const pointLights = [];

async function begin(session) {
  const A = VRX.api, T = A.T, r = A.renderer, scene = A.scene;
  Tj = T; tmpV = new T.Vector3(); tmpV2 = new T.Vector3(); tmpQ = new T.Quaternion(); tmpM = new T.Matrix4(); Yaxis = new T.Vector3(0, 1, 0);
  VR.session = session;
  let type = 'local-floor';
  try { await session.requestReferenceSpace('local-floor'); } catch (e) { type = 'local'; }
  VR.eyeOffset = type === 'local' ? 1.6 : 0;
  r.xr.setReferenceSpaceType(type);
  const quest2 = /Quest 2/i.test(navigator.userAgent);
  r.xr.setFramebufferScaleFactor(quest2 ? 0.85 : 1);
  buildRig(A);
  r.xr.enabled = true;
  r.xr.setAnimationLoop(onFrame);
  session.addEventListener('end', onEnd);
  VR.sel = {}; // si usas las manos en vez de los mandos, el pellizco llega como "select" (y el puño cerrado como "squeeze")
  for (const [ty, on] of [['selectstart', true], ['selectend', false], ['squeezestart', true], ['squeezeend', false]]) {
    session.addEventListener(ty, e => { const h = e.inputSource && e.inputSource.handedness === 'left' ? 'left' : 'right'; VR.sel[h + (ty.startsWith('select') ? 'select' : 'squeeze')] = on; });
  }
  session.addEventListener('visibilitychange', () => {
    if (session.visibilityState && session.visibilityState !== 'visible' && !A.paused) A.openMenu(); // te quitas las gafas: el juego se pausa
  });
  await r.xr.setSession(session);
  const layer = session.renderState && session.renderState.baseLayer;
  if (layer && 'fixedFoveation' in layer) layer.fixedFoveation = 1;
  try { VR.shadowType = r.shadowMap.type; r.shadowMap.type = T.PCFShadowMap; r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = true; } catch (e) {}
  if (A.deco.on) A.closeDeco();
  for (const fb of A.fadeables) { fb.a = 1; for (const mt of fb.mats) { mt.opacity = 1; mt.depthWrite = true; } for (const ms of fb.meshes) ms.castShadow = true; }
  collectLights(scene);
  VRX.on = true;
  VRX.entering = false;
  VR.prevHead = null; VR.lastT = 0; VR.frames = 0; VR.rigYaw = 0; VR.anchor = null; VR.lastState = ''; VR.fade = 1;
  A.toast('🥽 ¡Ya estás en Chupicity! Pulsa B o Y para ver el menú y la ayuda.', 6);
  VR.helpPending = !cfg.helpSeen;
  try { if (A.Snd) { A.Snd.init && A.Snd.init(); A.Snd.ac && A.Snd.ac.resume && A.Snd.ac.resume(); } } catch (e) {}
  try { // las letras del juego tienen que estar cargadas antes de pintar los carteles de las gafas
    Promise.all(['400', '600', '700'].map(w => document.fonts.load(`${w} 24px Fredoka`))).then(() => { VR.wristKey = ''; VR.band.lastKey = ''; if (VR.modal === 'hub') drawHub(); else if (VR.modal === 'help') drawHelp(); });
  } catch (e) {}
}

function onEnd() {
  const A = VRX.api, r = A.renderer, scene = A.scene;
  VRX.on = false; VRX.mx = VRX.my = 0; VRX.walk = 1;
  try { r.xr.setAnimationLoop(null); } catch (e) {}
  r.xr.enabled = false;
  try { r.shadowMap.autoUpdate = true; if (VR.shadowType !== undefined) r.shadowMap.type = VR.shadowType; } catch (e) {}
  for (const c of VR.ctrl) releaseController(c);
  for (const k in VR.panels) { const q = VR.panels[k]; try { q.tex.dispose(); q.mesh.geometry.dispose(); q.mesh.material.dispose(); } catch (e) {} }
  if (VR.rig) { scene.remove(VR.rig); VR.rig = null; }
  if (VR.pausedByMe) { VR.pausedByMe = false; try { window.__chupi.fn.syncPaused(); } catch (e) {} }
  VR.session = null; VR.ctrl = []; VR.pads = {}; VR.panels = {}; VR.modal = null; VR.domOpen = false; VR.dom.el = null; VR.dom.info = null; VR.wristOn = null; VR.drag = null; VR.hover = null; pointLights.length = 0;
  if (domObserver) { domObserver.disconnect(); domObserver = null; }
  A.resize();
  A.camera.near = 5; A.camera.far = 6000; A.camera.updateProjectionMatrix();
  if (!A.paused) A.openMenu();
  A.kick();
  if (VR.errorMsg) { A.toast('Las gafas dejaron de funcionar (' + VR.errorMsg + '). Puedes seguir jugando en pantalla normal.', 7); VR.errorMsg = null; }
}

// ---------- el cuerpo virtual: una "plataforma" que se mueve con el jugador y lleva la cabeza y las manos ----------
function buildRig(A) {
  const T = A.T, scene = A.scene;
  const rig = new T.Group(); rig.scale.setScalar(SCALE); scene.add(rig); VR.rig = rig;
  const cam = new T.PerspectiveCamera(60, 1, 0.08, 400); rig.add(cam); VR.cam = cam; // los ojos: WebXR le pone la posición de la cabeza
  VR.cam.position.set(0, 1.6, 0);
  // manos: dos "manitas de bola" como las de los personajes del juego (cada una agarra su mando)
  const me = A.S.family[A.S.me] || {};
  const skin = new T.MeshLambertMaterial({ color: me.skin || '#ffe0c4' }), cuff = new T.MeshLambertMaterial({ color: me.shirt || '#3fa7ff' }), lamp = new T.MeshLambertMaterial({ color: '#ffd23f', emissive: '#aa8800', emissiveIntensity: 0.4 });
  for (let i = 0; i < 2; i++) {
    const c = A.renderer.xr.getController(i); releaseController(c); rig.add(c); VR.ctrl[i] = c;
    const hand = new T.Group(); c.add(hand);
    const palm = new T.Mesh(new T.SphereGeometry(0.038, 16, 12), skin); palm.position.set(0, 0, 0.02); hand.add(palm);
    const sleeve = new T.Mesh(new T.CylinderGeometry(0.028, 0.032, 0.06, 14), cuff); sleeve.rotation.x = PI / 2; sleeve.position.set(0, 0, 0.085); hand.add(sleeve);
    const thumb = new T.Mesh(new T.SphereGeometry(0.016, 10, 8), skin); thumb.position.set(0.03, 0.014, -0.005); hand.add(thumb);
    // linterna en la mano
    const torch = new T.Group(); const tb = new T.Mesh(new T.CylinderGeometry(0.016, 0.022, 0.12, 12), new T.MeshLambertMaterial({ color: '#3a3a48' })); tb.rotation.x = PI / 2; tb.position.z = -0.03; torch.add(tb);
    const tl = new T.Mesh(new T.CylinderGeometry(0.03, 0.02, 0.03, 12), lamp); tl.rotation.x = PI / 2; tl.position.z = -0.1; torch.add(tl); hand.add(torch);
    c.userData.torch = torch; c.userData.hand = hand;
    // rayo para apuntar a los menús
    const ray = new T.Mesh(new T.BoxGeometry(0.004, 0.004, 1), new T.MeshBasicMaterial({ color: SUN, transparent: true, opacity: 0.85, depthTest: false, fog: false })); ray.renderOrder = 1500; ray.visible = false; c.add(ray); c.userData.ray = ray;
    const dot = new T.Mesh(new T.RingGeometry(0.008, 0.016, 20), new T.MeshBasicMaterial({ color: ACCENT, side: T.DoubleSide, transparent: true, depthTest: false, fog: false })); dot.renderOrder = 1600; dot.visible = false; rig.add(dot); c.userData.dot = dot;
    const onConnected = e => { c.userData.src = e.data; c.userData.handed = e.data.handedness; applyHanded(c); };
    const onDisconnected = () => { c.userData.src = null; };
    c.addEventListener('connected', onConnected); c.addEventListener('disconnected', onDisconnected);
    c.userData.parts = [hand, ray]; c.userData.dotMesh = dot; c.userData.listeners = [['connected', onConnected], ['disconnected', onDisconnected]];
  }
  // desvanecido a negro (al cambiar de sitio) y viñeta roja del miedo, pegados a los ojos
  const fadeMat = new T.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false });
  const fade = new T.Mesh(new T.PlaneGeometry(5, 5), fadeMat); fade.position.z = -0.3; fade.renderOrder = 3000; fade.visible = false; cam.add(fade); VR.fadeMesh = fade;
  const vc = document.createElement('canvas'); vc.width = vc.height = 128; const vx = vc.getContext('2d');
  const gr = vx.createRadialGradient(64, 64, 30, 64, 64, 90); gr.addColorStop(0, 'rgba(120,0,15,0)'); gr.addColorStop(1, 'rgba(150,0,20,0.95)'); vx.fillStyle = gr; vx.fillRect(0, 0, 128, 128);
  const vt = new T.CanvasTexture(vc);
  const vig = new T.Mesh(new T.PlaneGeometry(1.4, 1.4), new T.MeshBasicMaterial({ map: vt, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false })); vig.position.z = -0.3; vig.renderOrder = 2900; vig.visible = false; cam.add(vig); VR.fearMesh = vig;
  const tc = document.createElement('canvas'); tc.width = tc.height = 128; const tx = tc.getContext('2d');
  const tg = tx.createRadialGradient(64, 64, 29, 64, 64, 64); tg.addColorStop(0, 'rgba(0,0,0,0)'); tg.addColorStop(0.6, 'rgba(0,0,0,0.6)'); tg.addColorStop(1, 'rgba(0,0,0,1)'); tx.fillStyle = tg; tx.fillRect(0, 0, 128, 128);
  const tun = new T.Mesh(new T.PlaneGeometry(1.2, 1.2), new T.MeshBasicMaterial({ map: new T.CanvasTexture(tc), transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }));
  tun.position.z = -0.3; tun.renderOrder = 2800; tun.visible = false; cam.add(tun); VR.tunnelMesh = tun; VR.tunnel = 0;
  buildPanels(A);
}

// los mandos de WebXR son siempre los mismos objetos en todas las sesiones: al salir se les quita lo que les pusimos
function releaseController(c) {
  if (!c) return;
  const u = c.userData || {};
  for (const p of u.parts || []) c.remove(p);
  if (u.dotMesh && u.dotMesh.parent) u.dotMesh.parent.remove(u.dotMesh);
  for (const [ty, fn] of u.listeners || []) c.removeEventListener(ty, fn);
  if (VR.panels.wrist && VR.panels.wrist.mesh.parent === c) c.remove(VR.panels.wrist.mesh);
  if (c.parent) c.parent.remove(c);
  c.userData = {};
}
function applyHanded(c) {
  const left = c.userData.handed === 'left';
  if (c.userData.torch) c.userData.torch.visible = !left; // la linterna va en la derecha
}

// ---------- las pantallas flotantes (reloj, avisos, menú rápido, ayuda y menús del juego) ----------
function mkPanel(wm, hm, pw, ph) {
  const T = Tj, canvas = document.createElement('canvas'); canvas.width = pw; canvas.height = ph;
  const tex = new T.CanvasTexture(canvas); tex.minFilter = T.LinearFilter; tex.magFilter = T.LinearFilter; tex.generateMipmaps = false;
  const mat = new T.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
  const mesh = new T.Mesh(new T.PlaneGeometry(1, 1), mat); mesh.scale.set(wm, hm, 1); mesh.renderOrder = 1000; mesh.visible = false; mesh.frustumCulled = false;
  return { mesh, canvas, ctx: canvas.getContext('2d'), tex, w: wm, h: hm };
}
function buildPanels(A) {
  const rig = VR.rig, P = VR.panels;
  P.wrist = mkPanel(0.17, 0.106, 512, 320); P.wrist.mesh.visible = true;
  P.band = mkPanel(0.95, 0.26, 1500, 410); P.band.mesh.visible = true; P.band.mesh.renderOrder = 1100; rig.add(P.band.mesh);
  P.hub = mkPanel(1.7, 1.15, 1360, 920); rig.add(P.hub.mesh);
  P.help = mkPanel(1.7, 1.36, 1360, 1088); rig.add(P.help.mesh);
  P.dom = mkPanel(1.2, 1.2, 512, 512); rig.add(P.dom.mesh);
  VR.band = { yaw: 0, init: false, lastKey: '' };
  VR.wristKey = '';
}

// el controlador izquierdo lleva el reloj (se le cuelga cuando conecta)
function attachWrist() {
  const L = VR.ctrl.find(c => c && c.userData.handed === 'left');
  if (!L || VR.wristOn === L) return;
  VR.wristOn = L; const m = VR.panels.wrist.mesh;
  L.add(m); m.position.set(0, 0.07, 0.06); m.rotation.set(-PI / 2 + 0.35, 0, 0); m.visible = true;
}

// pinta un menú propio (botones grandes) y se queda con las zonas para apuntar
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function card(ctx, x, y, w, h, fill, r = 26, lw = 6, sh = 8) {
  ctx.fillStyle = INK; roundRect(ctx, x, y + sh, w, h, r); ctx.fill();
  ctx.fillStyle = fill; roundRect(ctx, x, y, w, h, r); ctx.fill();
  ctx.lineWidth = lw; ctx.strokeStyle = INK; roundRect(ctx, x + lw / 2, y + lw / 2, w - lw, h - lw, r - lw / 2); ctx.stroke();
}
function wrapText(ctx, text, x, y, maxW, lh) {
  const words = String(text).split(/\s+/); let line = '', yy = y;
  for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { ctx.fillText(line, x, yy); line = w; yy += lh; } else line = t; }
  if (line) { ctx.fillText(line, x, yy); yy += lh; }
  return yy;
}

// ----- menú rápido -----
function hubItems() {
  const A = VRX.api, vis = id => $(id) && !$(id).classList.contains('hidden');
  const items = [
    { ico: '🎒', txt: 'Bolsillo', fn: () => $('pocketBtn').click() },
    { ico: '🍎', txt: 'Comida', fn: () => $('foodBtn').click() },
    { ico: '🪙', txt: 'Dinero', fn: () => $('coinBtn').click() },
    { ico: '🧾', txt: 'App noro', fn: () => $('noroBtn').click() },
    { ico: '👾', txt: 'Nivel de la noche', fn: () => $('diffBtn').click() },
    { ico: '⚙️', txt: 'Ajustes y personajes', fn: () => $('menuBtn').click() },
  ];
  if (vis('upBtn')) items.push({ ico: '⬆️', txt: 'Subir de planta', fn: () => $('upBtn').click() });
  if (vis('downBtn')) items.push({ ico: '⬇️', txt: 'Bajar de planta', fn: () => $('downBtn').click() });
  items.push({ ico: '🔄', txt: 'Girar ' + (cfg.snap === 90 ? '90°' : cfg.snap + '°'), sub: 'toca para cambiar', keep: true, fn: () => { cfg.snap = cfg.snap === 45 ? 90 : cfg.snap === 90 ? 30 : 45; saveCfg(); } });
  items.push({ ico: '🚶', txt: 'Andar: ' + (cfg.speed < 1 ? 'despacio' : cfg.speed > 1 ? 'deprisa' : 'normal'), sub: 'toca para cambiar', keep: true, fn: () => { cfg.speed = cfg.speed === 1 ? 1.4 : cfg.speed > 1 ? 0.7 : 1; saveCfg(); } });
  items.push({ ico: '🪑', txt: 'Jugar sentado: ' + (cfg.seated ? 'sí' : 'no'), sub: 'sube un poco la vista', keep: true, fn: () => { cfg.seated = !cfg.seated; saveCfg(); } });
  items.push({ ico: '⭕', txt: 'Viñeta al moverte: ' + (cfg.comfort ? 'sí' : 'no'), sub: 'ayuda a no marearse', keep: true, fn: () => { cfg.comfort = !cfg.comfort; saveCfg(); } });
  items.push({ ico: '🌗', txt: 'Viñeta de miedo: ' + (cfg.vignette ? 'sí' : 'no'), sub: 'toca para cambiar', keep: true, fn: () => { cfg.vignette = !cfg.vignette; saveCfg(); } });
  items.push({ ico: '❓', txt: 'Ayuda de los mandos', fn: () => { closeModal(); openModal('help'); }, keepModal: true });
  items.push({ ico: '🚪', txt: 'Salir de VR', fn: () => { if (VR.session) VR.session.end(); } });
  return items;
}
function drawHub() {
  const P = VR.panels.hub, ctx = P.ctx, W = P.canvas.width, H = P.canvas.height;
  const items = VR.hubList = hubItems();
  ctx.clearRect(0, 0, W, H);
  card(ctx, 10, 10, W - 20, H - 30, PAPER, 44, 9, 11);
  ctx.fillStyle = INK; ctx.font = `700 60px ${FONT}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillText('Menú rápido', 64, 84);
  const cols = 3, gx = 36, gy = 24, top = 140, bw = (W - 2 * 64 - gx * (cols - 1)) / cols, rows = Math.ceil(items.length / cols), bh = Math.min(150, (H - top - 80 - gy * (rows - 1)) / rows);
  VR.hubRects = [];
  items.forEach((it, k) => {
    const cx = 64 + (k % cols) * (bw + gx), cy = top + Math.floor(k / cols) * (bh + gy);
    const hot = VR.hover && VR.hover.panel === 'hub' && VR.hover.idx === k;
    card(ctx, cx, cy, bw, bh, hot ? SUN : '#ffffff', 26, 6, 7);
    ctx.fillStyle = INK; ctx.textAlign = 'left'; ctx.font = `54px ${FONT}`; ctx.fillText(it.ico, cx + 20, cy + bh / 2 + 3);
    ctx.font = `600 ${it.sub ? 34 : 38}px ${FONT}`;
    const tx = cx + 100, tw = bw - 116;
    if (it.sub) { ctx.fillText(it.txt, tx, cy + bh / 2 - 16, tw); ctx.font = `400 26px ${FONT}`; ctx.fillStyle = '#6a5f85'; ctx.fillText(it.sub, tx, cy + bh / 2 + 28, tw); }
    else ctx.fillText(it.txt, tx, cy + bh / 2 + 3, tw);
    VR.hubRects.push({ x: cx, y: cy, w: bw, h: bh });
  });
  ctx.fillStyle = '#6a5f85'; ctx.font = `400 28px ${FONT}`; ctx.textAlign = 'center';
  ctx.fillText('Apunta con el mando y aprieta el gatillo · B o Y para cerrar', W / 2, H - 52);
  P.tex.needsUpdate = true;
}

// ----- ayuda de los mandos -----
function drawHelp() {
  const P = VR.panels.help, ctx = P.ctx, W = P.canvas.width, H = P.canvas.height;
  ctx.clearRect(0, 0, W, H);
  card(ctx, 10, 10, W - 20, H - 30, PAPER, 44, 9, 11);
  ctx.fillStyle = INK; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.font = `700 60px ${FONT}`;
  ctx.fillText('🥽 Cómo se juega con las gafas', 64, 86);
  const rows = [
    ['🕹️', 'Palanca izquierda', 'Andar hacia donde miras. También puedes andar de verdad por tu sala.'],
    ['↪️', 'Palanca derecha', 'Girar a saltitos. Hacia delante o atrás: subir o bajar de planta en casa.'],
    ['🔦', 'Gatillo', 'La linterna contra los Gualy. Con un menú abierto, pulsa lo que señales.'],
    ['✋', 'A, X o el agarre', 'Usar lo que diga el cartel de abajo: entrar, subir al coche, sentarte…'],
    ['📋', 'B o Y', 'El menú rápido: bolsillo, comida, dinero, ajustes y salir de VR.'],
    ['⌚', 'Reloj de la mano izquierda', 'La hora, los corazones, la fuerza y la flecha que te guía.']
  ];
  rows.forEach((rw, k) => {
    const y = 136 + k * 128;
    card(ctx, 56, y, W - 112, 114, '#ffffff', 24, 6, 6);
    ctx.fillStyle = INK; ctx.font = `54px ${FONT}`; ctx.textAlign = 'left'; ctx.fillText(rw[0], 80, y + 58);
    ctx.font = `700 35px ${FONT}`; ctx.fillText(rw[1], 160, y + 34, W - 280);
    ctx.font = `400 30px ${FONT}`; ctx.fillStyle = '#4a4160'; wrapText(ctx, rw[2], 160, y + 78, W - 290, 34);
  });
  const hot = VR.hover && VR.hover.panel === 'help';
  card(ctx, W / 2 - 220, H - 170, 440, 100, hot ? SUN : ACCENT, 32, 7, 8);
  ctx.fillStyle = hot ? INK : '#fff'; ctx.textAlign = 'center'; ctx.font = `700 46px ${FONT}`; ctx.fillText('¡Entendido!', W / 2, H - 118);
  VR.helpRect = { x: W / 2 - 220, y: H - 170, w: 440, h: 100 };
  P.tex.needsUpdate = true;
}

// ----- reloj de la muñeca -----
function drawWrist(A) {
  const P = VR.panels.wrist, ctx = P.ctx, W = P.canvas.width, H = P.canvas.height;
  const txt = id => ($(id) && !$(id).classList.contains('hidden')) ? $(id).textContent : '';
  const str = parseFloat($('strBar') && $('strBar').style.width) || 0;
  const gt = A.guideTarget && A.guideTarget();
  let arrow = null;
  if (gt) { const px = A.player.inCar ? A.car.x : A.player.x, pz = A.player.inCar ? A.car.y : A.player.y, dx = gt.x - px, dz = gt.y - pz, d = Math.hypot(dx, dz); if (d > 40) arrow = { a: Math.atan2(dx, -dz) - VRX.yaw, d }; }
  const hot = !!VR.wristHit;
  const key = [txt('clock'), txt('phasePill'), $('hearts').textContent, Math.round(str), txt('gualyCount'), A.S.money, arrow ? Math.round(arrow.a * 12) + '|' + Math.round(arrow.d / 20) : '', A.night, hot].join('~');
  if (key === VR.wristKey) return; VR.wristKey = key;
  ctx.clearRect(0, 0, W, H);
  card(ctx, 6, 6, W - 12, H - 20, A.night ? '#2e2266' : PAPER, 30, 6, 6);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = A.night ? '#fff' : INK;
  ctx.font = `700 34px ${FONT}`; ctx.fillText(txt('clock'), 28, 48, W - 150);
  ctx.font = `600 24px ${FONT}`; ctx.fillText(txt('phasePill'), 28, 92, W - 150);
  ctx.font = `30px ${FONT}`; ctx.fillText($('hearts').textContent, 28, 140);
  // fuerza
  ctx.font = `28px ${FONT}`; ctx.fillText('💪', 28, 190);
  ctx.fillStyle = '#ddd'; roundRect(ctx, 76, 178, 250, 24, 12); ctx.fill();
  ctx.fillStyle = str < 25 ? '#e53935' : ACCENT; roundRect(ctx, 76, 178, Math.max(12, 250 * str / 100), 24, 12); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 3; roundRect(ctx, 76, 178, 250, 24, 12); ctx.stroke();
  ctx.fillStyle = A.night ? '#fff' : INK; ctx.font = `600 26px ${FONT}`;
  ctx.fillText('🪙 ' + A.noros(A.S.money), 28, 238, W - 56);
  const g = txt('gualyCount'); if (g) { ctx.font = `700 28px ${FONT}`; ctx.fillText(g, 28, 280); }
  // flecha hacia donde ir
  if (arrow) {
    ctx.save(); ctx.translate(W - 82, 100); ctx.rotate(arrow.a);
    ctx.fillStyle = ACCENT; ctx.strokeStyle = INK; ctx.lineWidth = 5; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(0, -46); ctx.lineTo(34, 30); ctx.lineTo(0, 14); ctx.lineTo(-34, 30); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    ctx.fillStyle = A.night ? '#fff' : INK; ctx.textAlign = 'center'; ctx.font = `600 22px ${FONT}`; ctx.fillText(Math.round(arrow.d / SCALE) + ' m', W - 82, 168);
  }
  // botón del menú rápido: se toca apuntando con el otro mando (o pellizcando con la otra mano)
  card(ctx, W - 170, H - 100, 150, 62, hot ? SUN : '#ffffff', 22, 5, 5);
  ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.font = `700 30px ${FONT}`; ctx.fillText('☰ Menú', W - 95, H - 66);
  P.tex.needsUpdate = true;
}

// ----- avisos y cartel de la acción (delante de ti, abajo) -----
function drawBand(A) {
  const P = VR.panels.band, ctx = P.ctx, W = P.canvas.width, H = P.canvas.height;
  const toastEl = $('toast'), tOn = toastEl && parseFloat(toastEl.style.opacity) > 0.05 && toastEl.textContent.trim();
  const aOn = $('actionBtn') && !$('actionBtn').classList.contains('hidden') && !A.paused;
  const tTxt = tOn ? toastEl.textContent.trim() : '', aTxt = aOn ? ($('actionIco').textContent + ' ' + $('actionTxt').textContent) : '';
  const key = tTxt + '|' + aTxt + '|' + (toastEl && toastEl.classList.contains('night'));
  P.mesh.visible = !!(tTxt || aTxt);
  if (key === VR.band.lastKey) return; VR.band.lastKey = key;
  ctx.clearRect(0, 0, W, H);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  let y = H - 14;
  if (aTxt) {
    ctx.font = `700 62px ${FONT}`; const h = 120, w = Math.min(W - 40, ctx.measureText(aTxt).width + 190);
    y -= h; const x0 = (W - w) / 2;
    card(ctx, x0, y, w, h, '#9be7ff', 52, 8, 8);
    ctx.fillStyle = ACCENT; ctx.beginPath(); ctx.arc(x0 + 68, y + h / 2, 40, 0, PI * 2); ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = INK; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `700 44px ${FONT}`; ctx.fillText('A', x0 + 68, y + h / 2 + 3);
    ctx.fillStyle = INK; ctx.font = `700 60px ${FONT}`; ctx.fillText(aTxt, x0 + 120 + (w - 150) / 2, y + h / 2 + 3, w - 150);
    y -= 22;
  }
  if (tTxt) {
    const night = toastEl.classList.contains('night');
    ctx.font = `600 46px ${FONT}`;
    const lines = []; { let line = ''; for (const wd of tTxt.split(/\s+/)) { const t = line ? line + ' ' + wd : wd; if (ctx.measureText(t).width > W - 150 && line) { lines.push(line); line = wd; } else line = t; } if (line) lines.push(line); }
    const l = lines.slice(0, 3), h = 36 + l.length * 58, ty = Math.max(8, y - h);
    card(ctx, 20, ty, W - 40, h, night ? '#2e2266' : PAPER, 40, 8, 8);
    ctx.fillStyle = night ? '#fff' : INK;
    l.forEach((s2, k) => ctx.fillText(s2, W / 2, ty + 18 + 29 + k * 58 + 2, W - 110));
  }
  P.tex.needsUpdate = true;
}

// ---------- los menús del juego (HTML) pintados en una pantalla flotante ----------
let domObserver = null;
const svgCache = new Map();
const M_PER_CSS = 0.0027;

function activeDom() {
  const ov = [...document.querySelectorAll('.overlay:not(.hidden)')];
  if (ov.length) return ov[ov.length - 1].querySelector('.panel') || ov[ov.length - 1];
  const d = $('decor'); if (d && !d.classList.contains('hidden')) return d;
  return null;
}
function px(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function rgbaAlpha(c) { if (!c || c === 'transparent') return 0; const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return 1; const p = m[1].split(','); return p.length > 3 ? parseFloat(p[3]) : 1; }
function radiiOf(cs, r) {
  const cor = v => { const p = (v || '0px').split(' '), f = (s, ref) => s.endsWith('%') ? parseFloat(s) / 100 * ref : px(s); return { x: f(p[0], r.width), y: f(p[1] || p[0], r.height) }; };
  const R = [cor(cs.borderTopLeftRadius), cor(cs.borderTopRightRadius), cor(cs.borderBottomRightRadius), cor(cs.borderBottomLeftRadius)];
  const f = Math.min(1, r.width / Math.max(1e-6, R[0].x + R[1].x), r.width / Math.max(1e-6, R[3].x + R[2].x), r.height / Math.max(1e-6, R[0].y + R[3].y), r.height / Math.max(1e-6, R[1].y + R[2].y));
  return R.map(q => ({ x: q.x * f, y: q.y * f }));
}
function pathBox(ctx, x, y, w, h, R) { ctx.beginPath(); if (R.some(q => q.x > 0.1 || q.y > 0.1)) ctx.roundRect(x, y, w, h, R); else ctx.rect(x, y, w, h); }
function parseShadow(s) {
  if (!s || s === 'none') return null;
  const m = /(rgba?\([^)]+\)|#[0-9a-fA-F]+)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px(?:\s+(-?[\d.]+)px)?/.exec(s);
  if (!m || /inset/.test(s)) return null;
  return { color: m[1], x: +m[2], y: +m[3], blur: +m[4], spread: +(m[5] || 0) };
}
function drawBox(el, cs, r, ctx) {
  const R = radiiOf(cs, r), bgA = rgbaAlpha(cs.backgroundColor);
  const sh = parseShadow(cs.boxShadow);
  if (sh && bgA > 0.5) { ctx.save(); ctx.fillStyle = sh.color; if (sh.blur > 0) { ctx.shadowColor = sh.color; ctx.shadowBlur = sh.blur * VR.dom.k; ctx.shadowOffsetX = sh.x * VR.dom.k; ctx.shadowOffsetY = sh.y * VR.dom.k; pathBox(ctx, r.left, r.top, r.width, r.height, R); } else pathBox(ctx, r.left + sh.x - sh.spread, r.top + sh.y - sh.spread, r.width + 2 * sh.spread, r.height + 2 * sh.spread, R); ctx.fill(); ctx.restore(); }
  if (bgA > 0) { ctx.fillStyle = cs.backgroundColor; pathBox(ctx, r.left, r.top, r.width, r.height, R); ctx.fill(); }
  const bt = px(cs.borderTopWidth), br = px(cs.borderRightWidth), bb = px(cs.borderBottomWidth), bl = px(cs.borderLeftWidth);
  if (bt > 0 && bt === br && br === bb && bb === bl && cs.borderTopStyle !== 'none' && rgbaAlpha(cs.borderTopColor) > 0) {
    ctx.strokeStyle = cs.borderTopColor; ctx.lineWidth = bt;
    pathBox(ctx, r.left + bt / 2, r.top + bt / 2, r.width - bt, r.height - bt, R.map(q => ({ x: Math.max(0, q.x - bt / 2), y: Math.max(0, q.y - bt / 2) }))); ctx.stroke();
  } else {
    if (bt > 0 && cs.borderTopStyle !== 'none') { ctx.fillStyle = cs.borderTopColor; ctx.fillRect(r.left, r.top, r.width, bt); }
    if (bb > 0 && cs.borderBottomStyle !== 'none') { ctx.fillStyle = cs.borderBottomColor; ctx.fillRect(r.left, r.bottom - bb, r.width, bb); }
    if (bl > 0 && cs.borderLeftStyle !== 'none') { ctx.fillStyle = cs.borderLeftColor; ctx.fillRect(r.left, r.top, bl, r.height); }
    if (br > 0 && cs.borderRightStyle !== 'none') { ctx.fillStyle = cs.borderRightColor; ctx.fillRect(r.right - br, r.top, br, r.height); }
  }
  const ow = px(cs.outlineWidth);
  if (ow > 0 && cs.outlineStyle !== 'none' && rgbaAlpha(cs.outlineColor) > 0) {
    const off = px(cs.outlineOffset) + ow / 2; ctx.strokeStyle = cs.outlineColor; ctx.lineWidth = ow;
    pathBox(ctx, r.left - off, r.top - off, r.width + 2 * off, r.height + 2 * off, R.map(q => ({ x: q.x + off, y: q.y + off }))); ctx.stroke();
  }
  return { bt, br, bb, bl };
}
function fontOf(cs) { return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; }
function drawWord(ctx, s, rc) {
  const m = ctx.measureText(s), asc = m.fontBoundingBoxAscent || 0, desc = m.fontBoundingBoxDescent || 0;
  ctx.fillText(s, rc.left, rc.top + rc.height / 2 + (asc - desc) / 2);
}
function drawText(node, cs, ctx) {
  const txt = node.nodeValue; if (!txt || !/\S/.test(txt)) return;
  ctx.font = fontOf(cs); ctx.fillStyle = cs.color; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  try { ctx.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing; } catch (e) {}
  const upper = cs.textTransform === 'uppercase', fsz = px(cs.fontSize) || 16, rng = document.createRange(), re = /\S+/g;
  let m;
  while ((m = re.exec(txt))) {
    rng.setStart(node, m.index); rng.setEnd(node, m.index + m[0].length);
    const rects = rng.getClientRects(); if (!rects.length) continue;
    const word = upper ? m[0].toUpperCase() : m[0];
    if (rects.length === 1 && rects[0].height < fsz * 2.4) drawWord(ctx, word, rects[0]);
    else for (let i = 0; i < m[0].length; i++) { rng.setStart(node, m.index + i); rng.setEnd(node, m.index + i + 1); const rc = rng.getBoundingClientRect(); if (rc.width) drawWord(ctx, upper ? m[0][i].toUpperCase() : m[0][i], rc); }
  }
}
function drawSvg(el, r, ctx) {
  const key = el.outerHTML + '|' + Math.round(r.width) + 'x' + Math.round(r.height);
  let it = svgCache.get(key);
  if (!it) {
    it = { img: new Image(), ready: false }; svgCache.set(key, it);
    let s = new XMLSerializer().serializeToString(el);
    if (!/xmlns=/.test(s.slice(0, 200))) s = s.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    s = s.replace('<svg', `<svg width="${Math.round(r.width)}" height="${Math.round(r.height)}"`);
    it.img.onload = () => { it.ready = true; VR.dom.dirty = true; };
    it.img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
  }
  if (it.ready) ctx.drawImage(it.img, r.left, r.top, r.width, r.height);
}
function drawInput(el, cs, r, b, ctx) {
  const type = (el.type || 'text').toLowerCase();
  if (type === 'range') {
    const min = +el.min || 0, max = +el.max || 100, f = clamp((+el.value - min) / Math.max(1e-6, max - min), 0, 1), cy = r.top + r.height / 2, x0 = r.left + 10, x1 = r.right - 10;
    ctx.fillStyle = '#d9d4e6'; roundRect(ctx, x0, cy - 4, x1 - x0, 8, 4); ctx.fill();
    ctx.fillStyle = ACCENT; roundRect(ctx, x0, cy - 4, Math.max(8, (x1 - x0) * f), 8, 4); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.strokeStyle = ACCENT; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x0 + (x1 - x0) * f, cy, 10, 0, PI * 2); ctx.fill(); ctx.stroke();
    return;
  }
  if (type === 'text' || type === 'number' || type === 'search') {
    ctx.font = fontOf(cs); ctx.fillStyle = cs.color; ctx.textBaseline = 'middle';
    const s = el.value || '', w = ctx.measureText(s).width, inner = r.width - b.bl - b.br - px(cs.paddingLeft) - px(cs.paddingRight);
    ctx.textAlign = 'left';
    const x = cs.textAlign === 'center' ? r.left + b.bl + px(cs.paddingLeft) + (inner - w) / 2 : r.left + b.bl + px(cs.paddingLeft);
    ctx.fillText(s, x, r.top + r.height / 2 + 1);
  }
}
function walk(el, ctx, alpha) {
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden') return;
  const op = parseFloat(cs.opacity); alpha *= isNaN(op) ? 1 : op; if (alpha <= 0.01) return;
  const tag = el.tagName.toLowerCase();
  const r = el.getBoundingClientRect();
  ctx.save(); ctx.globalAlpha = alpha;
  if (tag === 'svg') { drawSvg(el, r, ctx); ctx.restore(); return; }
  const b = drawBox(el, cs, r, ctx);
  if (tag === 'canvas') { try { ctx.drawImage(el, r.left + b.bl + px(cs.paddingLeft), r.top + b.bt + px(cs.paddingTop), r.width - b.bl - b.br - px(cs.paddingLeft) - px(cs.paddingRight), r.height - b.bt - b.bb - px(cs.paddingTop) - px(cs.paddingBottom)); } catch (e) {} ctx.restore(); return; }
  if (tag === 'img') { if (el.complete && el.naturalWidth) { try { ctx.drawImage(el, r.left + b.bl, r.top + b.bt, r.width - b.bl - b.br, r.height - b.bt - b.bb); } catch (e) {} } ctx.restore(); return; }
  if (tag === 'input') { drawInput(el, cs, r, b, ctx); ctx.restore(); return; }
  if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') { pathBox(ctx, r.left + b.bl, r.top + b.bt, r.width - b.bl - b.br, r.height - b.bt - b.bb, radiiOf(cs, r)); ctx.clip(); }
  for (const ch of el.childNodes) {
    if (ch.nodeType === 1) walk(ch, ctx, alpha);
    else if (ch.nodeType === 3) { ctx.globalAlpha = alpha; drawText(ch, cs, ctx); }
  }
  ctx.restore();
}
function paintDom(root, canvas) {
  const r = root.getBoundingClientRect(), PAD = 14;
  const cw = Math.max(60, r.width + PAD * 2), ch = Math.max(60, r.height + PAD * 2), k = Math.min(2, 2048 / Math.max(cw, ch));
  const W = Math.round(cw * k), H = Math.round(ch * k);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
  ctx.setTransform(k, 0, 0, k, -(r.left - PAD) * k, -(r.top - PAD) * k);
  VR.dom.k = k;
  if (rgbaAlpha(getComputedStyle(root).backgroundColor) < 0.5) { // la portada y otros no tienen fondo propio: se les pone una placa
    ctx.fillStyle = 'rgba(27,20,64,0.92)'; ctx.beginPath(); ctx.roundRect(r.left - PAD + 2, r.top - PAD + 2, cw - 4, ch - 4, 34); ctx.fill();
  }
  walk(root, ctx, 1);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return { left: r.left - PAD, top: r.top - PAD, w: cw, h: ch, k, W, H };
}
// el panel DOM se repinta cuando cambia algo
function markDirty() { VR.dom.dirty = true; }
function startObserver(target) {
  if (domObserver) domObserver.disconnect();
  domObserver = new MutationObserver(recs => {
    for (const m of recs) { // el juego reescribe algunos textos en cada fotograma con el mismo valor: eso no cuenta
      if (m.type === 'characterData' && m.oldValue === m.target.nodeValue) continue;
      if (m.type === 'childList' && m.addedNodes.length === 1 && m.removedNodes.length === 1 && m.addedNodes[0].nodeType === 3 && m.removedNodes[0].nodeType === 3 && m.addedNodes[0].nodeValue === m.removedNodes[0].nodeValue) continue;
      markDirty(); return;
    }
  });
  domObserver.observe(target, { subtree: true, childList: true, attributes: true, characterData: true, characterDataOldValue: true, attributeFilter: ['class', 'style', 'disabled', 'value', 'src'] });
  if (!VR.dom.listeners) { VR.dom.listeners = true; document.addEventListener('scroll', markDirty, true); document.addEventListener('load', markDirty, true); document.addEventListener('input', markDirty, true); }
}

// ---------- abrir y cerrar pantallas ----------
function openModal(kind) {
  if (VR.modal === kind) return;
  const A = VRX.api;
  if (!VR.modal && !A.paused) { VR.pausedByMe = true; window.__chupi.fn.paused = true; } // con el menú rápido abierto el juego espera
  VR.modal = kind; VR.hover = null; placeInFront(VR.panels[kind], 1.3);
  if (kind === 'hub') drawHub(); else if (kind === 'help') drawHelp();
  const p = VR.panels[kind]; if (p) p.mesh.visible = true;
}
function closeModal() {
  if (!VR.modal) return;
  const p = VR.panels[VR.modal]; if (p) p.mesh.visible = false;
  VR.modal = null; VR.hover = null;
  if (VR.pausedByMe) { VR.pausedByMe = false; window.__chupi.fn.syncPaused(); }
}
function placeInFront(P, dist) {
  if (!P) return;
  const cam = VR.cam, f = tmpV.set(0, 0, -1).applyQuaternion(cam.quaternion); f.y = 0; if (f.lengthSq() < 1e-4) f.set(0, 0, -1); f.normalize();
  const yaw = Math.atan2(-f.x, -f.z);
  P.mesh.position.set(cam.position.x + f.x * dist, cam.position.y - 0.08, cam.position.z + f.z * dist);
  P.mesh.rotation.set(0, yaw, 0); P.mesh.updateMatrix();
}
function closeTopOverlay() {
  const ov = [...document.querySelectorAll('.overlay:not(.hidden)')].pop();
  if (!ov) { const d = $('decor'); if (d && !d.classList.contains('hidden')) $('decorClose').click(); return; }
  if (ov.id === 'bigMsg') { $('bigOk').click(); return; }
  if (ov.id === 'ageAsk') { $('ageOk').click(); return; }
  const c = $(ov.id + 'Close') || ov.querySelector('.close'); if (c) c.click();
}

// ---------- mandos, andar y girar ----------
const BTN = { trigger: 0, grip: 1, stick: 3, a: 4, b: 5 };
function pollPads(frame) {
  const pads = {};
  for (const src of frame.session.inputSources) {
    const gp = src.gamepad;
    const h = src.handedness === 'left' ? 'left' : 'right';
    const prev = VR.pads[h] ? VR.pads[h].cur : [];
    let cur, ax, noStick;
    if (gp && gp.buttons && gp.buttons.length > 1) {
      cur = gp.buttons.map(b => !!b.pressed);
      noStick = gp.axes.length < 2;
      ax = noStick ? [0, 0] : gp.axes.length >= 4 ? [gp.axes[2], gp.axes[3]] : [gp.axes[0] || 0, gp.axes[1] || 0];
    } else { // manos: solo hay pellizco (y a veces puño); no hay palancas
      cur = []; cur[BTN.trigger] = !!(VR.sel[h + 'select'] || (gp && gp.buttons && gp.buttons[0] && gp.buttons[0].pressed)); cur[BTN.grip] = !!VR.sel[h + 'squeeze']; ax = [0, 0]; noStick = true;
    }
    pads[h] = { cur, prev, ax, src, noStick, down: i => !!cur[i] && !prev[i] };
  }
  VR.pads = pads;
}
function dz(v) { return Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82; }
function buzz(hand, strength = 0.5, ms = 40) {
  try { const p = VR.pads[hand]; const act = p && p.src.gamepad.hapticActuators && p.src.gamepad.hapticActuators[0]; if (act && act.pulse) act.pulse(strength, ms); } catch (e) {}
}
function headLocalYaw() { const f = tmpV2.set(0, 0, -1).applyQuaternion(VR.cam.quaternion); return Math.atan2(-f.x, -f.z); }
function carPsi(a) { return Math.atan2(-Math.cos(a), -Math.sin(a)); }
function angDiff(a, b) { return ((a - b + PI * 3) % (PI * 2)) - PI; }

function stateKey(A) { const P = A.player; return [P.inCar ? 1 : 0, P.inHouse ? 1 : 0, P.inPlace || '', P.level, P.pose].join(','); }

function onFrame(t, frame) {
  if (!frame || !VR.session) return;
  const A = VRX.api, r = A.renderer, P = A.player;
  r.xr.getCamera(VR.cam); // la posición y el giro de tu cabeza en este fotograma (en metros, respecto al suelo de tu sala)
  const dt = VR.lastT ? clamp((t - VR.lastT) / 1000, 0.001, 0.1) : 0.016; VR.lastT = t; VR.frames++; VR.dt = dt;
  pollPads(frame);
  attachWrist();
  if (VR.frames === 2 && (VR.modal === 'help' || VR.modal === 'hub')) placeInFront(VR.panels[VR.modal], 1.3);
  const L = VR.pads.left, R = VR.pads.right;
  const hy = headLocalYaw();
  if (VR.hearts !== undefined && P.hearts < VR.hearts) { buzz('left', 1, 160); buzz('right', 1, 160); }
  VR.hearts = P.hearts;
  // en el coche, "delante" es hacia donde mira el coche; si no, hacia donde miras
  VRX.yaw = P.inCar ? carPsi(A.car.a) + (VR.anchor && VR.anchor.car ? angDiff(hy, VR.anchor.local) : 0) : hy + VR.rigYaw;
  // cambios de sitio: un parpadeo para no marear
  const sk = stateKey(A);
  if (sk !== VR.lastState) {
    const prev = VR.lastState.split(','), now = sk.split(',');
    if (VR.lastState && (prev[0] !== now[0] || prev[1] !== now[1] || prev[2] !== now[2] || prev[3] !== now[3])) VR.fade = 1;
    VR.lastState = sk;
    collectLights(A.scene);
    if (P.inCar && !VR.anchor) VR.anchor = { local: hy, car: true };
    else if (!P.inCar && VR.anchor && VR.anchor.car) { VR.anchor = null; }
    if ((P.pose === 'sit' || P.pose === 'lie') && P.seat) { VR.anchor = { local: hy, psi: P.seat.ry + PI, seat: true }; }
    else if (VR.anchor && VR.anchor.seat) { VR.anchor = null; }
  }
  if (VR.anchor && VR.anchor.car) VR.rigYaw = carPsi(A.car.a) - VR.anchor.local;
  else if (VR.anchor && VR.anchor.seat) VR.rigYaw = VR.anchor.psi - VR.anchor.local;

  // palanca izquierda = andar; derecha = girar a saltitos (o hacer scroll en los menús, o subir/bajar escaleras)
  const modal = !!(VR.modal || VR.domOpen);
  const inside = !!(P.inHouse || P.inPlace);
  VRX.walk = (inside ? 0.3 : 0.4) * cfg.speed;
  VRX.mx = VRX.my = 0;
  if (L && !modal) {
    if (!L.noStick) { VRX.mx = dz(L.ax[0]); VRX.my = dz(L.ax[1]); }
    else if (L.cur[BTN.trigger]) { // con las manos: mientras pellizcas con la izquierda, andas hacia donde apunta esa mano
      const c = VR.ctrl.find(q => q && q.userData.handed === 'left'), rr = rayOf(c);
      if (rr) { const psi = Math.atan2(-rr.d.x, -rr.d.z) + VR.rigYaw, th = psi - VRX.yaw; VRX.mx = -Math.sin(th); VRX.my = -Math.cos(th); }
    }
  }
  if (R && !R.noStick) {
    const x = R.ax[0], y = R.ax[1];
    if (!modal) {
      if (!VR.anchor || !VR.anchor.car) {
        if (Math.abs(x) > 0.7 && !VR.turned) { VR.turned = true; VR.turnFlash = 0.6; const s = Math.sign(x) * cfg.snap * PI / 180; if (VR.anchor) { VR.anchor.local += s; VR.rigYaw = VR.anchor.psi - VR.anchor.local; } else VR.rigYaw -= s; }
        else if (Math.abs(x) < 0.4) VR.turned = false;
      }
      if (Math.abs(y) > 0.8 && !VR.stairs && inside) { VR.stairs = true; const b = $(y < 0 ? 'upBtn' : 'downBtn'); if (b && !b.classList.contains('hidden')) b.click(); }
      else if (Math.abs(y) < 0.4) VR.stairs = false;
    }
  }
  // botones. El gatillo hace de ratón en los menús y, si no hay menú, es la linterna. Apuntando al reloj de la muñeca, abre el menú rápido.
  const trig = [L && L.down(BTN.trigger) && 'left', R && R.down(BTN.trigger) && 'right'].filter(Boolean);
  const act = (L && !L.noStick && (L.down(BTN.a) || L.down(BTN.grip))) || (R && (R.down(BTN.a) || R.down(BTN.grip)));
  const menu = (L && L.down(BTN.b)) || (R && R.down(BTN.b));
  if (VR.modal === 'hub' || VR.modal === 'help') {
    for (const h of trig) clickPanel(h);
    if (menu) closeModal();
  } else if (VR.domOpen) {
    for (const h of trig) clickDom(h);
    if (menu) closeTopOverlay();
  } else {
    const actionOn = $('actionBtn') && !$('actionBtn').classList.contains('hidden');
    for (const h of trig) {
      const pad = VR.pads[h];
      if (VR.wristHit && VR.wristHit.hand === h) { openModal('hub'); buzz(h, 0.4, 30); }
      else if (pad.noStick && h === 'left') { /* con las manos, el pellizco izquierdo es andar */ }
      else if (pad.noStick && actionOn) { A.doAction(); buzz(h, 0.5, 40); } // con las manos, pellizcar usa lo que diga el cartel; si no hay cartel, es la linterna
      else { A.useFlash(); buzz(h, 0.7, 60); }
    }
    if (act) { A.doAction(); buzz(R ? 'right' : 'left', 0.5, 40); }
    if (menu) openModal('hub');
  }
  // si arrastras una barra (el volumen, por ejemplo) con el gatillo apretado, la barra te sigue
  if (VR.drag) {
    const pad = VR.pads[VR.drag.hand], h = VR.hits && VR.hits[VR.drag.hand];
    if (!pad || !pad.cur[BTN.trigger] || !VR.domOpen) VR.drag = null;
    else if (h && VR.dom.info) setRange(VR.drag.el, VR.dom.info.left + h.u * VR.dom.info.w);
  }
  // andar con el cuerpo de verdad: los pasos que das en tu sala mueven al personaje (y chocan con las paredes y los muebles)
  const hx = VR.cam.position.x, hz = VR.cam.position.z;
  if (VR.prevHead) {
    const dx = hx - VR.prevHead.x, dz2 = hz - VR.prevHead.z, c = Math.cos(VR.rigYaw), s = Math.sin(VR.rigYaw);
    const wx = (dx * c + dz2 * s) * SCALE, wz = (-dx * s + dz2 * c) * SCALE;
    if (Math.hypot(wx, wz) < 60 && Math.hypot(wx, wz) > 0.001) physical(A, wx, wz);
  }
  VR.prevHead = { x: hx, z: hz };
  VR.fade = Math.max(0, VR.fade - dt * 3.2);
  try { A.loop(t); VR.errors = 0; }
  catch (e) {
    console.error('VR: fallo en el fotograma', e);
    VR.errors = (VR.errors || 0) + 1;
    if (VR.errors > 90) { VR.errorMsg = String((e && e.message) || e); if (VR.session) VR.session.end(); } // 90 fallos seguidos: se sale de VR
  }
}

function physical(A, wx, wz) {
  const P = A.player; if (P.inCar || P.pose !== 'stand' || P.act) return;
  if (P.inHouse || P.inPlace) {
    const rm = A.curRoom(); if (!rm) return;
    const e = { x: P.ix, y: P.iy }; A.moveCircle(e, wx, wz, 6, rm.solids); P.ix = e.x; P.iy = e.y;
  } else A.moveCircle(P, wx, wz, 7);
}

// ---------- apuntar a las pantallas con el mando ----------
function rayOf(c) {
  if (!c || !c.visible) return null;
  const o = tmpV.setFromMatrixPosition(c.matrix).clone(), d = new Tj.Vector3(0, 0, -1).applyQuaternion(tmpQ.setFromRotationMatrix(c.matrix));
  return { o, d };
}
function hitPanel(ray, P) {
  P.mesh.updateMatrix();
  const inv = tmpM.copy(P.mesh.matrix).invert(), o = ray.o.clone().applyMatrix4(inv), d = ray.d.clone().transformDirection(inv);
  if (Math.abs(d.z) < 1e-6) return null;
  const t = -o.z / d.z; if (t <= 0) return null;
  const x = o.x + d.x * t, y = o.y + d.y * t;
  if (Math.abs(x) > 0.5 || Math.abs(y) > 0.5) return null;
  const world = new Tj.Vector3(x, y, 0).applyMatrix4(P.mesh.matrix);
  return { u: x + 0.5, v: 0.5 - y, dist: world.distanceTo(ray.o), world };
}
function activePanelFor() {
  if (VR.modal === 'hub' || VR.modal === 'help') return VR.panels[VR.modal];
  if (VR.domOpen) return VR.panels.dom;
  return null;
}
function hitWrist(c) {
  const m = VR.panels.wrist.mesh, rig = VR.rig; if (!m.parent || !m.visible || !c) return null;
  const rr = rayOf(c); if (!rr) return null;
  rig.updateMatrixWorld(true); m.updateWorldMatrix(true, false);
  const o = rr.o.clone().applyMatrix4(rig.matrixWorld), d = rr.d.clone().transformDirection(rig.matrixWorld);
  const inv = new Tj.Matrix4().copy(m.matrixWorld).invert(), lo = o.applyMatrix4(inv), ld = d.transformDirection(inv);
  if (Math.abs(ld.z) < 1e-6) return null;
  const t = -lo.z / ld.z; if (t <= 0) return null;
  const x = lo.x + ld.x * t, y = lo.y + ld.y * t;
  if (Math.abs(x) > 0.6 || Math.abs(y) > 0.7) return null; // un poco de margen: es pequeño
  const wp = new Tj.Vector3(x, y, 0).applyMatrix4(m.matrixWorld).applyMatrix4(new Tj.Matrix4().copy(rig.matrixWorld).invert());
  return { dist: wp.distanceTo(rr.o), world: wp };
}
function updatePointers(A) {
  const P = activePanelFor();
  VR.hits = {}; VR.wristHit = null;
  let best = null;
  for (const c of VR.ctrl) {
    if (!c) continue;
    const ray = c.userData.ray, dot = c.userData.dot || c.userData.dotMesh, h = c.userData.handed || 'right';
    if (!ray || !dot) continue;
    if (!P) { // sin menú abierto: el rayo solo se ve cuando apuntas al reloj de la muñeca
      ray.visible = false; dot.visible = false;
      if (h !== 'left') {
        const wh = hitWrist(c);
        if (wh) { ray.visible = true; ray.scale.z = wh.dist; ray.position.z = -wh.dist / 2; ray.material.opacity = 0.9; dot.visible = true; dot.position.copy(wh.world); dot.quaternion.copy(VR.cam.quaternion); VR.wristHit = { hand: h }; }
      }
      continue;
    }
    const rr = rayOf(c); if (!rr) { ray.visible = false; dot.visible = false; continue; }
    const hit = hitPanel(rr, P);
    ray.visible = true;
    const len = hit ? hit.dist : 2.2; ray.scale.z = len; ray.position.z = -len / 2;
    ray.material.opacity = hit ? 0.95 : 0.35;
    dot.visible = !!hit;
    if (hit) { dot.position.copy(hit.world); dot.quaternion.copy(P.mesh.quaternion); dot.translateZ(0.004); VR.hits[h] = hit; if (!best || hit.dist < best.dist) best = Object.assign({ hand: h }, hit); }
  }
  // qué hay bajo el puntero
  let hv = null;
  if (best) {
    if (VR.modal === 'hub') { const rects = VR.hubRects || []; const x = best.u * P.canvas.width, y = best.v * P.canvas.height; const i = rects.findIndex(q => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h); hv = { panel: 'hub', idx: i }; if (i < 0) hv = null; }
    else if (VR.modal === 'help') { const q = VR.helpRect, x = best.u * P.canvas.width, y = best.v * P.canvas.height; if (q && x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h) hv = { panel: 'help' }; }
    else if (VR.domOpen && VR.dom.info) { const info = VR.dom.info, cx = info.left + best.u * info.w, cy = info.top + best.v * info.h, el = domTarget(cx, cy); hv = { panel: 'dom', el, cx, cy }; }
  }
  const prev = VR.hover;
  const same = (!prev && !hv) || (prev && hv && prev.panel === hv.panel && prev.idx === hv.idx && prev.el === hv.el);
  VR.hover = hv; VR.hoverHand = best ? best.hand : null;
  if (!same) { if (VR.modal === 'hub') drawHub(); else if (VR.modal === 'help') drawHelp(); else VR.dom.view = true; }
  // scroll con la palanca del mando que apunta al menú (cualquiera de los dos)
  if (VR.domOpen && VR.dom.info) {
    for (const h of ['right', 'left']) {
      const hit = VR.hits[h], pad = VR.pads[h]; if (!hit || !pad) continue;
      const y = dz(pad.ax[1]); if (!y) continue;
      const info = VR.dom.info, el = domTarget(info.left + hit.u * info.w, info.top + hit.v * info.h), sc = el && scrollable(el);
      if (sc) { sc.scrollTop += y * 700 * (VR.dt || 0.014); markDirty(); break; }
    }
  }
}
function scrollable(el) {
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 2) return e;
  }
  return null;
}
function domTarget(cx, cy) {
  const root = VR.dom.el; if (!root) return null;
  const list = document.elementsFromPoint(cx, cy);
  for (const e of list) if (root.contains(e) && e !== root) return e;
  return null;
}
function clickable(el) { return el && el.closest ? el.closest('button, a, input, label, select, [role="button"]') : null; }

function clickPanel(hand) {
  if (VR.modal === 'hub') {
    const h = VR.hits[hand]; if (!h || !VR.hubRects) return;
    const P = VR.panels.hub, x = h.u * P.canvas.width, y = h.v * P.canvas.height;
    const i = VR.hubRects.findIndex(q => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h); if (i < 0) return;
    const it = VR.hubList[i]; buzz(hand, 0.4, 30);
    if (it.keepModal) { it.fn(); return; }
    if (!it.keep) closeModal();
    it.fn(); if (it.keep) drawHub();
  } else if (VR.modal === 'help') {
    const h = VR.hits[hand]; if (!h || !VR.helpRect) return;
    const P = VR.panels.help, x = h.u * P.canvas.width, y = h.v * P.canvas.height, q = VR.helpRect;
    if (x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h) { buzz(hand, 0.4, 30); closeModal(); }
  }
}
function clickDom(hand) {
  const h = VR.hits[hand], info = VR.dom.info; if (!h || !info) return;
  const cx = info.left + h.u * info.w, cy = info.top + h.v * info.h, el = domTarget(cx, cy); if (!el) return;
  buzz(hand, 0.4, 30);
  const tgt = clickable(el) || el;
  if (tgt.tagName === 'INPUT' && tgt.type === 'range') { setRange(tgt, cx); VR.drag = { el: tgt, hand }; return; }
  const ev = (type, C) => tgt.dispatchEvent(new C(type, { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 77, pointerType: 'mouse', isPrimary: true, button: 0, buttons: type.endsWith('down') ? 1 : 0 }));
  ev('pointerdown', PointerEvent); ev('mousedown', MouseEvent); ev('pointerup', PointerEvent); ev('mouseup', MouseEvent);
  tgt.click();
  setTimeout(markDirty, 30); setTimeout(markDirty, 250);
}
function setRange(el, cx) {
  const r = el.getBoundingClientRect(), f = clamp((cx - (r.left + 10)) / Math.max(1, r.width - 20), 0, 1), min = +el.min || 0, max = +el.max || 100, step = +el.step || 1;
  el.value = String(Math.round((min + f * (max - min)) / step) * step);
  el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  markDirty();
}

// ---------- poner la cámara (la cabeza) donde está el jugador ----------
VRX.pose = function () {
  const A = VRX.api, P = A.player;
  if (!VR.rig || !VR.cam) return;
  let px, pz, base;
  const c = VR.cam;
  if (P.inCar) {
    const g = A.carGroup; g.updateMatrixWorld(true);
    tmpV.set(-4, 27, 0); g.localToWorld(tmpV); px = tmpV.x; pz = tmpV.z; base = tmpV.y - 1.6 * SCALE;
  } else if (P.inHouse || P.inPlace) {
    const rm = A.curRoom(); px = P.ix; pz = P.iy; base = rm ? rm.floorY : A.GY;
    if (P.pose === 'sit') base -= 6; else if (P.pose === 'lie') base -= 14;
  } else { px = P.x; pz = P.y; base = A.groundY(P.x, P.y); }
  base += VR.eyeOffset * SCALE + (cfg.seated ? 0.45 * SCALE : 0); // sentado en el sofá de verdad: se sube la vista para no ver el mundo desde abajo
  if (Math.abs(base - VR.baseY) > 30 || VR.frames < 3) VR.baseY = base; else VR.baseY += (base - VR.baseY) * 0.25;
  const rig = VR.rig, hx = c.position.x * SCALE, hz = c.position.z * SCALE, cs = Math.cos(VR.rigYaw), sn = Math.sin(VR.rigYaw);
  rig.rotation.set(0, VR.rigYaw, 0);
  rig.position.set(px - (hx * cs + hz * sn), VR.baseY, pz - (-hx * sn + hz * cs));
  rig.updateMatrixWorld(true);
  // la cámara del juego (la que usan la luna, las siluetas…) pasa a estar en tu cabeza, mirando siempre al mismo sitio del cielo
  const gc = A.camera; tmpV.copy(c.position); rig.localToWorld(tmpV);
  gc.position.copy(tmpV); gc.rotation.set(0.3, 0, 0, 'YXZ'); gc.updateMatrixWorld(true);
};

// ---------- dibujar ----------
const FOG = { near: 0, far: 0 };
VRX.render = function () {
  const A = VRX.api, r = A.renderer, scene = A.scene;
  if (!VR.rig || !VR.session) return;
  updateUi(A);
  // en las gafas las unidades de cámara son metros: la niebla y el alcance de las luces se ajustan a esa escala
  const fog = scene.fog; let fn = 0, ff = 0;
  if (fog) { fn = fog.near; ff = fog.far; fog.near = fn / SCALE; fog.far = ff / SCALE; }
  const saved = pointLights.map(l => l.distance); pointLights.forEach(l => { l.distance /= SCALE; });
  if (VR.frames % 4 === 1) r.shadowMap.needsUpdate = true; // las sombras se actualizan cada pocos fotogramas para ir más ligero
  r.render(scene, VR.cam);
  VR.calls = r.info.render.calls; VR.tris = r.info.render.triangles;
  if (VR.shot) { try { VR.shotData = A.cv.toDataURL('image/png'); } catch (e) { VR.shotData = 'ERR ' + e.message; } VR.shot = null; }
  if (fog) { fog.near = fn; fog.far = ff; }
  pointLights.forEach((l, i) => { l.distance = saved[i]; });
};

function updateUi(A) {
  const rig = VR.rig, cam = VR.cam;
  // el modal activo
  const dom = activeDom();
  if (dom && dom !== VR.dom.el) { VR.dom.el = dom; VR.dom.dirty = true; VR.domOpen = true; if (VR.modal) closeModal(); startObserver(dom.closest('.overlay') || dom); placeDomPanel(); }
  else if (!dom && VR.domOpen) { VR.domOpen = false; VR.dom.el = null; VR.panels.dom.mesh.visible = false; VR.dom.info = null; }
  if (VR.domOpen) {
    const now = performance.now();
    const hasCanvas = VR.dom.el && VR.dom.el.querySelector('canvas');
    if ((VR.dom.dirty && now - VR.dom.lastPaint > 80) || (hasCanvas && now - VR.dom.lastPaint > 160)) {
      VR.dom.lastPaint = now; VR.dom.dirty = false;
      const P = VR.panels.dom;
      try {
        VR.dom.info = paintDom(VR.dom.el, P.canvas);
        const wm = clamp(VR.dom.info.w * M_PER_CSS, 0.5, 2.3), hm = wm * VR.dom.info.h / VR.dom.info.w;
        if (hm > 1.7) { P.mesh.scale.set(1.7 / hm * wm, 1.7, 1); } else P.mesh.scale.set(wm, hm, 1);
        P.mesh.updateMatrix();
        P.tex.needsUpdate = true;
        VR.dom.view = true;
        // al cambiar de tamaño, se vuelve a centrar a la altura de los ojos
      } catch (e) { console.warn('VR: no se pudo pintar el menú', e); }
    }
    if (VR.dom.view && VR.dom.info) { VR.dom.view = false; paintHover(); }
  }
  if (VR.helpPending && !VR.domOpen && !VR.modal && VR.frames > 40) { VR.helpPending = false; cfg.helpSeen = true; saveCfg(); openModal('help'); }
  // reloj de la muñeca, cartel de avisos y viñetas
  attachWrist();
  drawWrist(A);
  drawBand(A);
  const band = VR.panels.band.mesh, B = VR.band;
  const hy = headLocalYaw();
  if (!B.init) { B.yaw = hy; B.init = true; }
  B.yaw += angDiff(hy, B.yaw) * 0.08;
  const fw = tmpV.set(-Math.sin(B.yaw), 0, -Math.cos(B.yaw));
  band.position.set(cam.position.x + fw.x * 1.1, cam.position.y - 0.44, cam.position.z + fw.z * 1.1);
  band.rotation.set(-0.12, B.yaw, 0); band.visible = band.visible && !VR.domOpen && !VR.modal;
  const fear = parseFloat($('fear') && $('fear').style.opacity) || 0;
  VR.fearMesh.visible = cfg.vignette && fear > 0.02; VR.fearMesh.material.opacity = clamp(fear * 1.1, 0, 1);
  { // viñeta de confort: los bordes se oscurecen mientras andas, giras o vas en coche
    const mv = A.player.inCar ? Math.min(1, Math.abs(A.car.v) / 260) : Math.hypot(VRX.mx, VRX.my);
    const want = cfg.comfort && !VR.domOpen && !VR.modal ? Math.min(0.85, mv * 0.9 + (VR.turnFlash || 0)) : 0;
    VR.turnFlash = Math.max(0, (VR.turnFlash || 0) - (VR.dt || 0.014) * 3);
    VR.tunnel += (want - VR.tunnel) * Math.min(1, (VR.dt || 0.014) * (want > VR.tunnel ? 8 : 3));
    VR.tunnelMesh.visible = VR.tunnel > 0.02; VR.tunnelMesh.material.opacity = VR.tunnel;
  }
  VR.fadeMesh.visible = VR.fade > 0.01; VR.fadeMesh.material.opacity = clamp(VR.fade, 0, 1);
  updatePointers(A);
}
function placeDomPanel() { placeInFront(VR.panels.dom, 1.45); VR.panels.dom.mesh.visible = true; }

// pinta el menú (la copia limpia) y encima el recuadro de lo que señalas
function paintHover() {
  const P = VR.panels.dom, info = VR.dom.info, ctx = P.ctx;
  // la copia limpia vive en otro canvas para no repintar todo el HTML solo por mover el puntero
  if (!VR.dom.clean) VR.dom.clean = document.createElement('canvas');
  const cl = VR.dom.clean;
  if (VR.dom.cleanStamp !== info) { /* el panel recién pintado está en P.canvas */ cl.width = P.canvas.width; cl.height = P.canvas.height; cl.getContext('2d').drawImage(P.canvas, 0, 0); VR.dom.cleanStamp = info; }
  if (P.canvas.width !== cl.width || P.canvas.height !== cl.height) { P.canvas.width = cl.width; P.canvas.height = cl.height; }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, P.canvas.width, P.canvas.height); ctx.drawImage(cl, 0, 0);
  const hv = VR.hover; const el = hv && hv.panel === 'dom' ? clickable(hv.el) : null;
  if (el) {
    const r = el.getBoundingClientRect(), k = info.k;
    ctx.save(); ctx.setTransform(k, 0, 0, k, -info.left * k, -info.top * k);
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 5; ctx.fillStyle = 'rgba(255,210,63,0.22)';
    ctx.beginPath(); ctx.roundRect(r.left - 3, r.top - 3, r.width + 6, r.height + 6, 14); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  P.tex.needsUpdate = true;
}

})();
