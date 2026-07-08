// Three.js viewport: vase mesh, draggable control-point handles,
// build-plate visual and toolpath preview.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { state, on, emit, TAU, CONTROL_POINTS_PER_RING } from './state.js';
import { buildVaseGrid, baseRadius } from './vase.js';
import { PRINTERS } from './printers.js';

const RADIAL_SEGS = 144;
const HEIGHT_SEGS = 160;

let renderer, scene, camera, controls;
let vaseMesh, handleGroup, ringLineGroup, plateGroup, previewGroup;
let handleMeshes = []; // { mesh, ringIndex, pointIndex }
let dragging = null;
let dirty = true;

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
  scene.add(handleGroup, ringLineGroup, plateGroup, previewGroup);

  rebuildHandles();
  rebuildPlate();

  on('shape', () => { dirty = true; });
  on('texture', () => { dirty = true; });
  on('printer', rebuildPlate);
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
    dirty = false;
  }
  controls.update();
  renderer.render(scene, camera);
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
  previewGroup.clear();
  if (!toolpath) {
    previewGroup.visible = false;
    vaseMesh.visible = true;
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
    if (seg.type === 'wall') {
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
      mat = new THREE.LineBasicMaterial({ color: seg.type === 'brim' ? 0x3a6bff : 0x4a8cff });
    }
    previewGroup.add(new THREE.Line(geo, mat));
  }
  previewGroup.visible = true;
  vaseMesh.visible = false;
}

export function frameModel() {
  controls.target.set(0, state.shape.height / 2, 0);
}
