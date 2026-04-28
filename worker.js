// worker.js — Runs physics on a separate thread so the main render thread stays unblocked

const BOUNDS = 14;

// N-body simulation (O(n²)) — each object calculates a force from every other object.
// scale normalizes movement to 60fps so speed is consistent at any frame rate.
function simulateStep(data, scale) {
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

let data = [];
let active = false;
let started = false;
let lastTime = performance.now();

// Runs continuously — computes physics and sends positions + velocities to the main thread
function loop() {
  if (active && data.length) {
    const now = performance.now();
    const scale = (now - lastTime) / 16.667;
    lastTime = now;
    simulateStep(data, scale);
    // Pack 6 floats per object (x,y,z,vx,vy,vz) and transfer to main thread (zero-copy)
    const buf = new Float32Array(data.length * 6);
    for (let i = 0; i < data.length; i++) {
      buf[i * 6]     = data[i].x;
      buf[i * 6 + 1] = data[i].y;
      buf[i * 6 + 2] = data[i].z;
      buf[i * 6 + 3] = data[i].vx;
      buf[i * 6 + 4] = data[i].vy;
      buf[i * 6 + 5] = data[i].vz;
    }
    self.postMessage(buf, [buf.buffer]);
  }
  setTimeout(loop, 0);
}

// Receive messages from the main thread
self.onmessage = e => {
  const msg = e.data;
  if (msg.type === 'start') {
    data = msg.phys;
    active = true;
    lastTime = performance.now(); // reset so the first delta isn't huge after a pause
    if (!started) { started = true; loop(); }
  } else if (msg.type === 'sync') {
    // Update object list when balls are added or removed
    data = msg.phys;
  } else if (msg.type === 'pause') {
    active = false;
  }
};
