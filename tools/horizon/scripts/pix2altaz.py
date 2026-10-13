#!/usr/bin/env python3
"""Pixel -> Alt/Az for the balcony in Bonn-Beuel at the photo time.

Usage:  pix2altaz.py A.wcs X Y [X Y ...] [--time 2026-10-11T20:30:00]   (time in UTC)
Site: lat 50.74 N, lon 7.12 E, 60 m. Default time 2026-10-11 20:30 UTC (22:30 CEST, +-5 min).
No atmospheric refraction (pressure=0): geometric altitude. J2000 RA/Dec treated as ICRS
(precession/nutation handled by astropy's ICRS->AltAz). Azimuth: N=0, E=90, S=180 (deg).
Same pixel convention as pix2radec.py. Importable: pixels_to_altaz(wcs, x, y, time).
"""
import sys, numpy as np, warnings
warnings.filterwarnings("ignore")
import astropy.units as u
from astropy.coordinates import SkyCoord, EarthLocation, AltAz
from astropy.time import Time
from pix2radec import load, pix2radec
SITE = EarthLocation(lat=50.74*u.deg, lon=7.12*u.deg, height=60*u.m)
DEFAULT_TIME = "2026-10-11T20:30:00"

def radec_to_altaz(ra, dec, time=DEFAULT_TIME):
    fr = AltAz(obstime=Time(time, scale="utc"), location=SITE)  # pressure 0 -> no refraction
    c = SkyCoord(np.atleast_1d(ra)*u.deg, np.atleast_1d(dec)*u.deg, frame="icrs").transform_to(fr)
    return c.alt.deg, c.az.deg

def pixels_to_altaz(wcs, x, y, time=DEFAULT_TIME):
    ra, dec = pix2radec(wcs, x, y)
    return radec_to_altaz(ra, dec, time)

if __name__ == "__main__":
    a = sys.argv[1:]; t = DEFAULT_TIME
    if "--time" in a:
        i = a.index("--time"); t = a[i+1]; del a[i:i+2]
    w = load(a[0]); v = [float(s) for q in a[1:] for s in q.split(",")]
    for x, y in zip(v[::2], v[1::2]):
        alt, az = pixels_to_altaz(w, x, y, t)
        print(f"x={x:.1f} y={y:.1f}  alt={alt[0]:+.2f} az={az[0]:.2f}")
