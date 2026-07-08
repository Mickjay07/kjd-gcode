// Three.js viewport: vase mesh, draggable control-point handles,
// build-plate visual and toolpath preview.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { state, on, emit, TAU, CONTROL_POINTS_PER_RING } from './state.js';
import { buildVaseGrid, baseRadius } from './vase.js';
import { PRINTERS } from './printers.js';
import { buildMeshWallPath, socketHoleDia } from './gcode.js';

const RADIAL_SEGS = 144;
const HEIGHT_SEGS = 160;

let renderer, scene, camera, controls;
let vaseMesh, handleGroup, ringLineGroup, plateGroup, previewGroup;
let meshLineGroup, lampGroup;
let handleMeshes = []; // { mesh, ringIndex, pointIndex }
let dragging = null;
let dirty = true;
let previewOn = false;

const COL_HANDLE = 0xff7a3c;
const COL_HANDLE_ACTIVE = 0x6cd9ff;
const COL_RING = 0x8a4a28;

export function initEditor(canvas) {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0b09);
  scene.fog = new THREE.Fog(0x0d0b09, 500, 1200);

  camera = new THREE.PerspectiveCamera(42, 1, 0.5, 3000);
  camera.position.set(150, 160, 190);

  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.72;
  controls.minDistance = 40;
  controls.maxDistance = 900;
  controls.target.set(0, state.shape.height / 2, 0);

  // warm studio lighting, matching the clay look of the reference
  scene.add(new THREE.AmbientLight(0x40342a, 1.6));
  const key = new THREE.DirectionalLight(0xffd9b0, 2.6);
  key.position.set(180, 260, 120);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff5a2a, 1.1);
  rim.position.set(-220, 90, -160);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0x8090c0, 0.5);
  fill.position.set(-80, 40, 220);
  scene.add(fill);

  // vase mesh
  const geo = new THREE.BufferGeometry();
  const grid = buildVaseGrid(state.shape, state.texture, RADIAL_SEGS, HEIGHT_SEGS);
  geo.setAttribute('position', new THREE.BufferAttribute(grid.positions, 3));
  geo.setIndex(grid.indices);
  geo.computeVertexNormals();
  vaseMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: 0xb2603c, roughness: 0.72, metalness: 0.04, side: THREE.DoubleSide,
  }));
  scene.add(vaseMesh);

  handleGroup = new THREE.Group();
  ringLineGroup = new THREE.Group();
  plateGroup = new THREE.Group();
  previewGroup = new THREE.Group();
  previewGroup.visible = false;
  meshLineGroup = new THREE.Group();
  lampGroup = new THREE.Group();
  scene.add(handleGroup, ringLineGroup, plateGroup, previewGroup, meshLineGroup, lampGroup);

  rebuildHandles();
  rebuildPlate();
  updateModelVisibility();

  on('shape', () => { dirty = true; });
  on('texture', () => { dirty = true; });
  on('style', () => { dirty = true; });
  on('printer', () => { dirty = true; rebuildPlate(); });
  on('ringsChanged', rebuildHandles);

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('resize', resize);
  resize();
  renderer.setAnimationLoop(tick);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function tick() {
  if (dirty) {
    refreshGeometry();
    refreshHandles();
    if (state.style.wall === 'mesh') rebuildMeshLines();
    rebuildLampVisual();
    updateModelVisibility();
    dirty = false;
  }
  controls.update();
  renderer.render(scene, camera);
}

function updateModelVisibility() {
  const mesh = state.style.wall === 'mesh';
  vaseMesh.visible = !previewOn && !mesh;
  meshLineGroup.visible = !previewOn && mesh;
  lampGroup.visible = !previewOn && state.style.bottom === 'lamp';
  previewGroup.visible = previewOn;
}

// ---------- open-mesh wall wireframe ----------

const CLAY_LINE = new THREE.LineBasicMaterial({ color: 0xd08050 });
const CLAY_SOLID = new THREE.MeshStandardMaterial({ color: 0xb2603c, roughness: 0.72, metalness: 0.04 });

function rebuildMeshLines() {
  for (const child of meshLineGroup.children) child.geometry.dispose();
  meshLineGroup.clear();
  const zStart = state.printer.bottomLayers * state.printer.layerHeight;
  const pts = buildMeshWallPath(state.shape, state.texture, state.style, zStart);
  const n = pts.length / 3;
  if (n < 2) return;
  const positions = new Float32Array(pts.length);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = pts[i * 3];         // x
    positions[i * 3 + 1] = pts[i * 3 + 2]; // z (up)
    positions[i * 3 + 2] = pts[i * 3 + 1]; // y
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  meshLineGroup.add(new THREE.Line(geo, CLAY_LINE));
  // faint solid base disc so the bottom reads as closed (unless lamp mount)
  if (state.style.bottom === 'solid') {
    const r = baseRadius(state.shape, 0, 0);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r, Math.max(zStart, 0.8), 48), CLAY_SOLID);
    disc.position.y = Math.max(zStart, 0.8) / 2;
    meshLineGroup.add(disc);
  }
}

// ---------- lamp mount visual ----------

function rebuildLampVisual() {
  for (const child of lampGroup.children) child.geometry.dispose();
  lampGroup.clear();
  if (state.style.bottom !== 'lamp') return;
  const rHole = socketHoleDia(state.style) / 2;
  const ringW = 5;
  const h = Math.max(1.2, state.printer.bottomLayers * state.printer.layerHeight);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(rHole + ringW / 2, ringW / 2, 8, 64), CLAY_SOLID);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = h / 2;
  ring.scale.z = h / ringW;
  lampGroup.add(ring);
  const nSpokes = Math.max(3, Math.round(state.style.spokes));
  for (let k = 0; k < nSpokes; k++) {
    const a = (k / nSpokes) * TAU;
    const rOut = baseRadius(state.shape, a, 0);
    const len = Math.max(1, rOut - rHole - ringW + 2);
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(len, h + 0.6, 3), CLAY_SOLID);
    const mid = rHole + ringW - 1 + len / 2;
    spoke.position.set(Math.cos(a) * mid, h / 2, Math.sin(a) * mid);
    spoke.rotation.y = -a;
    lampGroup.add(spoke);
  }
}

function refreshGeometry() {
  const grid = buildVaseGrid(state.shape, state.texture, RADIAL_SEGS, HEIGHT_SEGS);
  const attr = vaseMesh.geometry.getAttribute('position');
  attr.array.set(grid.positions);
  attr.needsUpdate = true;
  vaseMesh.geometry.computeVertexNormals();
  vaseMesh.geometry.computeBoundingSphere();
}

// ---------- control handles ----------

function rebuildHandles() {
  handleGroup.clear();
  ringLineGroup.clear();
  handleMeshes = [];
  const sphereGeo = new THREE.SphereGeometry(1.8, 12, 10);
  for (let k = 0; k < state.shape.rings.length; k++) {
    for (let i = 0; i < CONTROL_POINTS_PER_RING; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: COL_HANDLE, depthTest: false });
      const mesh = new THREE.Mesh(sphereGeo, mat);
      mesh.renderOrder = 10;
      mesh.userData = { ringIndex: k, pointIndex: i };
      handleGroup.add(mesh);
      handleMeshes.push(mesh);
    }
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(65 * 3), 3));
    const line = new THREE.LineLoop(lineGeo, new THREE.LineBasicMaterial({
      color: COL_RING, transparent: true, opacity: 0.55, depthTest: false,
    }));
    line.renderOrder = 9;
    ringLineGroup.add(line);
  }
  refreshHandles();
}

function refreshHandles() {
  const { shape } = state;
  const nRings = shape.rings.length;
  if (handleMeshes.length !== nRings * CONTROL_POINTS_PER_RING) return rebuildHandles();
  let m = 0;
  for (let k = 0; k < nRings; k++) {
    const ring = shape.rings[k];
    const y = ring.z * shape.height;
    for (let i = 0; i < CONTROL_POINTS_PER_RING; i++) {
      const th = (i / CONTROL_POINTS_PER_RING) * TAU;
      const r = ring.radii[i] * shape.baseScale;
      handleMeshes[m++].position.set(Math.cos(th) * r, y, Math.sin(th) * r);
    }
    const line = ringLineGroup.children[k];
    const arr = line.geometry.getAttribute('position');
    for (let s = 0; s <= 64; s++) {
      const th = (s / 64) * TAU;
      const r = baseRadius(shape, th, ring.z) + 0.4;
      arr.setXYZ(s, Math.cos(th) * r, y, Math.sin(th) * r);
    }
    arr.needsUpdate = true;
  }
}

export function setHandlesVisible(v) {
  handleGroup.visible = v;
  ringLineGroup.visible = v;
}

// ---------- dragging ----------

const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
const dragPlane = new THREE.Plane();

function setPointer(e) {
  pointerNDC.set(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1,
  );
  raycaster.setFromCamera(pointerNDC, camera);
}

function onPointerDown(e) {
  if (!handleGroup.visible) return;
  setPointer(e);
  raycaster.params.Points = {};
  const hits = raycaster.intersectObjects(handleMeshes, false);
  if (!hits.length) return;
  const mesh = hits[0].object;
  dragging = mesh.userData;
  mesh.material.color.setHex(COL_HANDLE_ACTIVE);
  controls.enabled = false;
  dragPlane.set(new THREE.Vector3(0, 1, 0), -mesh.position.y);
  e.target.setPointerCapture?.(e.pointerId);
}

function onPointerMove(e) {
  if (!dragging) return;
  setPointer(e);
  const hit = new THREE.Vector3();
  if (!raycaster.ray.intersectPlane(dragPlane, hit)) return;
  const newR = Math.hypot(hit.x, hit.z);
  const ring = state.shape.rings[dragging.ringIndex];
  const clamped = Math.min(140, Math.max(3, newR)) / state.shape.baseScale;
  if (state.ui.dragMode === 'ring') {
    const delta = clamped - ring.radii[dragging.pointIndex];
    for (let i = 0; i < ring.radii.length; i++) {
      ring.radii[i] = Math.min(140, Math.max(3, ring.radii[i] + delta));
    }
  } else {
    ring.radii[dragging.pointIndex] = clamped;
  }
  emit('shape');
}

function onPointerUp() {
  if (!dragging) return;
  const idx = dragging.ringIndex * CONTROL_POINTS_PER_RING + dragging.pointIndex;
  handleMeshes[idx]?.material.color.setHex(COL_HANDLE);
  dragging = null;
  controls.enabled = true;
  emit('shapeCommitted');
}

// ---------- build plate ----------

function rebuildPlate() {
  plateGroup.clear();
  const [bx, by] = PRINTERS[state.printer.model].volume;
  const hx = bx / 2, hy = by / 2;
  const outline = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-hx, 0, -hy), new THREE.Vector3(hx, 0, -hy),
    new THREE.Vector3(hx, 0, hy), new THREE.Vector3(-hx, 0, hy),
  ]);
  plateGroup.add(new THREE.LineLoop(outline, new THREE.LineBasicMaterial({
    color: 0x3a2f26, transparent: true, opacity: 0.9,
  })));
  const grid = new THREE.PolarGridHelper(Math.min(hx, hy), 8, 6, 48, 0x241d17, 0x241d17);
  plateGroup.add(grid);
}

// ---------- toolpath preview ----------

export function showPreview(toolpath) {
  for (const child of previewGroup.children) child.geometry.dispose();
  previewGroup.clear();
  previewOn = !!toolpath;
  if (!toolpath) {
    updateModelVisibility();
    return;
  }
  const color = new THREE.Color();
  for (const seg of toolpath) {
    const n = seg.points.length / 3;
    if (n < 2) continue;
    const positions = new Float32Array(seg.points);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    let mat;
    if (seg.type === 'wall' || seg.type === 'mesh') {
      const colors = new Float32Array(n * 3);
      const h = state.shape.height || 1;
      for (let i = 0; i < n; i++) {
        const z = positions[i * 3 + 1];
        color.setHSL(0.66 - 0.66 * (z / h), 0.85, 0.55);
        colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      mat = new THREE.LineBasicMaterial({ vertexColors: true });
    } else {
      // brim / bottom / lamp mount → blue, like slicer previews
      mat = new THREE.LineBasicMaterial({ color: seg.type === 'brim' ? 0x3a6bff : 0x4a8cff });
    }
    previewGroup.add(new THREE.Line(geo, mat));
  }
  updateModelVisibility();
}

export function frameModel() {
  controls.target.set(0, state.shape.height / 2, 0);
}

// Square PNG snapshot of the current model, used as the .gcode.3mf
// thumbnail shown on the printer screen.
export function captureThumbnail(size = 512) {
  const prev = [handleGroup.visible, ringLineGroup.visible, plateGroup.visible];
  handleGroup.visible = false;
  ringLineGroup.visible = false;
  plateGroup.visible = false;
  renderer.render(scene, camera);
  const src = renderer.domElement;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const s = Math.min(src.width, src.height);
  ctx.drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, size, size);
  [handleGroup.visible, ringLineGroup.visible, plateGroup.visible] = prev;
  return c.toDataURL('image/png');
}
