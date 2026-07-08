// Spiral vase-mode G-code generator.
// Produces: brim → solid bottom layers → one continuous spiralized
// outer wall (no seams, no retractions), using the exact same
// radiusAt() the 3D preview renders.

import { radiusAt, maxRadius } from './vase.js';
import { PRINTERS, MATERIALS, resolveTemps } from './printers.js';
import { TAU } from './state.js';

export const APP_VERSION = '1.2.0';

const FILAMENT_AREA = Math.PI * (1.75 / 2) ** 2; // mm^2
const DENSITY = { PLA: 1.24, PETG: 1.27 };       // g/cm^3
const MAX_FLOW = { PLA: 12, PETG: 9 };           // mm^3/s volumetric limit

export const SOCKETS = { E27: 40, E14: 29.5 };   // shade fitter hole diameters (mm)
const LAMP_RING_WIDTH = 5;                       // radial width of the socket ring

export function socketHoleDia(style) {
  return style.socket === 'custom' ? style.socketDia : SOCKETS[style.socket];
}

/**
 * Open-mesh wall path (baskets / lampshades): the extrusion oscillates
 * vertically while spiralling up. Loop frequency is forced to n + 0.5
 * per revolution so consecutive passes are in antiphase — peaks of one
 * pass meet valleys of the next, fusing at contact points and leaving
 * diamond openings of ~pitch height in between.
 * Returns a flat [x, y, z, ...] array in local coords (bed centre = 0,0).
 */
export function buildMeshWallPath(shape, texture, style, zStart, segsPerLoop = 14) {
  const pitch = Math.max(1.2, style.meshPitch);
  const f = Math.max(2, Math.round(style.meshDensity)) + 0.5; // loops per rev
  const amp = pitch / 2;
  const top = shape.height;
  if (top - zStart < pitch) return new Float32Array(0);

  const segs = Math.max(160, Math.ceil(f * segsPerLoop));
  const revs = (top - zStart - amp) / pitch + 1;
  const totalSteps = Math.ceil(revs * segs);
  const pts = new Float32Array((segs + totalSteps + Math.ceil(segs * 1.5) + 2) * 3);
  let p = 0;
  const layerMarks = []; // { idx: point index, z } — one per mesh revolution
  const push = (th, z) => {
    const r = radiusAt(shape, texture, th, Math.min(z, top));
    pts[p++] = Math.cos(th) * r;
    pts[p++] = Math.sin(th) * r;
    pts[p++] = z;
  };

  // anchor: one flat revolution on top of the solid base
  layerMarks.push({ idx: 0, z: zStart });
  for (let s = 0; s <= segs; s++) push((s / segs) * TAU, zStart);

  // mesh spiral
  let lastTh = 0;
  let lastBand = -1;
  for (let s = 1; s <= totalSteps; s++) {
    const thTotal = (s / segs) * TAU;
    const base = zStart + pitch * (thTotal / TAU);
    let z = base + amp * Math.sin(f * thTotal);
    z = Math.max(zStart, Math.min(top, z));
    if (base - amp > top) break;
    const band = Math.floor((base - zStart) / pitch + 1e-6);
    if (band > lastBand) {
      layerMarks.push({ idx: p / 3, z: Math.min(top, zStart + (band + 1) * pitch) });
      lastBand = band;
    }
    push(thTotal % TAU, z);
    lastTh = thTotal % TAU;
  }

  // rim: 1.5 flat revolutions riding on the final peaks
  layerMarks.push({ idx: p / 3, z: top });
  const rimSteps = Math.ceil(segs * 1.5);
  for (let s = 1; s <= rimSteps; s++) {
    push((lastTh + (s / segs) * TAU) % TAU, top);
  }
  const out = pts.subarray(0, p);
  out.layerMarks = layerMarks;
  return out;
}

function fmt(n, d = 2) {
  let s = n.toFixed(d);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

export function generateGcode(state) {
  const { shape, texture, printer } = state;
  const style = state.style ?? { wall: 'solid', bottom: 'solid' };
  const preset = PRINTERS[printer.model];
  const mat = MATERIALS[printer.material];
  const temps = resolveTemps(printer.model, printer.material);
  const lh = printer.layerHeight;
  const lw = printer.lineWidth;
  const ePerMm = (lh * lw) / FILAMENT_AREA;
  const [bedX, bedY, bedZ] = preset.volume;
  const cx = bedX / 2, cy = bedY / 2;

  // Speeds (mm/s), respecting the material volumetric flow limit.
  const flowCap = MAX_FLOW[printer.material] / (lh * lw);
  const wallSpeed = Math.min(mat.maxSpeed, flowCap, 45);
  const firstSpeed = Math.min(20, wallSpeed);
  const solidSpeed = Math.min(mat.maxSpeed, flowCap, 50);
  const travelSpeed = 150;

  const warnings = [];
  const rMax = maxRadius(shape, texture);
  const footprint = (rMax + printer.brimLoops * lw) * 2;
  if (footprint > Math.min(bedX, bedY) - 10) {
    warnings.push(`Model + brim (Ø${fmt(footprint, 0)} mm) exceeds the ${preset.label} bed.`);
  }
  if (shape.height > bedZ) {
    warnings.push(`Height ${fmt(shape.height, 0)} mm exceeds the ${bedZ} mm build volume.`);
  }
  if (style.bottom === 'lamp') {
    const rNeeded = socketHoleDia(style) / 2 + LAMP_RING_WIDTH + 4;
    let rBase = Infinity;
    for (let i = 0; i < 32; i++) {
      rBase = Math.min(rBase, radiusAt(shape, texture, (i / 32) * TAU, 0));
    }
    if (rNeeded > rBase) {
      warnings.push(`Socket ring (needs Ø${fmt(rNeeded * 2, 0)} mm) doesn't fit the Ø${fmt(rBase * 2, 0)} mm base opening.`);
    }
  }

  const lines = [];
  const toolpath = []; // [{ type, points: [x,y,z,...] }] for the 3D preview
  let E = 0, timeS = 0;
  let lastX = cx, lastY = cy, lastZ = 0;

  const push = s => lines.push(s);

  // slicer-style layer markers so Bambu Studio / PrusaSlicer viewers can
  // split the file into layers instead of choking on one giant move list
  function layerMark(n, z, h) {
    push(';LAYER_CHANGE');
    push(`;Z:${fmt(z, 3)}`);
    push(`;HEIGHT:${fmt(h, 3)}`);
    push(`;LAYER:${n}`);
  }

  // M73 progress placeholders, resolved once total time is known
  const PROGRESS = '\u0001';
  let lastProgressAt = 0;
  function progressMark(force = false) {
    if (force || timeS - lastProgressAt >= 20) {
      lines.push(PROGRESS + timeS.toFixed(1));
      lastProgressAt = timeS;
    }
  }

  function travel(x, y, z, speed = travelSpeed) {
    push(`G0 X${fmt(x)} Y${fmt(y)} Z${fmt(z, 3)} F${Math.round(speed * 60)}`);
    timeS += Math.hypot(x - lastX, y - lastY, z - lastZ) / speed;
    lastX = x; lastY = y; lastZ = z;
  }

  function extrude(x, y, z, speed) {
    const d = Math.hypot(x - lastX, y - lastY, z - lastZ);
    E += d * ePerMm;
    push(`G1 X${fmt(x)} Y${fmt(y)} Z${fmt(z, 3)} E${E.toFixed(5)} F${Math.round(speed * 60)}`);
    timeS += d / speed;
    lastX = x; lastY = y; lastZ = z;
    progressMark();
  }

  // Sample a closed loop of the vase contour at height zSample (mm),
  // radially offset by `off` mm, printed at nozzle height zPrint.
  function loopPoints(zSample, off, segs) {
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const th = (i / segs) * TAU;
      const r = Math.max(0.2, radiusAt(shape, texture, th, zSample) + off);
      pts.push([cx + Math.cos(th) * r, cy + Math.sin(th) * r]);
    }
    return pts;
  }

  function segsFor(radius) {
    let s = Math.ceil((TAU * Math.max(radius, 5)) / 0.8);
    if (texture.pattern !== 'smooth') s = Math.max(s, texture.frequency * 10);
    return Math.min(800, Math.max(96, s));
  }

  function printLoop(zSample, off, zPrint, speed, type) {
    const segs = segsFor(radiusAt(shape, texture, 0, zSample) + off);
    const pts = loopPoints(zSample, off, segs);
    travel(pts[0][0], pts[0][1], zPrint);
    const tp = [];
    for (let i = 1; i < pts.length; i++) {
      extrude(pts[i][0], pts[i][1], zPrint, speed);
      tp.push(pts[i][0] - cx, zPrint, pts[i][1] - cy);
    }
    toolpath.push({ type, points: tp });
  }

  // ---------- header ----------
  // The "generated by PrusaSlicer" line is a compatibility shim: G-code
  // viewers (Bambu Studio, PrusaSlicer, Orca) only honor ;LAYER_CHANGE /
  // ;TYPE / ;WIDTH tags from producers they recognize. Without it they
  // fall back to Z-based layer detection, which turns the oscillating
  // mesh wall into one giant layer and freezes the preview.
  push(`; generated by PrusaSlicer 2.8.0 on ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`);
  push(`; (viewer-compatibility header; real generator: KJD GCODE vase designer v${APP_VERSION})`);
  push(`; printer: ${preset.label}  material: ${printer.material}  nozzle: ${printer.nozzle} mm`);
  push(`; layer height: ${lh} mm  line width: ${lw} mm  vase mode: spiral`);
  push(`; height: ${fmt(shape.height, 1)} mm  max radius: ${fmt(rMax, 1)} mm`);
  push(`;TYPE:Custom`);

  const startCode = (printer.model === 'custom' && printer.customStart.trim())
    ? printer.customStart : preset.start;
  push(startCode
    .replaceAll('{nozzle_temp}', temps.nozzleTemp)
    .replaceAll('{bed_temp}', temps.bedTemp)
    .replaceAll('{fan}', temps.fanPWM));
  push('M82 ; absolute extrusion');
  push('G92 E0');
  push('M106 S0 ; fan off for first layer');
  timeS += 150; // homing + heating estimate
  progressMark(true);

  // ---------- brim ----------
  const z0 = lh;
  layerMark(0, z0, lh);
  if (printer.brimLoops > 0) {
    push(`;TYPE:Skirt/Brim`);
    push(`;WIDTH:${lw}`);
    for (let b = printer.brimLoops; b >= 1; b--) {
      printLoop(0, b * lw * 0.98, z0, firstSpeed, 'brim');
    }
  }

  // ---------- bottom: solid fill or lamp mount ----------
  for (let j = 1; j <= printer.bottomLayers; j++) {
    const zPrint = j * lh;
    if (j > 1) layerMark(j - 1, zPrint, lh);
    if (j === 2) push(`M106 S${temps.fanPWM}`);
    const speed = j === 1 ? firstSpeed : solidSpeed;

    if (style.bottom === 'lamp') {
      push(`;TYPE:Solid infill`); // lamp mount ring + spokes
      push(`;WIDTH:${lw}`);
      // outer rim: two perimeter loops
      printLoop(zPrint, 0, zPrint, speed, 'bottom');
      printLoop(zPrint, -lw * 0.95, zPrint, speed, 'bottom');
      // socket ring around the bulb-holder hole
      const rHole = socketHoleDia(style) / 2;
      const ringLoops = Math.max(2, Math.round(LAMP_RING_WIDTH / (lw * 0.95)));
      for (let i = 0; i < ringLoops; i++) {
        const r = rHole + lw / 2 + i * lw * 0.95;
        const segs = Math.max(64, Math.ceil((TAU * r) / 0.8));
        travel(cx + r, cy, zPrint);
        const tp = [];
        for (let s = 1; s <= segs; s++) {
          const th = (s / segs) * TAU;
          extrude(cx + Math.cos(th) * r, cy + Math.sin(th) * r, zPrint, speed);
          tp.push(lastX - cx, zPrint, lastY - cy);
        }
        toolpath.push({ type: 'mount', points: tp });
      }
      // spokes: double-pass arms from the ring to the outer wall
      const rRing = rHole + LAMP_RING_WIDTH;
      const nSpokes = Math.max(3, Math.round(style.spokes ?? 4));
      for (let k = 0; k < nSpokes; k++) {
        const a = (k / nSpokes) * TAU + (j % 2 ? 0 : TAU / (nSpokes * 2));
        const rOut = radiusAt(shape, texture, a, zPrint) - lw;
        const ca = Math.cos(a), sa = Math.sin(a);
        const px = -sa * lw * 0.9, py = ca * lw * 0.9; // perpendicular offset
        travel(cx + ca * (rRing - 1), cy + sa * (rRing - 1), zPrint);
        const tp = [lastX - cx, zPrint, lastY - cy];
        extrude(cx + ca * rOut, cy + sa * rOut, zPrint, speed);
        tp.push(lastX - cx, zPrint, lastY - cy);
        extrude(cx + ca * rOut + px, cy + sa * rOut + py, zPrint, speed);
        tp.push(lastX - cx, zPrint, lastY - cy);
        extrude(cx + ca * (rRing - 1) + px, cy + sa * (rRing - 1) + py, zPrint, speed);
        tp.push(lastX - cx, zPrint, lastY - cy);
        toolpath.push({ type: 'mount', points: tp });
      }
    } else {
      push(`;TYPE:Solid infill`);
      push(`;WIDTH:${lw}`);
      // concentric fill: perimeter inwards to the centre
      const rc = radiusAt(shape, texture, 0, zPrint);
      const nLoops = Math.max(1, Math.floor(rc / (lw * 0.95)));
      for (let i = 0; i < nLoops; i++) {
        printLoop(zPrint, -i * lw * 0.95, zPrint, speed, 'bottom');
      }
    }
  }

  // ---------- wall: spiral (solid) or open mesh ----------
  if (printer.bottomLayers < 2) push(`M106 S${temps.fanPWM}`);
  let layer = printer.bottomLayers;
  const zStart = printer.bottomLayers * lh;
  const spiralHeight = shape.height - zStart;
  if (style.wall === 'mesh' && spiralHeight > 0) {
    push('M106 S255 ; full fan for free-hanging mesh strands');
    // free-hanging strand ≈ round bead of nozzle diameter
    const strandE = (Math.PI * (printer.nozzle / 2) ** 2) / FILAMENT_AREA;
    const meshSpeed = Math.min(16, wallSpeed);
    const pts = buildMeshWallPath(shape, texture, style, zStart);
    const marks = pts.layerMarks ?? [];
    if (pts.length >= 3) {
      travel(cx + pts[0], cy + pts[1], pts[2]);
      const tp = [pts[0], pts[2], pts[1]];
      const pitch = Math.max(1.2, style.meshPitch);
      let mi = 0;
      for (let i = 3; i < pts.length; i += 3) {
        while (mi < marks.length && marks[mi].idx <= i / 3) {
          layerMark(layer + mi, marks[mi].z, pitch);
          if (mi === 0) { push(`;TYPE:External perimeter`); push(`;WIDTH:${printer.nozzle}`); } // open mesh
          mi++;
        }
        const x = cx + pts[i], y = cy + pts[i + 1], z = pts[i + 2];
        const d = Math.hypot(x - lastX, y - lastY, z - lastZ);
        E += d * strandE;
        push(`G1 X${fmt(x)} Y${fmt(y)} Z${fmt(z, 3)} E${E.toFixed(5)} F${Math.round(meshSpeed * 60)}`);
        timeS += d / meshSpeed;
        lastX = x; lastY = y; lastZ = z;
        progressMark();
        tp.push(pts[i], z, pts[i + 1]);
      }
      toolpath.push({ type: 'mesh', points: tp });
      layer += marks.length;
    }
  } else if (spiralHeight > 0) {
    push(`;TYPE:External perimeter`); // spiral vase wall
    push(`;WIDTH:${lw}`);
    const revs = spiralHeight / lh;
    const segs = segsFor(rMax);
    const totalSteps = Math.ceil(revs * segs);
    const tp = [];
    // move to spiral start
    {
      const r = radiusAt(shape, texture, 0, zStart);
      travel(cx + r, cy, zStart);
    }
    let lastLayerMark = -1;
    for (let s = 1; s <= totalSteps; s++) {
      const th = (s / segs) * TAU;
      const z = zStart + (s / totalSteps) * spiralHeight;
      const zSample = Math.min(z, shape.height);
      const r = radiusAt(shape, texture, th, zSample);
      const lm = Math.floor((z - zStart) / lh);
      if (lm !== lastLayerMark) {
        layerMark(layer + lm, zStart + (lm + 1) * lh, lh);
        lastLayerMark = lm;
      }
      extrude(cx + Math.cos(th) * r, cy + Math.sin(th) * r, z, wallSpeed);
      tp.push(lastX - cx, z, lastY - cy);
    }
    toolpath.push({ type: 'wall', points: tp });
    layer += Math.ceil(revs);
  }

  // ---------- end ----------
  push('M73 P100 R0');
  const endCode = (printer.model === 'custom' && printer.customEnd.trim())
    ? printer.customEnd : preset.end;
  push(endCode);
  push('; end of print');
  push(`; estimated printing time (normal mode) = ${formatTime(timeS)}`);
  push(`; filament used [mm] = ${E.toFixed(1)}`);
  push(`; total filament used [g] = ${(E * FILAMENT_AREA / 1000 * (DENSITY[printer.material] ?? 1.24)).toFixed(2)}`);

  // resolve M73 progress placeholders now that total time is known
  const totalTime = timeS;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].charCodeAt(0) === 1) {
      const t = parseFloat(lines[i].slice(1));
      const pct = Math.min(99, Math.max(0, Math.round((t / totalTime) * 100)));
      lines[i] = `M73 P${pct} R${Math.max(0, Math.round((totalTime - t) / 60))}`;
    }
  }

  const gcode = lines.join('\n') + '\n';
  const filamentMm = E;
  const filamentG = (filamentMm * FILAMENT_AREA / 1000) * (DENSITY[printer.material] ?? 1.24);

  return {
    gcode,
    toolpath,
    stats: {
      layers: layer,
      filamentMm,
      filamentG,
      timeS,
      bytes: gcode.length,
      warnings,
    },
  };
}

export function formatTime(s) {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
