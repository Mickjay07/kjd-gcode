// Vase geometry math: converts the control-ring lattice + texture
// settings into a radius function r(theta, z), shared by the 3D
// editor mesh and the G-code generator so what you see is what prints.

import { CONTROL_POINTS_PER_RING, TAU } from './state.js';
import { textureDisplacement } from './patterns.js';

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

// Radius of a single ring at angle theta — periodic Catmull-Rom
// through the ring's control radii.
function ringRadiusAt(radii, theta) {
  const n = radii.length;
  const f = (((theta / TAU) % 1 + 1) % 1) * n;
  const i = Math.floor(f) % n;
  const t = f - Math.floor(f);
  const p0 = radii[(i - 1 + n) % n];
  const p1 = radii[i];
  const p2 = radii[(i + 1) % n];
  const p3 = radii[(i + 2) % n];
  return catmullRom(p0, p1, p2, p3, t);
}

// Structural radius (no texture) at angle theta and normalized height zn.
export function baseRadius(shape, theta, zn) {
  const rings = shape.rings;
  const n = rings.length;
  zn = Math.min(1, Math.max(0, zn));
  if (n === 1) return ringRadiusAt(rings[0].radii, theta) * shape.baseScale;

  const f = zn * (n - 1);
  const k = Math.min(Math.floor(f), n - 2);
  const t = f - k;
  const r0 = ringRadiusAt(rings[Math.max(0, k - 1)].radii, theta);
  const r1 = ringRadiusAt(rings[k].radii, theta);
  const r2 = ringRadiusAt(rings[k + 1].radii, theta);
  const r3 = ringRadiusAt(rings[Math.min(n - 1, k + 2)].radii, theta);
  return Math.max(1, catmullRom(r0, r1, r2, r3, t)) * shape.baseScale;
}

// Full printed radius including texture, z in mm.
export function radiusAt(shape, texture, theta, z) {
  const zn = shape.height > 0 ? z / shape.height : 0;
  const r = baseRadius(shape, theta, zn);
  const d = textureDisplacement(texture, theta, z, shape.height);
  return Math.max(0.5, r + d);
}

// Largest structural radius — used for camera fit and build-volume checks.
export function maxRadius(shape, texture) {
  let m = 0;
  for (const ring of shape.rings) {
    for (const r of ring.radii) m = Math.max(m, r);
  }
  return m * shape.baseScale + Math.abs(texture?.amplitude ?? 0);
}

/**
 * Fill a THREE.BufferGeometry-compatible position array for a
 * cylindrical grid of (radialSegs x heightSegs) vertices.
 * Returns { positions, indices, radialSegs, heightSegs }.
 * Y-up: y = z(mm), so the mesh is in printer millimetres.
 */
export function buildVaseGrid(shape, texture, radialSegs = 128, heightSegs = 140) {
  const positions = new Float32Array((radialSegs + 1) * (heightSegs + 1) * 3);
  let p = 0;
  for (let j = 0; j <= heightSegs; j++) {
    const z = (j / heightSegs) * shape.height;
    for (let i = 0; i <= radialSegs; i++) {
      const theta = (i / radialSegs) * TAU;
      const r = radiusAt(shape, texture, theta, z);
      positions[p++] = Math.cos(theta) * r;
      positions[p++] = z;
      positions[p++] = Math.sin(theta) * r;
    }
  }
  const indices = [];
  const row = radialSegs + 1;
  for (let j = 0; j < heightSegs; j++) {
    for (let i = 0; i < radialSegs; i++) {
      const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  return { positions, indices, radialSegs, heightSegs };
}
