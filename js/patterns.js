// Surface texture patterns. Each returns a displacement in [-1, 1]
// given the angular phase a (radians, already includes frequency,
// twist and offset) and the vertical phase v (radians, includes
// vertical frequency).

const TAU = Math.PI * 2;

function tri(x) { // triangle wave, period TAU, range [-1, 1]
  const t = ((x / TAU) % 1 + 1) % 1;
  return t < 0.5 ? t * 4 - 1 : 3 - t * 4;
}

function sq(x, k = 6) { // smoothed square wave
  return Math.tanh(Math.sin(x) * k);
}

export const PATTERNS = {
  smooth:   { label: 'Smooth',   fn: () => 0 },
  sine:     { label: 'Sine',     fn: (a) => Math.sin(a) },
  ripple:   { label: 'Ripple',   fn: (_a, v) => Math.sin(v) },
  nwave:    { label: 'N-Wave',   fn: (a) => tri(a) },
  vwave:    { label: 'V-Wave',   fn: (a, v) => Math.sin(a + tri(v) * 1.6) },
  bubbles:  { label: 'Bubbles',  fn: (a, v) => Math.sin(a) * Math.sin(v) },
  pixels:   { label: 'Pixels',   fn: (a, v) => sq(a) * sq(v) },
  triangle: { label: 'Triangle', fn: (a, v) => tri(a + v * 0.5) },
};

// Mini icons for the pattern picker (simple inline SVG paths).
export const PATTERN_ICONS = {
  smooth:   '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  sine:     '<path d="M2 12c2.5-7 5-7 7.5 0s5 7 7.5 0 3-5 5-4" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  ripple:   '<path d="M3 6h18M3 10h18M3 14h18M3 18h18" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  nwave:    '<path d="M2 16L7 8l5 8 5-8 5 8" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  vwave:    '<path d="M4 5l8 5 8-5M4 12l8 5 8-5" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  bubbles:  '<circle cx="7" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="16" cy="10" r="2.2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="10" cy="16" r="2.6" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  pixels:   '<path d="M5 5h4v4H5zM13 5h4v4h-4zM9 11h4v4H9zM5 15h2v2H5zM15 14h4v4h-4z" fill="currentColor"/>',
  triangle: '<path d="M4 18l4-6 4 6zM12 18l4-6 4 6zM8 11l4-6 4 6z" fill="none" stroke="currentColor" stroke-width="1.5"/>',
};

/**
 * Texture displacement in mm at angle theta (rad) and height z (mm).
 * tex = state.texture, height = total vase height in mm.
 */
export function textureDisplacement(tex, theta, z, height) {
  if (tex.pattern === 'smooth' || tex.amplitude <= 0) return 0;
  const pat = PATTERNS[tex.pattern];
  if (!pat) return 0;

  // fade-in from the bottom so the first layers stay clean
  let fade = 1;
  if (tex.fadeIn > 0) {
    fade = Math.min(1, Math.max(0, z / tex.fadeIn));
    fade = fade * fade * (3 - 2 * fade); // smoothstep
  }
  if (fade === 0) return 0;

  const zn = height > 0 ? z / height : 0;
  const twistRad = (tex.twist * Math.PI) / 180;
  const a = tex.frequency * theta + twistRad * zn + (tex.offset * Math.PI) / 180;
  const v = tex.vfrequency * zn * TAU;
  return pat.fn(a, v) * tex.amplitude * fade;
}
