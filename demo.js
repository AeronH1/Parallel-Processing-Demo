import * as THREE from 'three';

// ── Renderer ──────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// ── Scene ─────────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x03030d);
scene.fog = new THREE.FogExp2(0x03030d, 0.022);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.z = 30;

// Ambient light illuminates all objects equally
scene.add(new THREE.AmbientLight(0xffffff, 1.5));

// Grid floor for spatial reference
{
  const grid = new THREE.GridHelper(80, 40, 0x0a1a33, 0x060610);
  grid.position.y = -16;
  scene.add(grid);
}

// ── Physics Objects ───────────────────────────────────────────────────────────
const COLORS = [0x66aaff, 0xff66aa, 0x66ffaa, 0xffcc66, 0xcc66ff, 0x66eeff, 0xff8866, 0xffee66];
const BOUNDS = 14;
const meshes = []; // Three.js mesh objects (visual)
let phys = [];     // Physics state { x, y, z, vx, vy, vz } for each object

const objGeo = new THREE.IcosahedronGeometry(0.32, 1);

function spawnObject() {
  const color = COLORS[meshes.length % COLORS.length];
  const mat = new THREE.MeshPhongMaterial({
    color,
    emissive: new THREE.Color(color).multiplyScalar(0.4),
    shininess: 140,
    specular: 0xffffff,
  });
  const mesh = new THREE.Mesh(objGeo, mat);
  scene.add(mesh);
  meshes.push(mesh);
  phys.push({
    x:  (Math.random() - 0.5) * BOUNDS * 2,
    y:  (Math.random() - 0.5) * BOUNDS * 2,
    z:  (Math.random() - 0.5) * BOUNDS * 2,
    vx: (Math.random() - 0.5) * 0.04,
    vy: (Math.random() - 0.5) * 0.04,
    vz: (Math.random() - 0.5) * 0.04,
  });
}

function despawnObject() {
  if (!meshes.length) return;
  scene.remove(meshes.pop());
  phys.pop();
}

for (let i = 0; i < 200; i++) spawnObject();

window.changeObjects = function(delta) {
  const fn = delta > 0 ? spawnObject : despawnObject;
  for (let i = 0; i < Math.abs(delta); i++) fn();
  if (useWorker) {
    // Sync latest worker positions into phys before sending so existing balls don't reset
    if (workerBuf) {
      for (let i = 0; i < phys.length && i < workerBuf.length / 6; i++) {
        phys[i].x  = workerBuf[i * 6];
        phys[i].y  = workerBuf[i * 6 + 1];
        phys[i].z  = workerBuf[i * 6 + 2];
        phys[i].vx = workerBuf[i * 6 + 3];
        phys[i].vy = workerBuf[i * 6 + 4];
        phys[i].vz = workerBuf[i * 6 + 5];
      }
    }
    worker.postMessage({ type: 'sync', phys: phys.map(clonePhys) });
  }
  refreshStats();
};

// ── Physics: N-body simulation (O(n²)) ───────────────────────────────────────
// Each object calculates a force from every other object.
// scale normalizes movement to 60fps so speed is consistent at any frame rate.
function simulateStep(data, scale = 1) {
  const n = data.length;
  for (let i = 0; i < n; i++) {
    const a = data[i];
    let fx = 0, fy = 0, fz = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const b = data[j];
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      const d2 = dx * dx + dy * dy + dz * dz + 0.1; // +0.1 prevents division by zero
      // Negative = repel (close), positive = attract (far)
      const f = d2 < 2.5 ? -0.00025 / d2 : 0.000018 / d2;
      fx += dx * f;
      fy += dy * f;
      fz += dz * f;
    }
    // Apply force to velocity, 0.982 damping prevents runaway speed
    a.vx = (a.vx + fx * scale) * 0.982;
    a.vy = (a.vy + fy * scale) * 0.982;
    a.vz = (a.vz + fz * scale) * 0.982;
    a.x += a.vx * scale; a.y += a.vy * scale; a.z += a.vz * scale;
    // Bounce off boundaries
    if (Math.abs(a.x) > BOUNDS) { a.x = Math.sign(a.x) * BOUNDS; a.vx *= -0.75; }
    if (Math.abs(a.y) > BOUNDS) { a.y = Math.sign(a.y) * BOUNDS; a.vy *= -0.75; }
    if (Math.abs(a.z) > BOUNDS) { a.z = Math.sign(a.z) * BOUNDS; a.vz *= -0.75; }
  }
}

// ── Web Worker ────────────────────────────────────────────────────────────────
// Runs the same physics simulation on a separate thread
const worker = new Worker('worker.js');

// Latest positions + velocities from the worker (6 floats per object: x,y,z,vx,vy,vz)
let workerBuf = null;
worker.onmessage = e => { workerBuf = e.data; };

// ── Mode Switching ────────────────────────────────────────────────────────────
let useWorker = false;

function clonePhys(o) {
  return { x: o.x, y: o.y, z: o.z, vx: o.vx, vy: o.vy, vz: o.vz };
}

window.toggleMode = function() {
  useWorker = !useWorker;
  const btn   = document.getElementById('toggle-btn');
  const badge = document.getElementById('mode-badge');
  const wstat = document.getElementById('worker-stat');
  if (useWorker) {
    btn.textContent   = '⇄  Switch to Main Thread (Sequential)';
    btn.className     = 'btn parallel';
    badge.textContent = 'PARALLEL — Web Worker Thread';
    badge.className   = 'parallel';
    wstat.textContent = 'Worker thread: RUNNING ●';
    wstat.style.color = '#6f6';
    worker.postMessage({ type: 'start', phys: phys.map(clonePhys) });
  } else {
    btn.textContent   = '⇄  Switch to Web Worker (Parallel Thread)';
    btn.className     = 'btn sequential';
    badge.textContent = 'SEQUENTIAL — Main Thread';
    badge.className   = 'sequential';
    wstat.textContent = 'Worker thread: idle';
    wstat.style.color = '';
    worker.postMessage({ type: 'pause' });
    // Restore latest positions and velocities from the worker into phys
    if (workerBuf) {
      for (let i = 0; i < phys.length && i < workerBuf.length / 6; i++) {
        phys[i].x  = workerBuf[i * 6];
        phys[i].y  = workerBuf[i * 6 + 1];
        phys[i].z  = workerBuf[i * 6 + 2];
        phys[i].vx = workerBuf[i * 6 + 3];
        phys[i].vy = workerBuf[i * 6 + 4];
        phys[i].vz = workerBuf[i * 6 + 5];
      }
    }
  }
};

// ── Stats HUD ─────────────────────────────────────────────────────────────────
function refreshStats() {
  const n = meshes.length;
  document.getElementById('obj-stat').textContent = `Objects: ${n}`;
  document.getElementById('ops-stat').textContent = `Physics ops/frame: ${(n * n).toLocaleString()}`;
}
refreshStats();

// ── FPS Counter ───────────────────────────────────────────────────────────────
let frames = 0;
let lastFpsAt = performance.now();
const fpsEl = document.getElementById('fps');

function tickFPS() {
  const now = performance.now();
  frames++;
  if (now - lastFpsAt >= 600) {
    const fps = Math.round(frames * 1000 / (now - lastFpsAt));
    frames = 0;
    lastFpsAt = now;
    fpsEl.textContent = `FPS: ${fps}`;
    fpsEl.className   = fps >= 60 ? '' : fps >= 30 ? 'warn' : 'bad';
  }
}

// ── Render Loop ───────────────────────────────────────────────────────────────
const computeEl = document.getElementById('compute-stat');
const renderEl  = document.getElementById('render-stat');
let lastPhysicsTime = performance.now();

renderer.setAnimationLoop(() => {
  tickFPS();

  // Compute time measures how long physics (or position apply) takes each frame
  const t0 = performance.now();
  const scale = (t0 - lastPhysicsTime) / 16.667; // normalize to 60fps
  lastPhysicsTime = t0;

  if (useWorker) {
    // Worker is computing physics in parallel — just apply its latest positions
    if (workerBuf) {
      const count = Math.min(meshes.length, workerBuf.length / 6);
      for (let i = 0; i < count; i++) {
        meshes[i].position.set(
          workerBuf[i * 6],
          workerBuf[i * 6 + 1],
          workerBuf[i * 6 + 2]
        );
      }
    }
  } else {
    // Sequential: physics runs on the main thread, blocking rendering
    simulateStep(phys, scale);
    for (let i = 0; i < meshes.length; i++) {
      meshes[i].position.set(phys[i].x, phys[i].y, phys[i].z);
    }
  }

  computeEl.textContent = `Compute time: ${(performance.now() - t0).toFixed(1)}ms`;
  computeEl.className   = parseFloat(computeEl.textContent) > 10 ? 'slow' : '';

  // Camera slowly orbits around the scene
  const t = performance.now() * 0.00014;
  camera.position.x = Math.sin(t) * 30;
  camera.position.z = Math.cos(t) * 30;
  camera.position.y = Math.sin(t * 0.38) * 6;
  camera.lookAt(0, 0, 0);

  // Render time measures how long Three.js takes to draw the frame
  const r0 = performance.now();
  renderer.render(scene, camera);
  renderEl.textContent = `Render time: ${(performance.now() - r0).toFixed(1)}ms`;
});

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
