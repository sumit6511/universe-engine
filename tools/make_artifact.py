#!/usr/bin/env python3
"""
Turn the Vite production build (dist/) into a publishable single-page bundle (artifact/):
a page fragment with inlined CSS plus the script, data and texture files it loads by
relative URL.  Also writes artifact/files.json, the published-path -> source-path map.
"""
import json, os, re, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')
OUT = os.path.join(ROOT, 'artifact')

html = open(os.path.join(DIST, 'index.html'), encoding='utf-8').read()
css_href = re.search(r'<link rel="stylesheet"[^>]*href="\./(assets/[^"]+\.css)"', html).group(1)
css = open(os.path.join(DIST, css_href), encoding='utf-8').read()
title = re.search(r'<title>.*?</title>', html, re.S).group(0)
fonts = re.search(r'<link rel="stylesheet" href="https://fonts\.googleapis\.com[^>]+>', html).group(0)
body = re.search(r'<body>(.*)</body>', html, re.S).group(1)
script = re.search(r'<script type="module"[^>]*src="\./(assets/[^"]+)"></script>', html).group(1)
body = re.sub(r'<script type="module".*?</script>', '', body, flags=re.S).strip()

page = f'''{title}
<meta name="claude:viewport-fit-sides" content="cover">
{fonts}
<style>
{css}
</style>
{body}
<script type="module" src="{script}"></script>
'''
shutil.rmtree(OUT, ignore_errors=True)
os.makedirs(OUT)
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(page)
files = {}
for sub in ('assets', 'data', 'textures'):
    for fn in sorted(os.listdir(os.path.join(DIST, sub))):
        if fn.endswith('.css'):
            continue
        files[f'{sub}/{fn}'] = f'dist/{sub}/{fn}'
json.dump(files, open(os.path.join(OUT, 'files.json'), 'w'), indent=1)
total = sum(os.path.getsize(os.path.join(ROOT, p)) for p in files.values())
print(f'artifact/index.html {len(page) / 1024:.1f} kB, {len(files)} supporting files, {total / 1e6:.1f} MB')
