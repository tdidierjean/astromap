# AstroMap

AstroMap is a night sky planner for people who can only see part of the sky, for example from an apartment window or balcony. You tell it where you are and which way your windows face. It then shows when the Moon, Venus, Mercury, Mars, Jupiter and Saturn are visible through those windows tonight, and draws a live star map of what you can see.

It is a static web page (a PWA). Everything runs in your browser and your settings stay on your device. The only network calls are optional: a cloud-cover forecast, and place search and elevation lookup during setup, all from [Open-Meteo](https://open-meteo.com/).

## Using it

### First run

On first start a short setup asks for:

1. **Where you are.** Use your device location (rounded to about 1 km), type latitude and longitude, or search for a place name. A place search or device location also fills in elevation (looked up from Open-Meteo) and, for a search, the time zone; typed coordinates use the device time zone and elevation 0. Both can be changed in Settings.
2. **Your first window.** A name and the direction it faces, plus a rough width. You can skip this and add windows later.

You can also import a settings file from the setup screen.

To look around before setting anything up, open the app with `#demo` at the end of the URL (for example `https://example.github.io/astromap/#demo`), or use "Just look around" in the setup. The demo is a balcony in Bonn-Beuel, Germany, with measured horizons. It lives in memory only: nothing is saved, and your own setup is not touched.

### Sky tab

A star map centred on the selected window. Drag to pan, pinch or scroll to zoom, double-tap to recentre. Parts of the sky outside the window, or hidden behind your horizon, are dimmed. Tap an object for its name, magnitude, position and the times it is visible tonight. A time scrubber covers sunset to sunrise, and "Now" jumps to the current time. A cloud-cover strip shows the forecast when it can be fetched.

### Plan tab

For each object: the next time span it is visible in each window, with direction. A timeline from sunset to sunrise shows when each object is observable, and a panorama (azimuth by altitude) shows each object's arc across the night. The night browser in the header moves up to 7 days back and 14 days forward. All times use the location's time zone, not the device's.

### Windows

In **Settings**, windows can be added, renamed, reordered and deleted. A window is one of:

- **Simple**: a direction it faces and a half-width. Anything lower than the minimum altitude setting (default 10 degrees) counts as blocked.
- **Measured horizon**: the outline of the roofs, walls and trees you actually see, from a left wall to a right wall. Objects are visible only above that outline.

### Horizon editor

"Draw horizon" (or "Edit horizon" on a window that already has one) opens a full-screen panorama (azimuth by altitude) with the brightest stars, planets and the Moon drawn behind it at a time you choose. Set the left and right wall azimuths, tap to add points, drag them to match the outline you see, and mark each segment as building, deciduous tree, conifer or estimated. For a deciduous tree you also set the roofline behind it, which applies when the trees are bare. Lining up a bright star against the edge of a roof is a good way to check the outline. Undo and redo are available.

Deciduous trees follow a leaf season. The default depends on latitude: 25 April to 10 November in the northern hemisphere, 25 October to 10 May in the southern, and always in leaf within 15 degrees of the equator. Climates differ, so Settings lets you set your own start and end dates, or you can force "In leaf" or "Bare".

### Import and export

Settings, "Backup": export your whole setup (place, options and all windows) as a JSON file, or a single window with its horizon from that window's card. On phones that support it the share sheet is used; otherwise the file is downloaded. Import checks the file (value ranges, size, version) before anything is applied. Use it to move to a new phone or to share a horizon.

### Install on a phone

AstroMap is a PWA and works offline once opened (the forecast and place search need a connection).

- **iPhone / iPad (Safari):** Share, then **Add to Home Screen**.
- **Android (Chrome):** menu, then **Install app**.

## Example: a balcony in Bonn

The app was first built for a balcony in Bonn-Beuel with two windows, north and south, partly blocked by neighbouring buildings and trees. Instead of guessing the obstructions, the horizon was measured from phone photos: the stars in a night photo are plate-solved to find exactly where the camera pointed, and each pixel along the outline of a roof or tree is then converted to azimuth and altitude. The method, its accuracy (about 1 to 2 degrees) and the scripts are described in [tools/horizon/README.md](tools/horizon/README.md). The resulting profiles are the demo (`#demo`).

You do not need any of that to use the app: the horizon editor gets you most of the way by eye.

## Self-hosting

AstroMap is plain static files, so any static host works. For GitHub Pages:

1. Fork the repository on GitHub.
2. In your fork, go to Settings, Pages, and set Source to **GitHub Actions**.
3. Push a commit to the `master` branch. If your default branch has another name, change `branches:` in `.github/workflows/deploy.yml`.

The workflow in `.github/workflows/deploy.yml` runs on every push to `master`: it installs Bun, runs `bun install` and `bun run build`, and publishes the `_site/` folder to Pages. It does not run the tests or the type check. The site is then served at `https://<your-user>.github.io/<repo>/`. All paths in the app are relative, so it works under that sub-path. Pages serves HTTPS, which the service worker and the geolocation prompt need.

To host elsewhere, run `bun run build` and upload the contents of `_site/` to any static web server (HTTPS is needed for install, offline use and geolocation).

## Development

Requires [Bun](https://bun.sh).

```bash
bun install
bun test               # unit tests
bun run typecheck      # tsc --noEmit
bun run build          # bundles dist/main.js and assembles _site/
bun run preview        # serves _site/ on http://localhost:8080
bun run dev            # rebuilds dist/main.js on change
```

### What the build does

`bun run build` bundles the app, then copies exactly the files listed in `scripts/site-files.ts` into `_site/` (gitignored), adds `.nojekyll`, and generates `_site/sw.js`. The service worker's precache list and cache version are derived from that same list, so each deploy is picked up automatically and the page reloads once when a new version takes over.

To publish a new file (an icon, a script), add its path to `scripts/site-files.ts`. The build fails if a listed file is missing or if `index.html` or the manifest references a local file that is not listed.

Icons are generated from `icons/*.svg` with `python3 scripts/build_icons.py` (needs Playwright).

## Credits and licences

| What | Source | Terms |
|---|---|---|
| Sun, Moon and planet positions | [Astronomy Engine](https://github.com/cosinekitty/astronomy) by Don Cross (npm `astronomy-engine`), bundled into the app | MIT, copyright 2019-2025 Don Cross |
| Stars, constellation lines and names | `src/data/catalog.json`, generated from [d3-celestial](https://github.com/ofrohn/d3-celestial) by Olaf Frohn (`scripts/build-catalog.ts`). Star data is XHIP, an extended Hipparcos compilation (Anderson and Francis 2012, CDS VizieR V/137D); constellations from the IAU | d3-celestial: BSD 3-Clause, copyright 2015 Olaf Frohn. Please acknowledge CDS and the XHIP catalogue |
| Cloud forecast, place search, elevation | [Open-Meteo](https://open-meteo.com/) free API, called from the browser. Place search uses [GeoNames](https://www.geonames.org/); elevation uses the Copernicus DEM (ESA) | Data CC BY 4.0, with attribution (shown in Settings). The free API is for **non-commercial use** only |
| Bonn horizon profiles (`src/data/horizon-*.ts`) | Measured by the author | Same terms as the rest of the code |
| Icons, fonts | Own artwork (`icons/`); no web fonts, the system font stack is used | Same terms as the rest of the code |

The licence notices required by the bundled code and data are in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt), which is also published with the app and linked from Settings. AstroMap itself is released under the [MIT licence](LICENSE).

## How it works

### Astronomy calculations

All calculations use the [`astronomy-engine`](https://github.com/cosinekitty/astronomy) library (Don Cross), which runs entirely in the browser. For each object, the app:

1. Finds tonight's sunset and sunrise using `SearchRiseSet`
2. Samples the object's position every 15 minutes between sunset and sunrise
3. At each sample, converts equatorial coordinates (RA/Dec) to horizontal coordinates (azimuth/altitude) via `Horizon()`
4. Checks whether the azimuth falls within one of the configured viewing windows **and** the altitude is above the minimum threshold

Azimuth convention: 0° = North, 90° = East, 180° = South, 270° = West.

### Viewing window check

Windows without a measured horizon are a centre azimuth plus a half-width. The signed angular difference between the object's azimuth and the window centre is computed with wraparound handling:

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
├── LICENSE             # MIT
├── THIRD-PARTY-NOTICES.txt  # Licence notices, published with the app
├── src/
│   ├── main.ts         # Glue: tabs, time model, controls
│   ├── astro.ts        # Bodies, windows, night spans, fixed-star rotation
│   ├── catalog.ts      # Typed arrays built from the catalog JSON
│   ├── config.ts       # Settings, versioned migration, localStorage
│   ├── leaf.ts         # Leaf season by latitude (pure)
│   ├── location.ts     # Coordinates, place search, elevation
│   ├── transfer.ts     # Import / export validation
│   ├── format.ts       # Time / moon-phase formatting
│   ├── state.ts        # Shared night offset
│   ├── weather.ts      # Open-Meteo cloud forecast + cache
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

### Type checking

`bunx tsc --noEmit` (or `bun run typecheck`) type-checks `src/` and `scripts/`.
