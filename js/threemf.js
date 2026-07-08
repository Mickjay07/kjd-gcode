// Minimal .gcode.3mf builder for Bambu printers: a stored (uncompressed)
// ZIP containing Metadata/plate_1.gcode, its MD5, thumbnails and the
// metadata files the firmware expects, so the file prints straight from
// the SD card / printer screen without any slicer.

// ---------- MD5 (RFC 1321) ----------

const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = new Uint32Array(64);
for (let i = 0; i < 64; i++) MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32);

export function md5hex(input) {
  const len = input.length;
  const padded = (((len + 8) >> 6) + 1) << 6;
  const msg = new Uint8Array(padded);
  msg.set(input);
  msg[len] = 0x80;
  const dv = new DataView(msg.buffer);
  dv.setUint32(padded - 8, (len * 8) >>> 0, true);
  dv.setUint32(padded - 4, Math.floor((len * 8) / 2 ** 32), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const M = new Uint32Array(16);
  for (let off = 0; off < padded; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + MD5_K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + ((F << MD5_S[i]) | (F >>> (32 - MD5_S[i])))) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, a0, true); ov.setUint32(4, b0, true);
  ov.setUint32(8, c0, true); ov.setUint32(12, d0, true);
  return [...out].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ---------- ZIP (store method) ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const ZIP_DATE = 0x5AE8; // 2025-07-08 packed DOS date, arbitrary fixed value

export function zipStore(entries) { // entries: [{ name, data: Uint8Array }]
  const enc = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameB = enc.encode(e.name);
    const crc = crc32(e.data);
    const local = new Uint8Array(30 + nameB.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(8, 0, true);              // method: store
    dv.setUint16(12, ZIP_DATE, true);
    dv.setUint32(14, crc, true);
    dv.setUint32(18, e.data.length, true);
    dv.setUint32(22, e.data.length, true);
    dv.setUint16(26, nameB.length, true);
    local.set(nameB, 30);
    chunks.push(local, e.data);
    central.push({ nameB, crc, size: e.data.length, offset });
    offset += local.length + e.data.length;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) {
    const rec = new Uint8Array(46 + c.nameB.length);
    const dv = new DataView(rec.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(14, ZIP_DATE, true);
    dv.setUint32(16, c.crc, true);
    dv.setUint32(20, c.size, true);
    dv.setUint32(24, c.size, true);
    dv.setUint16(28, c.nameB.length, true);
    dv.setUint32(42, c.offset, true);
    rec.set(c.nameB, 46);
    chunks.push(rec);
    cdSize += rec.length;
  }
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdStart, true);
  chunks.push(end);

  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

// ---------- .gcode.3mf assembly ----------

const FILAMENT_IDX = { PLA: 'GFL99', PETG: 'GFG99' }; // generic filament profiles

/**
 * meta: { printerModelId, printerName, nozzle, material, prediction (s),
 *         weightG, usedM, thumbnailPng?: Uint8Array }
 */
export function buildGcode3mf(gcode, meta) {
  const enc = new TextEncoder();
  const gcodeBytes = enc.encode(gcode);
  const md5 = md5hex(gcodeBytes).toUpperCase();

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Default Extension="gcode" ContentType="text/x.gcode"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
 <Relationship Target="/Metadata/plate_1.png" Id="rel-2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>
</Relationships>`;

  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">
 <metadata name="Application">BambuStudio-01.09.00.60</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Title">KJD GCODE vase</metadata>
 <resources/>
 <build/>
</model>`;

  const modelSettings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
    <metadata key="gcode_file" value="Metadata/plate_1.gcode"/>
    <metadata key="thumbnail_file" value="Metadata/plate_1.png"/>
    <metadata key="thumbnail_no_light_file" value="Metadata/plate_no_light_1.png"/>
    <metadata key="top_file" value="Metadata/top_1.png"/>
    <metadata key="pick_file" value="Metadata/pick_1.png"/>
  </plate>
</config>`;

  const sliceInfo = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <header>
    <header_item key="X-BBL-Client-Type" value="slicer"/>
    <header_item key="X-BBL-Client-Version" value="01.09.00.60"/>
  </header>
  <plate>
    <metadata key="index" value="1"/>
    <metadata key="printer_model_id" value="${meta.printerModelId}"/>
    <metadata key="nozzle_diameters" value="${meta.nozzle}"/>
    <metadata key="timelapse_type" value="0"/>
    <metadata key="prediction" value="${Math.round(meta.prediction)}"/>
    <metadata key="weight" value="${meta.weightG.toFixed(2)}"/>
    <metadata key="outside" value="false"/>
    <metadata key="support_used" value="false"/>
    <metadata key="label_object_enabled" value="false"/>
    <filament id="1" tray_info_idx="${FILAMENT_IDX[meta.material] ?? 'GFL99'}" type="${meta.material}" color="#FF8040" used_m="${(meta.usedM / 1000).toFixed(2)}" used_g="${meta.weightG.toFixed(2)}"/>
  </plate>
</config>`;

  const plateJson = JSON.stringify({
    bed_type: 'textured_plate',
    filament_colors: ['#FF8040'],
    filament_ids: [1],
    first_extruder: 1,
    is_seq_print: false,
    nozzle_diameter: meta.nozzle,
    version: 2,
  });

  const entries = [
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: '3D/3dmodel.model', data: enc.encode(model) },
    { name: 'Metadata/plate_1.gcode', data: gcodeBytes },
    { name: 'Metadata/plate_1.gcode.md5', data: enc.encode(md5) },
    { name: 'Metadata/model_settings.config', data: enc.encode(modelSettings) },
    { name: 'Metadata/slice_info.config', data: enc.encode(sliceInfo) },
    { name: 'Metadata/plate_1.json', data: enc.encode(plateJson) },
  ];
  if (meta.thumbnailPng?.length) {
    for (const name of ['plate_1.png', 'plate_no_light_1.png', 'top_1.png', 'pick_1.png']) {
      entries.push({ name: `Metadata/${name}`, data: meta.thumbnailPng });
    }
  }
  return zipStore(entries);
}
