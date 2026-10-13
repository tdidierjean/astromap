# AstroMap

A lightweight, browser-based night sky planner for apartment observers with limited sky access.

Tracks the **Moon, Venus, Mercury, Mars, Jupiter and Saturn**, tells you when each object passes through your visible sky windows during the upcoming night, and shows a live **sky view** of what you can see from each window.

## Features

### Sky tab (main screen)

- Stereographic star map centred on the selected window (North / South), horizon near the bottom, ground and cardinal labels
- Moon tracking: an edge chip (phase icon, altitude, compass, arrow) points to the Moon when it is up but off-screen (tap to pan to it); when it is hidden by trees/roofs or outside the window it is drawn as a faint outlined disc; when below the horizon a chip shows its next rise. Default zoom (~100° horizontal fov) is set by `DEFAULT_HFOV` in `src/sky/camera.ts`
- ~1600 stars down to magnitude 5, sized by magnitude with glow; limiting-magnitude slider (default 4.0, also capped by twilight)
- Constellation lines (dim), asterisms such as the Big Dipper and Summer Triangle (brighter), constellation and star names
- Planets and the Moon (with phase shading); sky colour follows the Sun's altitude
- Area outside the window or below the minimum altitude is dimmed; optional az/alt grid
- Time scrubber from sunset to sunrise, night navigation, a **Now** button (auto-advances every 30 s); tapping the Gantt timeline on the Plan tab also sets the sky time
- Drag to pan, pinch / wheel to zoom (field of view 20-150 degrees), double-tap or the reset button to recentre
- Tap an object (within about 20 px) for name, magnitude, altitude/azimuth and the time spans it is visible in each window tonight

### Plan tab

- Per-object visibility summary — next window start/end time and direction
- Navigate up to 7 days into the past and 14 days into the future using the night browser in the header
- Gantt-style timeline from sunset to sunrise showing when each object is observable
- Altitude curve overlay on the timeline (faint line showing how high each object is)
- Horizon panorama showing each object's full night arc plotted as azimuth × altitude, with current-position dots for tonight
- Moon phase display (text description + phase angle)
- Configurable azimuth viewing windows (e.g. ±45° around North and South)
- Configurable minimum altitude threshold
- Runs entirely in the browser — no server, no API calls, no internet required after build
- Settings persist in `localStorage`

## Setup

Requires [Bun](https://bun.sh).

```bash
bun install
bun run build
```

Then open `index.html` in your browser.

For development with auto-rebuild on file changes:

```bash
bun run dev
```

### Viewing over SSH

Start a static file server on the remote machine:

```bash
python3 -m http.server 8080
```

Then on your local machine, forward the port:

```bash
ssh -L 8080:localhost:8080 user@server
```

Open `http://localhost:8080` in your local browser.

## Configuration

Click **Settings** at the bottom of the page to adjust:

| Setting | Default | Description |
|---|---|---|
| Latitude | 50.74° | Observer latitude |
| Longitude | 7.12° | Observer longitude (Bonn-Beuel) |
| North window | ±45° | Half-width of north viewing arc (centre 0°, covers 315°–45°) |
| South window | ±45° | Half-width of south viewing arc (centre 180°, covers 135°–225°) |
| Min altitude | 10° | Objects below this elevation are ignored |

Settings are saved automatically in `localStorage`.

## How it works

### Astronomy calculations

All calculations use the [`astronomy-engine`](https://github.com/cosinekitty/astronomy) library (Don Cross), which runs entirely in the browser. For each object, the app:

1. Finds tonight's sunset and sunrise using `SearchRiseSet`
2. Samples the object's position every 15 minutes between sunset and sunrise
3. At each sample, converts equatorial coordinates (RA/Dec) to horizontal coordinates (azimuth/altitude) via `Horizon()`
4. Checks whether the azimuth falls within one of the configured viewing windows **and** the altitude is above the minimum threshold

Azimuth convention: 0° = North, 90° = East, 180° = South, 270° = West.

### Viewing window check

For each configured window (centre azimuth + half-width), the signed angular difference between the object's azimuth and the window centre is computed with wraparound handling:

```
diff = ((az - center + 540) % 360) - 180
visible = |diff| <= halfWidth  AND  altitude >= minAlt
```

The north window (centre 0°) correctly handles the 0°/360° boundary.

### Timeline

Rendered on a `<canvas>` element. Each row represents one tracked object. Segments are colour-coded:

- **Solid colour** — object is within a viewing window and above the minimum altitude
- **Very faint colour** — object is above the horizon but outside all viewing windows
- **Dark/empty** — object is below the horizon

A red dashed "now" line shows the current time (tonight's view only).

### Horizon panorama

A second canvas below the timeline plots each object's position spatially: azimuth (0°–360°, N→E→S→W→N) on the X-axis and altitude (0°–90°) on the Y-axis. Configured viewing windows are shaded as vertical bands. A red dashed line marks the minimum altitude threshold. For tonight's view, a filled dot with the object name shows each object's current position on its arc.

## Project structure

```
astromap/
├── index.html          # Page shell: Sky / Plan tabs
├── scripts/
│   ├── build-catalog.ts  # Generates src/data/catalog.json (needs internet)
│   └── check-astro.ts    # Verifies the fast rotation maths against Horizon()
├── src/
│   ├── main.ts         # Glue: tabs, time model, controls
│   ├── astro.ts        # Bodies, windows, night spans, fixed-star rotation
│   ├── catalog.ts      # Typed arrays built from the catalog JSON
│   ├── config.ts       # Settings + localStorage
│   ├── format.ts       # Time / moon-phase formatting
│   ├── state.ts        # Shared night offset
│   ├── planner.ts      # Plan tab: cards, timeline, panorama, settings
│   ├── sky/
│   │   ├── sky.ts      # SkyView: rendering and interaction
│   │   ├── camera.ts   # Stereographic projection
│   │   └── palette.ts  # Sky colours, twilight, star colours
│   ├── data/catalog.json  # Generated star catalog (committed)
│   └── style.css       # Dark theme styles
├── dist/main.js        # Bundled output (generated, gitignored)
└── package.json
```

### Sky view maths

Stars are stored as J2000 unit vectors. Once per frame, the J2000-to-local (east/north/up) rotation matrix is derived from `Astronomy.Rotation_EQJ_HOR` and combined with the camera basis, then applied to every star and line vertex. This matches `Horizon()` to better than 0.0001 degrees (`bun run scripts/check-astro.ts`). Planets and the Moon use `Horizon()` directly. Projection is stereographic (x = 2 tan(theta/2)); the horizon, being a great circle, projects to a circle.

### Star catalog and attribution

`src/data/catalog.json` is generated by `bun run scripts/build-catalog.ts` and committed, so the app needs no network at runtime. Star positions, magnitudes, names, constellation lines and constellation names come from [d3-celestial](https://github.com/ofrohn/d3-celestial) by Olaf Frohn (BSD 3-Clause licence; derived from the Hipparcos catalogue and IAU / Stellarium data). Copyright (c) 2015, Olaf Frohn. Asterism line sets are hand-defined in the script.

### Type checking

`bunx tsc --noEmit` (or `bun run typecheck`) type-checks `src/` and `scripts/`.
