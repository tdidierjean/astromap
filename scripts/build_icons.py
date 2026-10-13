#!/usr/bin/env python3
"""Regenerate icons/*.png from the SVG sources using Playwright/Chromium.
Usage: python3 scripts/build_icons.py   (run from anywhere)"""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent / 'icons'
jobs = [('icon.svg', 'apple-touch-icon.png', 180), ('icon.svg', 'icon-192.png', 192),
        ('icon.svg', 'icon-512.png', 512), ('icon-maskable.svg', 'icon-maskable-512.png', 512)]
with sync_playwright() as p:
    b = p.chromium.launch()
    for src, out, size in jobs:
        pg = b.new_page(viewport={'width': size, 'height': size})
        svg = (root / src).read_text()
        pg.set_content(f'<body style="margin:0">{svg.replace("width=\"512\" height=\"512\"", f"width=\"{size}\" height=\"{size}\"", 1)}</body>')
        pg.screenshot(path=str(root / out), omit_background=False)
        pg.close()
        print('wrote', out)
    b.close()
