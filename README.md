# KJD GCODE — Vase Designer

Design a vase in 3D and export ready-to-print **spiral vase-mode G-code**
directly — no STL, no slicer. Inspired by OGcode-style vase designers.

## Run it

Any static file server works — there is no build step:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Features

- **3D shape editor** — drag the orange control points directly on the model.
  `Point` mode deforms locally (asymmetric shapes), `Ring` mode scales a whole
  ring. Shape presets: Classic, Hourglass, Bulb, Cone, Cylinder, Wobble.
- **Surface textures** — Smooth, Sine, Ripple, N-Wave, V-Wave, Bubbles,
  Pixels, Triangle, with Amplitude / Frequency / V-Frequency / Twist /
  Pattern offset / Fade-in sliders.
- **Printer presets** — Bambu A1, A1 mini, P1S, H2S, Prusa MK3S, MK4,
  CORE One, CORE One L, or fully custom start/end G-code. PLA & PETG
  profiles, 0.4 / 0.8 / 1.4 mm nozzles, layer height, line width, bottom
  layers, brim.
- **Toolpath preview** — the `Preview` toggle renders the actual generated
  toolpath (brim + solid bottom in blue, spiral wall as a height gradient).
- **Export** — one continuous spiralized outer wall (no seams, no
  retractions), solid bottom, brim, per-material temperatures and fan
  control, plus filament / time / size estimates and build-volume checks.

The G-code generator and the 3D view share the same `r(θ, z)` radius
function, so what you see is exactly what prints.

> **Bambu note:** filament via external spool / manual feed. Exported raw
> G-code can't engage the AMS — Bambu routes the AMS only from a
> `.gcode.3mf`, regardless of nozzle.

## Project layout

```
index.html        UI skeleton (panels, tabs)
css/style.css     dark terracotta theme
js/state.js       app state, shape presets, pub/sub
js/patterns.js    texture pattern math + icons
js/vase.js        control-ring lattice → r(θ, z) + mesh grid
js/editor.js      Three.js viewport, drag handles, toolpath preview
js/printers.js    printer presets, materials, start/end G-code
js/gcode.js       spiral vase-mode G-code generator + estimates
js/main.js        UI wiring
vendor/           three.js r160 (vendored, no CDN needed)
```

⚠️ Always watch the first layers of a print from generated G-code. Use at
your own risk.
