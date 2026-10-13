#!/usr/bin/env python3
"""Pixel -> RA/Dec (J2000, degrees) using an astrometry.net WCS file (TAN-SIP).

Usage:  pix2radec.py A.wcs X Y [X Y ...]      (or pairs "x,y")
        pix2radec.py A.wcs -                  (read "x y" lines from stdin)
Pixel convention: full-image pixels, 0-based, origin at the centre of the
top-left pixel (as numpy/PIL), y pointing DOWN. Image is 1932 wide x 2576 high.
Run with the scratchpad venv: venv/bin/python pix2radec.py ...
Importable: from pix2radec import load, pix2radec
"""
import sys, numpy as np
from astropy.io import fits
from astropy.wcs import WCS
import warnings; warnings.filterwarnings("ignore")

def load(path):
    return WCS(fits.getheader(path))

def pix2radec(wcs, x, y):
    ra, dec = wcs.all_pix2world(np.atleast_1d(x), np.atleast_1d(y), 0)  # 0 = zero-based
    return ra % 360, dec

def radec2pix(wcs, ra, dec):
    return wcs.all_world2pix(np.atleast_1d(ra), np.atleast_1d(dec), 0, quiet=True, maxiter=40)

if __name__ == "__main__":
    w = load(sys.argv[1]); a = sys.argv[2:]
    if a == ["-"]:
        pts = [tuple(map(float, l.split()[:2])) for l in sys.stdin if l.strip()]
    else:
        v = [float(t) for s in a for t in s.split(",")]
        pts = list(zip(v[::2], v[1::2]))
    for x, y in pts:
        ra, dec = pix2radec(w, x, y)
        print(f"x={x:.1f} y={y:.1f}  RA={ra[0]:.5f} deg ({ra[0]/15:.4f} h)  Dec={dec[0]:+.5f} deg")
