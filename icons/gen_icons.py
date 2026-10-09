#!/usr/bin/env python3
"""Regenerate app icons (PIL required). Usage: python3 gen_icons.py"""
from PIL import Image, ImageDraw
import os

def draw_icon(size, out_path):
    BG = (60, 80, 102, 255)
    ACCENT = (240, 140, 0, 255)
    WHITE = (255, 255, 255, 255)

    radius = int(size * 0.22)
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([(0, 0), (size, size)], radius=radius, fill=BG)

    pad = size * 0.13
    w = h = size - 2 * pad
    points = [
        (pad + 0.00 * w, pad + 0.85 * h),
        (pad + 0.16 * w, pad + 0.55 * h),
        (pad + 0.32 * w, pad + 0.65 * h),
        (pad + 0.50 * w, pad + 0.40 * h),
        (pad + 0.68 * w, pad + 0.48 * h),
        (pad + 0.84 * w, pad + 0.18 * h),
        (pad + 1.00 * w, pad + 0.25 * h),
    ]
    line_w = max(2, int(size * 0.04))
    for i in range(len(points) - 1):
        d.line([points[i], points[i + 1]], fill=WHITE, width=line_w)

    dot_r = max(2, int(size * 0.025))
    for p in points[:-1]:
        d.ellipse([(p[0] - dot_r, p[1] - dot_r), (p[0] + dot_r, p[1] + dot_r)], fill=WHITE)
    last = points[-1]
    big_r = max(3, int(size * 0.045))
    d.ellipse([(last[0] - big_r, last[1] - big_r), (last[0] + big_r, last[1] + big_r)], fill=ACCENT)

    img.save(out_path, 'PNG')
    print(f'wrote {out_path} ({size}x{size})')

ROOT = os.path.dirname(os.path.abspath(__file__))
for size, name in [(180, 'apple-touch-icon.png'), (192, 'icon-192.png'), (512, 'icon-512.png'), (1024, 'icon-1024.png')]:
    draw_icon(size, os.path.join(ROOT, name))
