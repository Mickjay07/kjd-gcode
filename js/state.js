// Central app state + tiny pub/sub.

const TAU = Math.PI * 2;

export const CONTROL_POINTS_PER_RING = 8;

function makeRings(count, radiusFn) {
  const rings = [];
  for (let k = 0; k < count; k++) {
    const t = count === 1 ? 0 : k / (count - 1);
    rings.push({
      z: t,
      radii: new Array(CONTROL_POINTS_PER_RING).fill(radiusFn(t)),
    });
  }
  return rings;
}

export const SHAPE_PRESETS = {
  classic:   t => 34 - 10 * Math.cos(t * Math.PI * 2) * (0.5 + t * 0.5) - t * 6,
  hourglass: t => 40 - 22 * Math.sin(t * Math.PI) ** 2 + 14 * Math.max(0, t - 0.8) * 5,
  bulb:      t => 18 + 30 * Math.sin(Math.min(t * 1.35, 1) * Math.PI) ** 1.5 + (t > 0.85 ? (t - 0.85) * 40 : 0),
  cone:      t => 16 + 32 * t,
  cylinder:  () => 34,
  wobble:    t => 32 + 9 * Math.sin(t * Math.PI * 3),
};

export const state = {
  shape: {
    height: 150,          // mm
    baseScale: 1.0,       // global radius multiplier
    rings: makeRings(7, SHAPE_PRESETS.classic),
  },
  texture: {
    pattern: 'sine',
    amplitude: 1.5,       // mm
    frequency: 14,        // waves around circumference
    vfrequency: 10,       // waves along height
    twist: 0,             // degrees over full height
    offset: 0,            // degrees
    fadeIn: 8,            // mm from bottom without texture
  },
  printer: {
    model: 'bambu_a1',
    material: 'PLA',
    nozzle: 0.4,
    layerHeight: 0.2,
    lineWidth: 0.45,
    bottomLayers: 4,
    brimLoops: 4,
    customStart: '',
    customEnd: '',
  },
  ui: {
    editHandles: true,
    dragMode: 'point',    // 'point' | 'ring'
    preview: false,
  },
};

const listeners = {};
export function on(event, fn) { (listeners[event] ??= []).push(fn); }
export function emit(event, data) { (listeners[event] ?? []).forEach(fn => fn(data)); }

export function applyShapePreset(name) {
  const fn = SHAPE_PRESETS[name];
  if (!fn) return;
  state.shape.rings = makeRings(state.shape.rings.length, fn);
  emit('shape');
}

export function setRingCount(count) {
  const s = state.shape;
  const old = s.rings;
  const rings = [];
  for (let k = 0; k < count; k++) {
    const t = count === 1 ? 0 : k / (count - 1);
    // resample existing rings so the silhouette is preserved
    const radii = [];
    for (let i = 0; i < CONTROL_POINTS_PER_RING; i++) {
      radii.push(sampleRingsAt(old, t, i));
    }
    rings.push({ z: t, radii });
  }
  s.rings = rings;
  emit('shape');
}

// Linear resample helper used only when changing ring count.
function sampleRingsAt(rings, t, pointIndex) {
  if (rings.length === 1) return rings[0].radii[pointIndex];
  const f = t * (rings.length - 1);
  const k = Math.min(Math.floor(f), rings.length - 2);
  const u = f - k;
  return rings[k].radii[pointIndex] * (1 - u) + rings[k + 1].radii[pointIndex] * u;
}

export { TAU };
