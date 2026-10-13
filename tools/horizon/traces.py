#!/usr/bin/env python3
"""Obstruction traces picked by hand on the solved photos -> alt/az.

Each trace is a list of (x, y) points along the top edge of an obstruction,
picked visually on a 0.776x downscaled view of the photo (2000 px on the long
side); they are scaled by SCALE to full-resolution pixels before conversion.
Writes traces.csv next to this file. The values in src/data/horizon-*.ts were
derived from these (with light hand-editing: rounding, joining segments,
interpolating short gaps, leafless fallbacks).

Run:  <venv>/bin/python traces.py      (needs astropy; scripts/ on sys.path)
"""
import csv, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "scripts"))
from pix2radec import load
from pix2altaz import pixels_to_altaz

SCALE = 1.29  # downscaled-view px -> full-res px

# photo id -> (wcs file, UTC time)
PHOTOS = {
    "A":  ("A.wcs",  "2026-10-11T20:30:00"),
    "B":  ("B.wcs",  "2026-10-11T20:30:00"),
    "N3": ("N3.wcs", "2026-10-12T19:35:00"),
    "N4": ("N4.wcs", "2026-10-12T20:00:00"),
    "S4": ("S4.wcs", "2026-10-12T20:00:00"),
}

# (photo, label, kind, [(x, y), ...]) in downscaled-view pixels
TRACES = [
    # South, photo A (SE)
    ("A", "east wall edge", "wall", [(150, 700), (100, 1000)]),
    ("A", "red building", "building", [(130, 1260)]),
    ("A", "tree #1", "tree", [(140, 1500), (300, 1440), (400, 1385), (600, 1440), (680, 1470), (780, 1590), (860, 1840)]),
    ("A", "roofs", "building", [(900, 1835), (1160, 1640), (1300, 1650), (1500, 1700)]),
    # South, photo B (SSW)
    ("B", "conifer", "conifer", [(2, 1380), (150, 1235), (250, 1400), (300, 1600)]),
    ("B", "roofs", "building", [(400, 1680), (600, 1640), (720, 1660), (760, 1560)]),
    ("B", "tree #2", "tree", [(880, 1100), (1000, 1080), (1200, 1060), (1350, 1070), (1495, 1100)]),
    ("B", "west wall edge", "wall", [(1310, 330), (1400, 650), (1495, 900)]),
    # South, photo S4 (S/SSE) - fills the 147-175 gap left by A+B
    ("S4", "roofs left", "building", [(5, 1780), (100, 1770), (200, 1860)]),
    ("S4", "white house roof", "building", [(215, 1875), (500, 1875), (830, 1875)]),
    ("S4", "tree #3", "tree", [(470, 1840), (470, 1700), (520, 1600), (600, 1540), (650, 1515), (720, 1560), (780, 1650), (800, 1760)]),
    ("S4", "birch", "tree", [(830, 1700), (880, 1640), (920, 1630), (960, 1640)]),
    ("S4", "conifer", "conifer", [(980, 1560), (1015, 1495), (1080, 1530), (1150, 1620), (1200, 1700), (1250, 1850)]),
    ("S4", "roofs right", "building", [(1330, 1920), (1440, 1975)]),
    # North, photo N4 (NW-N-NNE, landscape)
    ("N4", "building left", "building", [(0, 1065), (100, 1080), (170, 1120), (280, 1130)]),
    ("N4", "conifer", "conifer", [(350, 1050), (420, 960), (465, 905), (500, 980)]),
    ("N4", "birch + trees", "tree", [(520, 1000), (600, 960), (700, 1030), (750, 1110), (740, 1200), (770, 1260), (800, 1300)]),
    ("N4", "low roofs", "building", [(850, 1360), (1000, 1380)]),
    ("N4", "trees", "tree", [(1050, 1340), (1140, 1250), (1240, 1240), (1275, 1290)]),
    ("N4", "roofs + building right", "building", [(1300, 1390), (1450, 1395), (1560, 1370), (1700, 1330), (1840, 1240), (1950, 1200), (1999, 1180)]),
    # North, photo N3 (NE)
    ("N3", "facade + chimneys", "building", [(0, 1590), (190, 1525), (230, 1490), (330, 1495), (450, 1450), (700, 1450), (780, 1370), (1000, 1380), (1080, 1340), (1250, 1320), (1340, 1310)]),
    ("N3", "east wall edge (leans)", "wall", [(1180, 0), (1290, 700), (1340, 1100), (1360, 1230)]),
]

def main():
    out = os.path.join(HERE, "traces.csv")
    wcs = {p: load(os.path.join(HERE, "wcs", f)) for p, (f, _) in PHOTOS.items()}
    with open(out, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["photo", "time_utc", "label", "kind", "x_full", "y_full", "alt_deg", "az_deg"])
        for photo, label, kind, pts in TRACES:
            t = PHOTOS[photo][1]
            for x, y in pts:
                X, Y = round(x * SCALE), round(y * SCALE)
                alt, az = pixels_to_altaz(wcs[photo], X, Y, t)
                w.writerow([photo, t, label, kind, X, Y, f"{alt[0]:.2f}", f"{az[0]:.2f}"])
    print("wrote", out)

if __name__ == "__main__":
    main()
