// Printer presets: build volume + start/end G-code templates.
// Placeholders: {nozzle_temp} {bed_temp} {fan}

const BAMBU_START = `;===== KJD GCODE start (Bambu, external spool) =====
G90
M83
M140 S{bed_temp}
M104 S{nozzle_temp}
G28
M190 S{bed_temp}
M109 S{nozzle_temp}
G92 E0
; purge line
G1 X10 Y5 Z0.3 F6000
G1 X120 Y5 E12 F1200
G1 X120 Y5.6 F6000
G1 X10 Y5.6 E12 F1200
G92 E0`;

const BAMBU_END = `;===== KJD GCODE end =====
M104 S0
M140 S0
G92 E0
G1 E-2 F1800
G91
G1 Z5 F600
G90
G1 X65 Y245 F9000
M107
M84`;

const PRUSA_START = `;===== KJD GCODE start (Prusa) =====
G90
M83
M104 S{nozzle_temp}
M140 S{bed_temp}
G28 W
G80
M109 S{nozzle_temp}
M190 S{bed_temp}
G92 E0
; purge line
G1 Y-3 F1000
G1 Z0.4 F1000
G1 X55 E8 F2000
G1 X100 E12.5 F1400
G92 E0`;

const PRUSA_END = `;===== KJD GCODE end =====
M104 S0
M140 S0
G92 E0
G1 E-1.5 F2100
G91
G1 Z5 F600
G90
G1 X0 Y200 F3000
M107
M84`;

const CORE_START = PRUSA_START.replace('G28 W\nG80', 'G28');
const CORE_END = PRUSA_END;

export const PRINTERS = {
  bambu_a1:      { label: 'Bambu A1',          volume: [256, 256, 256], start: BAMBU_START, end: BAMBU_END,  family: 'bambu', originCenter: false },
  bambu_a1_mini: { label: 'Bambu A1 mini',     volume: [180, 180, 180], start: BAMBU_START, end: BAMBU_END.replace('Y245', 'Y170'), family: 'bambu', originCenter: false },
  bambu_p1s:     { label: 'Bambu P1S',         volume: [256, 256, 256], start: BAMBU_START, end: BAMBU_END,  family: 'bambu', originCenter: false },
  bambu_h2s:     { label: 'Bambu H2S',         volume: [325, 320, 325], start: BAMBU_START, end: BAMBU_END.replace('Y245', 'Y310'), family: 'bambu', originCenter: false },
  prusa_mk3s:    { label: 'Prusa MK3S',        volume: [250, 210, 210], start: PRUSA_START, end: PRUSA_END,  family: 'prusa', originCenter: false },
  prusa_mk4:     { label: 'Prusa MK4',         volume: [250, 210, 220], start: PRUSA_START, end: PRUSA_END,  family: 'prusa', originCenter: false },
  core_one:      { label: 'Prusa CORE One',    volume: [250, 220, 270], start: CORE_START,  end: CORE_END,   family: 'prusa', originCenter: false },
  core_one_l:    { label: 'Prusa CORE One L',  volume: [300, 300, 330], start: CORE_START,  end: CORE_END,   family: 'prusa', originCenter: false },
  custom:        { label: 'Custom code',       volume: [256, 256, 256], start: 'G90\nM83\nM104 S{nozzle_temp}\nM140 S{bed_temp}\nG28\nM109 S{nozzle_temp}\nM190 S{bed_temp}\nG92 E0', end: 'M104 S0\nM140 S0\nM107\nM84', family: 'custom', originCenter: false },
};

export const MATERIALS = {
  PLA:  { nozzleTemp: { bambu: 220, prusa: 215, custom: 210 }, bedTemp: 60, fanPct: 100, maxSpeed: 60 },
  PETG: { nozzleTemp: { bambu: 250, prusa: 240, custom: 240 }, bedTemp: 75, fanPct: 40,  maxSpeed: 40 },
};

// Sensible line-width / layer-height windows per nozzle diameter.
export const NOZZLES = {
  0.4: { lineWidth: 0.45, layerHeight: 0.2,  maxLayer: 0.3,  maxLine: 0.8 },
  0.8: { lineWidth: 0.9,  layerHeight: 0.4,  maxLayer: 0.6,  maxLine: 1.6 },
  1.4: { lineWidth: 1.6,  layerHeight: 0.7,  maxLayer: 1.0,  maxLine: 2.4 },
};

export function resolveTemps(printerKey, materialKey) {
  const printer = PRINTERS[printerKey];
  const mat = MATERIALS[materialKey];
  return {
    nozzleTemp: mat.nozzleTemp[printer.family] ?? mat.nozzleTemp.custom,
    bedTemp: mat.bedTemp,
    fanPWM: Math.round(mat.fanPct * 2.55),
  };
}
