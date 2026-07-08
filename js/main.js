// UI wiring: tabs, panels, sliders, printer settings, export.

import { state, on, emit, applyShapePreset, setRingCount } from './state.js';
import { PATTERNS, PATTERN_ICONS } from './patterns.js';
import { PRINTERS, NOZZLES } from './printers.js';
import { generateGcode, formatTime } from './gcode.js';
import { initEditor, setHandlesVisible, showPreview, frameModel } from './editor.js';

const $ = id => document.getElementById(id);

initEditor($('viewport'));

// ---------- tabs & panels ----------
const tabs = [...document.querySelectorAll('#tabbar .tab')];
const panels = [...document.querySelectorAll('.panel')];

tabs.forEach(tab => tab.addEventListener('click', () => {
  const id = tab.dataset.panel;
  const target = $(id);
  const wasOpen = target.classList.contains('open');
  panels.forEach(p => p.classList.remove('open'));
  tabs.forEach(t => t.classList.remove('active'));
  if (!wasOpen) {
    target.classList.add('open');
    tab.classList.add('active');
    if (id === 'panel-export') refreshStats();
  }
}));

setTimeout(() => $('hint').classList.add('hide'), 5000);

// ---------- generic slider binding ----------
function bindSlider(inputId, outputId, get, set, format) {
  const input = $(inputId), out = $(outputId);
  input.value = get();
  out.textContent = format(get());
  input.addEventListener('input', () => {
    set(parseFloat(input.value));
    out.textContent = format(parseFloat(input.value));
  });
}

// ---------- shape panel ----------
bindSlider('in-height', 'out-height',
  () => state.shape.height,
  v => { state.shape.height = v; emit('shape'); frameModel(); },
  v => `${v} mm`);

bindSlider('in-baseScale', 'out-baseScale',
  () => state.shape.baseScale * 100,
  v => { state.shape.baseScale = v / 100; emit('shape'); },
  v => `${v} %`);

bindSlider('in-rings', 'out-rings',
  () => state.shape.rings.length,
  v => { setRingCount(v); emit('ringsChanged'); },
  v => `${v}`);

document.querySelectorAll('[data-preset]').forEach(btn =>
  btn.addEventListener('click', () => {
    applyShapePreset(btn.dataset.preset);
    emit('ringsChanged');
  }));

$('btn-reset-shape').addEventListener('click', () => {
  applyShapePreset('classic');
  emit('ringsChanged');
});

// ---------- wall & base style ----------
document.querySelectorAll('.wallopt').forEach(btn =>
  btn.addEventListener('click', () => {
    state.style.wall = btn.dataset.wall;
    document.querySelectorAll('.wallopt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $('mesh-controls').hidden = state.style.wall !== 'mesh';
    emit('style');
  }));

bindSlider('in-meshpitch', 'out-meshpitch',
  () => state.style.meshPitch,
  v => { state.style.meshPitch = v; emit('style'); },
  v => `${v.toFixed(1)} mm`);
bindSlider('in-meshdensity', 'out-meshdensity',
  () => state.style.meshDensity,
  v => { state.style.meshDensity = v; emit('style'); },
  v => `${v}`);

document.querySelectorAll('.baseopt').forEach(btn =>
  btn.addEventListener('click', () => {
    state.style.bottom = btn.dataset.base;
    document.querySelectorAll('.baseopt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $('lamp-controls').hidden = state.style.bottom !== 'lamp';
    emit('style');
  }));

document.querySelectorAll('.sockopt').forEach(btn =>
  btn.addEventListener('click', () => {
    state.style.socket = btn.dataset.sock;
    document.querySelectorAll('.sockopt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    $('sock-dia-row').hidden = state.style.socket !== 'custom';
    emit('style');
  }));

bindSlider('in-sockdia', 'out-sockdia',
  () => state.style.socketDia,
  v => { state.style.socketDia = v; emit('style'); },
  v => `${v} mm`);
bindSlider('in-spokes', 'out-spokes',
  () => state.style.spokes,
  v => { state.style.spokes = v; emit('style'); },
  v => `${v}`);

// ---------- texture panel ----------
const patternGrid = $('pattern-grid');
for (const [key, def] of Object.entries(PATTERNS)) {
  const btn = document.createElement('button');
  btn.className = 'pat' + (state.texture.pattern === key ? ' active' : '');
  btn.innerHTML = `<svg viewBox="0 0 24 24">${PATTERN_ICONS[key]}</svg><span>${def.label}</span>`;
  btn.addEventListener('click', () => {
    state.texture.pattern = key;
    patternGrid.querySelectorAll('.pat').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    emit('texture');
  });
  patternGrid.appendChild(btn);
}

bindSlider('in-amplitude', 'out-amplitude',
  () => state.texture.amplitude,
  v => { state.texture.amplitude = v; emit('texture'); },
  v => `${v.toFixed(1)} mm`);
bindSlider('in-frequency', 'out-frequency',
  () => state.texture.frequency,
  v => { state.texture.frequency = v; emit('texture'); },
  v => `${v}`);
bindSlider('in-vfrequency', 'out-vfrequency',
  () => state.texture.vfrequency,
  v => { state.texture.vfrequency = v; emit('texture'); },
  v => `${v}`);
bindSlider('in-twist', 'out-twist',
  () => state.texture.twist,
  v => { state.texture.twist = v; emit('texture'); },
  v => `${v}°`);
bindSlider('in-poffset', 'out-poffset',
  () => state.texture.offset,
  v => { state.texture.offset = v; emit('texture'); },
  v => `${v}°`);
bindSlider('in-fadein', 'out-fadein',
  () => state.texture.fadeIn,
  v => { state.texture.fadeIn = v; emit('texture'); },
  v => `${v} mm`);

// ---------- printer panel ----------
const printerGrid = $('printer-grid');
for (const [key, def] of Object.entries(PRINTERS)) {
  const btn = document.createElement('button');
  btn.className = 'opt' + (state.printer.model === key ? ' active' : '') + (key === 'custom' ? ' wide' : '');
  btn.textContent = def.label;
  btn.dataset.model = key;
  btn.addEventListener('click', () => selectPrinter(key));
  printerGrid.appendChild(btn);
}

function selectPrinter(key) {
  state.printer.model = key;
  printerGrid.querySelectorAll('.opt').forEach(b =>
    b.classList.toggle('active', b.dataset.model === key));
  const def = PRINTERS[key];
  $('out-volume').textContent = def.volume.join(' × ') + ' mm';
  $('printer-note').hidden = def.family !== 'bambu';
  $('custom-code').hidden = key !== 'custom';
  emit('printer');
}
selectPrinter(state.printer.model);

document.querySelectorAll('.mat').forEach(btn =>
  btn.addEventListener('click', () => {
    state.printer.material = btn.dataset.mat;
    document.querySelectorAll('.mat').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    emit('printer');
  }));

document.querySelectorAll('.noz').forEach(btn =>
  btn.addEventListener('click', () => {
    const noz = parseFloat(btn.dataset.noz);
    state.printer.nozzle = noz;
    document.querySelectorAll('.noz').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const rec = NOZZLES[noz];
    state.printer.lineWidth = rec.lineWidth;
    state.printer.layerHeight = rec.layerHeight;
    $('in-linew').value = rec.lineWidth;
    $('out-linew').textContent = `${rec.lineWidth.toFixed(2)} mm`;
    $('in-layerh').value = rec.layerHeight;
    $('out-layerh').textContent = `${rec.layerHeight.toFixed(2)} mm`;
    emit('printer');
  }));

$('custom-start').addEventListener('input', e => { state.printer.customStart = e.target.value; });
$('custom-end').addEventListener('input', e => { state.printer.customEnd = e.target.value; });

bindSlider('in-layerh', 'out-layerh',
  () => state.printer.layerHeight,
  v => { state.printer.layerHeight = v; emit('printer'); },
  v => `${v.toFixed(2)} mm`);
bindSlider('in-linew', 'out-linew',
  () => state.printer.lineWidth,
  v => { state.printer.lineWidth = v; emit('printer'); },
  v => `${v.toFixed(2)} mm`);
bindSlider('in-bottoml', 'out-bottoml',
  () => state.printer.bottomLayers,
  v => { state.printer.bottomLayers = v; emit('printer'); },
  v => `${v}`);
bindSlider('in-brim', 'out-brim',
  () => state.printer.brimLoops,
  v => { state.printer.brimLoops = v; emit('printer'); },
  v => `${v}`);

// ---------- top controls ----------
$('btn-edit').addEventListener('click', () => {
  state.ui.editHandles = !state.ui.editHandles;
  $('btn-edit').classList.toggle('active', state.ui.editHandles);
  setHandlesVisible(state.ui.editHandles && !state.ui.preview);
});

$('btn-preview').addEventListener('click', () => {
  state.ui.preview = !state.ui.preview;
  $('btn-preview').classList.toggle('active', state.ui.preview);
  setHandlesVisible(!state.ui.preview && state.ui.editHandles);
  updatePreview();
});

$('mode-point').addEventListener('click', () => setDragMode('point'));
$('mode-ring').addEventListener('click', () => setDragMode('ring'));
function setDragMode(mode) {
  state.ui.dragMode = mode;
  $('mode-point').classList.toggle('active', mode === 'point');
  $('mode-ring').classList.toggle('active', mode === 'ring');
}

let previewTimer = null;
function updatePreview() {
  if (!state.ui.preview) { showPreview(null); return; }
  const { toolpath } = generateGcode(state);
  showPreview(toolpath);
}
function schedulePreviewRefresh() {
  if (!state.ui.preview) return;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 350);
}
on('shape', schedulePreviewRefresh);
on('texture', schedulePreviewRefresh);
on('printer', schedulePreviewRefresh);
on('style', schedulePreviewRefresh);

// ---------- export ----------
function refreshStats() {
  const { stats } = generateGcode(state);
  $('stat-layers').textContent = stats.layers;
  $('stat-filament').textContent = `${stats.filamentG.toFixed(0)} g`;
  $('stat-time').textContent = formatTime(stats.timeS);
  $('stat-size').textContent = stats.bytes > 1048576
    ? `${(stats.bytes / 1048576).toFixed(1)} MB`
    : `${(stats.bytes / 1024).toFixed(0)} kB`;
  const warn = $('export-warn');
  warn.hidden = stats.warnings.length === 0;
  warn.textContent = stats.warnings.join(' ');
}

let statsTimer = null;
function scheduleStats() {
  if (!$('panel-export').classList.contains('open')) return;
  clearTimeout(statsTimer);
  statsTimer = setTimeout(refreshStats, 400);
}
on('shape', scheduleStats);
on('texture', scheduleStats);
on('printer', scheduleStats);
on('style', scheduleStats);

$('btn-export').addEventListener('click', () => {
  const { gcode, stats } = generateGcode(state);
  refreshStats();
  const name = ($('in-filename').value.trim() || 'kjd-vase').replace(/[^\w.-]+/g, '_');
  const blob = new Blob([gcode], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.gcode`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});
