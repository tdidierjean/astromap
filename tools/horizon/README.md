# Measuring window horizons from phone photos

How the horizon profiles in `src/data/horizon-south.ts` and `src/data/horizon-north.ts`
were made, what worked, what didn't, and what to fix to make it repeatable.
First done 2026-10-11/12, on the Raspberry Pi, in a Claude Code session.

## Idea

A night photo through the window contains both the obstructions (roofs, trees, walls)
and stars. Plate-solving the stars gives a pixel → RA/Dec mapping (a WCS). Combined with
the capture time and the observer location, any pixel converts to altitude/azimuth.
Tracing the top edge of each obstruction in pixels then gives the horizon profile
(az, alt) directly, with no compass or tilt sensor involved.

Accuracy: ~1–2° in the middle of the frame, worse in the outer ~10% (lens distortion fit).
The south conifer, measured independently from two photos taken a day apart (B and S4),
agreed to within ~1°.

## Pipeline

```
photo + capture time
  │ 1. mask non-sky (buildings, lit trees, walls, contrails, fingers)
  │ 2. extract star centroids (numpy/scipy) → X,Y,FLUX table (FITS)
  │ 3. solve-field (astrometry.net, local) → WCS (TAN-SIP)
  │ 4. check: overlay named stars + alt/az grid on the photo, eyeball it
  │ 5. trace obstruction top edges in pixels (by hand, on the overlay)
  │ 6. pixel → RA/Dec (WCS) → alt/az (astropy, time + site)
  ▼
profile points (az, alt, kind) → src/data/horizon-*.ts
```

Site: lat 50.74 N, lon 7.12 E, elevation 60 m. Altitudes are geometric (no refraction).
Azimuth: N=0, E=90, S=180.

## What's in this folder

| Path | What |
|---|---|
| `photos/` | Original photos, **gitignored**; they show the home, keep local only. Filenames carry capture time (UTC) and window. |
| `wcs/*.wcs` | Plate solutions for the 5 photos that solved (FITS headers only, no image data). |
| `traces.py` | The hand-picked obstruction points for every photo, plus the conversion to alt/az. Re-run it to regenerate `traces.csv`. |
| `traces.csv` | Output: photo, time, label, kind, full-res pixel, alt, az. |
| `scripts/` | Snapshot of the one-off scripts used in the session (see below). **Not cleaned up**: hardcoded scratchpad and upload paths. |

### Photos

| Id | Window | Time (UTC) | Camera | Result |
|---|---|---|---|---|
| A | South (SE, Saturn in frame) | 2026-10-11 20:30 | 1×, portrait | solved, 63 stars |
| B | South (SSW) | 2026-10-11 20:30 | 1×, portrait | solved, 108 stars |
| N3 | North (NE, facade + own wall) | 2026-10-12 19:35 | 1×, portrait | solved, 75 stars |
| N4 | North (NW→NNE, Big Dipper) | 2026-10-12 20:00 | 1×, landscape | solved, 25 stars |
| S4 | South (S/SSE gap) | 2026-10-12 20:00 | 1×, portrait | solved, 21 stars |
| N1 | North (W side) | ~19:35 | twilight | **failed** |
| N2 | North (wide) | ~19:35 | 0.5× ultra-wide, finger in frame | **failed** |
| S3 | South (SSE) | ~19:41 | 0.5× ultra-wide, few stars | **failed** |

All solved photos: ~0.029–0.032°/px, field ~56×71°, 3rd-order SIP distortion.

### Scripts (snapshot)

- `env.sh`, `astrometry.cfg`: point at a rootless astrometry.net install (below).
- `extract.py` (A/B), `extractN.py` (N1–N3, S3), `extractN4.py`, `extractX.py` (generic: image, name, mask polygon):
  star extraction with background subtraction, a robust noise estimate and local-maximum
  peaks inside a hand-drawn sky polygon, then centroiding. `extractX.py` uses a local
  noise map, which copes with contrails.
- `solve.sh`: `solve-field` wrapper (`--objs`, scale range, tweak order, optional `EXTRA` hint).
- `pix2radec.py`, `pix2altaz.py`: conversion helpers, importable. **`pix2altaz.py` defaults
  to the A/B time; always pass `--time` (UTC).**
- `annot.py`, `annot2.py`: overlays (named stars, RA/Dec and alt/az grids, Saturn check).

## Setup used (Pi, no sudo)

`sudo` needs a password on the Pi, so astrometry.net was installed rootless into a prefix:

```sh
apt-get download astrometry.net libastrometry0t64 python3-astrometry \
  astrometry-data-tycho2-10-19 astrometry-data-tycho2-10-19-littleendian \
  libcfitsio10t64 libgsl28 libgslcblas0 libwcs8 netpbm libnetpbm11t64
for d in *.deb; do dpkg -x "$d" prefix/; done
# env.sh: PATH, LD_LIBRARY_PATH (prefix/usr/lib/aarch64-linux-gnu), PYTHONPATH
# astrometry.cfg: add_path prefix/usr/share/astrometry ; autoindex ; cpulimit 300
python3 -m venv venv && venv/bin/pip install numpy scipy astropy pillow
```

The real index files are in the `-littleendian` package. The plain `tycho2-10-19` package
is only a stub. Indexes 10–19 cover 60′–2000′ quads, which is right for ~60° phone fields.

## Lessons learned

**Taking the photos**
- Full darkness, night mode at the longest exposure, phone braced, **1× main camera**.
  Every photo taken in twilight or with the 0.5× ultra-wide failed. Extra width doesn't help
  if the stars are too faint to detect.
- Put the obstructions in the bottom third and keep as much sky as possible above them.
- Overlap neighbouring shots; gaps between photos end up as "estimated" segments.
- Keep fingers out of the frame. Contrails are OK if masked (or handled by `extractX.py`).
- Note the capture time to the minute. **Chat uploads strip EXIF** (time, GPS, heading).
  ±5 min of time error shifts az/alt by up to ~1.25°.

**Solving**
- Mask non-sky regions before extraction. Lit foliage and windows produce lots of false
  "stars" that swamp the solver.
- Feed `solve-field` a pre-extracted X/Y/FLUX table (`--x-column X --y-column Y
  --sort-column FLUX --width W --height H`) rather than the JPEG.
- Use `--scale-units degwidth --scale-low 30 --scale-high 110` (130 for wide/landscape),
  `--crpix-center`, `--tweak-order 3` (phone lenses need the SIP distortion terms).
- `--objs 150` was needed; `--objs 60` failed even on a good photo.
- For sparse photos, a position hint helps a lot: `--ra .. --dec .. --radius 45`.
  Guess it from the window direction, the time and the photo's tilt.
- Landscape photos: pass the true width/height. The WCS is in full-image pixels
  (0-based in the Python helpers, y down).
- **Run one solve at a time on the Pi.** Parallel attempts plus pure-Python per-pixel
  loops pushed the load to ~15 and made everything crawl. Vectorise extraction with
  numpy/scipy.
- Verify every solution visually: catalogue stars should sit on detected stars (median
  offset was ~2 px), and the alt 0 line should fall at the distant rooflines.
  Bright planets aren't in the index, but their predicted position is a good extra check
  (Saturn was ~26 px / ~0.8° off near the frame edge in A).

**Tracing and modelling**
- Tracing was done by eye on the alt/az overlay, picking points along each obstruction's top
  edge and labelling them building / tree / conifer / wall. That's in `traces.py`.
- Deciduous trees get a "leafless fallback" altitude: the roofline behind them, used from
  ~10 Nov to ~25 Apr (Auto mode in the app).
- Side walls are modelled as vertical edges (constant azimuth). The north window's own
  wall actually leans in the photo (az 83.5° at alt 22° → 99° at alt 64°). It's modelled
  conservatively at 84°.
- The north window wraps through 0° (az 300 → 84). Every az comparison must handle the seam.
- Still estimated: North 300–309° (beyond photo N4) and 19–31° (between N4 and N3).
  The east lean of the north wall isn't modelled.

## To make it reproducible (TODO)

1. **One install script.** Turn the rootless setup into `setup.sh` that builds `prefix/`
   and the venv in a fixed location (e.g. `~/.local/share/astromap-solve/`), not the
   session scratchpad.
2. **One extractor.** Merge the four `extract*.py` into a single CLI:
   `extract.py photo.jpg --mask mask.json --out name_xy.fits`, using `extractX.py`'s
   local-noise approach. Mask polygons go in a JSON file per photo, in full-res pixels
   (the snapshots use 1/3-scale coordinates).
3. **A manifest.** `photos.yaml` holding photo file, window, UTC time, mask, solve hints
   and result. Then a `solve_all.py` that runs extract → solve → overlay sequentially,
   from the manifest.
4. **Tracing.** Store traces per photo in full-res pixels (not display-scaled) in the
   manifest or a JSON file. Optionally add a small HTML tool that shows the photo and
   lets you click along edges, exporting the points.
5. **Profile generation.** Have a script turn `traces.csv` into `src/data/horizon-*.ts`
   (sort by az, merge photos, flag gaps as estimated, attach leafless fallbacks), instead
   of hand-editing.
6. **Automatic time check.** Fit the capture time from vertical building edges (they
   should map to constant azimuth). That removes the need for the user's time when EXIF
   is lost.
7. **Leaning edges.** Model wall edges as az(alt) polylines instead of a single azimuth.
