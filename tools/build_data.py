#!/usr/bin/env python3
"""
Universe Engine data pipeline.

Turns the raw public catalogues in data-raw/ into the compact binary/JSON
assets the engine loads from public/data/ and public/textures/.

All positions are written in the engine's render frame:
    heliocentric, J2000 ecliptic axes, right-handed Y-up
    (X = ecliptic x / vernal equinox, Y = ecliptic north, Z = -ecliptic y)

Sources (see README for licences):
    hyg_v41.csv       HYG 4.1 star database (CC BY-SA 4.0)
    NGC.csv           OpenNGC (CC BY-SA 4.0)
    pscomp.csv        NASA Exoplanet Archive, Planetary Systems Composite
    const_*.json      d3-celestial constellation figures (BSD-3)
    sb_*.json         JPL Small-Body Database
    tex/*             Solar System Scope (CC BY 4.0) and NASA/JPL mosaics
"""
import csv, json, math, os, struct, sys, hashlib
from array import array

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'data-raw')
OUT = os.path.join(ROOT, 'public', 'data')
TEX = os.path.join(ROOT, 'public', 'textures')
os.makedirs(OUT, exist_ok=True)
os.makedirs(TEX, exist_ok=True)

EPS = math.radians(23.4392911)          # J2000 mean obliquity
CE, SE = math.cos(EPS), math.sin(EPS)
C_KMS = 299792.458

# Planck 2018 (TT,TE,EE+lowE+lensing) flat LCDM
H0 = 67.4
OM = 0.315
OR = 9.18e-5                            # photons + 3 massless-equivalent neutrinos
OL = 1.0 - OM - OR


def eq_to_three(x, y, z):
    """ICRS equatorial cartesian -> engine frame."""
    ye = y * CE + z * SE
    ze = -y * SE + z * CE
    return (x, ze, -ye)


def radec_to_three(ra_deg, dec_deg, d=1.0):
    ra, dec = math.radians(ra_deg), math.radians(dec_deg)
    return eq_to_three(d * math.cos(dec) * math.cos(ra), d * math.cos(dec) * math.sin(ra), d * math.sin(dec))


# Equatorial (ICRS) -> Galactic rotation (Hipparcos, ESA 1997)
A_G = ((-0.0548755604, -0.8734370902, -0.4838350155),
       (0.4941094279, -0.4448296300, 0.7469822445),
       (-0.8676661490, -0.1980763734, 0.4559837762))


def radec_to_gal(ra_deg, dec_deg):
    ra, dec = math.radians(ra_deg), math.radians(dec_deg)
    v = (math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec))
    g = [sum(A_G[i][j] * v[j] for j in range(3)) for i in range(3)]
    return math.atan2(g[1], g[0]), math.asin(max(-1, min(1, g[2])))


def comoving_distance_mpc(z, n=256):
    """Line-of-sight comoving distance, flat LCDM, Simpson's rule."""
    if z <= 0:
        return 0.0
    def invE(zz):
        a = 1 + zz
        return 1.0 / math.sqrt(OR * a ** 4 + OM * a ** 3 + OL)
    h = z / n
    s = invE(0) + invE(z)
    for i in range(1, n):
        s += (4 if i % 2 else 2) * invE(i * h)
    return C_KMS / H0 * s * h / 3


def bv_to_teff(bv):
    """Ballesteros (2012)."""
    return 4600.0 * (1.0 / (0.92 * bv + 1.7) + 1.0 / (0.92 * bv + 0.62))


def teff_to_bv(t):
    lo, hi = -0.4, 2.5
    for _ in range(40):
        mid = 0.5 * (lo + hi)
        if bv_to_teff(mid) > t:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def hash01(s, salt=''):
    h = hashlib.md5((salt + s).encode()).digest()
    return int.from_bytes(h[:4], 'little') / 2 ** 32


def fnum(s, default=None):
    try:
        if s is None or s == '':
            return default
        return float(s)
    except ValueError:
        return default


# ----------------------------------------------------------------------------
# Stars
# ----------------------------------------------------------------------------
SPECT_CI = {'O': -0.30, 'B': -0.15, 'A': 0.10, 'F': 0.45, 'G': 0.65, 'K': 1.05, 'M': 1.50, 'W': -0.25, 'C': 1.8, 'S': 1.7, 'N': 1.8, 'R': 1.3}


def build_stars():
    stars = []
    with open(os.path.join(RAW, 'hyg_v41.csv'), newline='', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            dist = fnum(r['dist'])
            if dist is None or dist >= 99999:
                continue                              # no usable parallax
            mag = fnum(r['mag'])
            absmag = fnum(r['absmag'])
            if mag is None or absmag is None:
                continue
            ci = fnum(r['ci'])
            sp = (r['spect'] or '').strip()
            if ci is None:
                ci = SPECT_CI.get(sp[:1].upper(), 0.6)
            ci = max(-0.4, min(2.5, ci))
            x, y, z = eq_to_three(float(r['x']), float(r['y']), float(r['z']))
            vx, vy, vz = eq_to_three(fnum(r['vx'], 0.0), fnum(r['vy'], 0.0), fnum(r['vz'], 0.0))
            bf = ''
            if r['bayer'] or r['flam']:
                bf = ((r['flam'] + ' ') if r['flam'] and not r['bayer'] else '') + (r['bayer'] or '') + ' ' + (r['con'] or '')
                bf = bf.strip()
            stars.append(dict(x=x, y=y, z=z, vx=vx, vy=vy, vz=vz, absmag=absmag, ci=ci, mag=mag,
                              hip=int(r['hip']) if r['hip'] else 0, hd=int(r['hd']) if r['hd'] else 0,
                              proper=r['proper'].strip(), bf=bf, spect=sp, gl=r['gl'].strip(),
                              ra=float(r['ra']) * 15.0, dec=float(r['dec']), dist=dist, con=r['con']))
    return stars


# ----------------------------------------------------------------------------
# Exoplanets
# ----------------------------------------------------------------------------
def build_exoplanets(stars):
    hosts = {}
    with open(os.path.join(RAW, 'pscomp.csv'), newline='', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            d = fnum(r['sy_dist'])
            ra, dec = fnum(r['ra']), fnum(r['dec'])
            if d is None or ra is None or dec is None or d <= 0:
                continue
            h = hosts.setdefault(r['hostname'], dict(name=r['hostname'], hip=r['hip_name'], ra=ra, dec=dec, dist=d,
                                                     teff=fnum(r['st_teff']), rad=fnum(r['st_rad']), mass=fnum(r['st_mass']),
                                                     vmag=fnum(r['sy_vmag']), spect=r['st_spectype'], planets=[]))
            mstar = h['mass'] or 1.0
            per = fnum(r['pl_orbper'])
            sma = fnum(r['pl_orbsmax'])
            est = 0
            if sma is None and per is not None:
                sma = (mstar * (per / 365.25) ** 2) ** (1 / 3)       # Kepler III
                est |= 1
            if per is None and sma is not None:
                per = 365.25 * math.sqrt(sma ** 3 / mstar)
                est |= 1
            if sma is None or per is None:
                continue
            rade = fnum(r['pl_rade'])
            masse = fnum(r['pl_bmasse'])
            if rade is None:
                if masse is None:
                    continue
                # simple broken power-law mass-radius relation (after Chen & Kipping 2017)
                rade = masse ** 0.279 if masse < 2.04 else (1.008 * 2.04 ** 0.279 * (masse / 2.04) ** 0.589 if masse < 132 else 11.2)
                rade = min(rade, 14.0)
                est |= 2
            letter = r['pl_name'][len(r['hostname']):].strip() or r['pl_name']
            h['planets'].append([letter, round(per, 5), round(sma, 5), round(rade, 3),
                                 None if masse is None else round(masse, 3), round(fnum(r['pl_orbeccen'], 0.0), 4),
                                 fnum(r['pl_orbincl']), fnum(r['pl_eqt']),
                                 r['discoverymethod'], int(r['disc_year']) if r['disc_year'] else None, est])
    hosts = {k: v for k, v in hosts.items() if v['planets']}

    # match hosts to HYG stars: by HIP id, else by sky position + distance
    by_hip = {s['hip']: i for i, s in enumerate(stars) if s['hip']}
    grid = {}
    for i, s in enumerate(stars):
        grid.setdefault((int(s['ra'] * 4), int((s['dec'] + 90) * 4)), []).append(i)
    matched = 0
    for h in hosts.values():
        idx = None
        if h['hip'].startswith('HIP'):
            try:
                idx = by_hip.get(int(h['hip'].split()[1]))
            except (ValueError, IndexError):
                idx = None
        if idx is None:
            cx, cy = int(h['ra'] * 4), int((h['dec'] + 90) * 4)
            best = 1e9
            cd = math.cos(math.radians(h['dec']))
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for i in grid.get((cx + dx, cy + dy), ()):
                        s = stars[i]
                        sep = math.hypot((s['ra'] - h['ra']) * cd, s['dec'] - h['dec'])
                        if sep < 0.03 and abs(s['dist'] - h['dist']) / h['dist'] < 0.25 and sep < best:
                            best, idx = sep, i
        if idx is not None:
            matched += 1
            h['star'] = idx
        else:
            # host is not in HYG: add it to the catalogue as a new star
            teff = h['teff'] or 5000.0
            if h['vmag'] is not None:
                absmag = h['vmag'] - 5 * math.log10(h['dist'] / 10.0)
            else:
                lum = (h['rad'] or 1.0) ** 2 * (teff / 5772.0) ** 4
                absmag = 4.74 - 2.5 * math.log10(max(lum, 1e-6))
            x, y, z = radec_to_three(h['ra'], h['dec'], h['dist'])
            stars.append(dict(x=x, y=y, z=z, vx=0, vy=0, vz=0, absmag=absmag, ci=teff_to_bv(teff),
                              mag=absmag + 5 * math.log10(h['dist'] / 10.0), hip=0, hd=0, proper='', bf='',
                              spect=h['spect'] or '', gl='', ra=h['ra'], dec=h['dec'], dist=h['dist'], con='', exoname=h['name']))
            h['star'] = len(stars) - 1
    print(f'exoplanets: {sum(len(h["planets"]) for h in hosts.values())} planets, {len(hosts)} hosts, {matched} matched to HYG')
    return hosts


def write_stars(stars, hosts):
    # sort by apparent magnitude from the Sun (brightest first) so prefixes are LODs
    order = sorted(range(len(stars)), key=lambda i: stars[i]['mag'])
    remap = {old: new for new, old in enumerate(order)}
    stars = [stars[i] for i in order]
    buf = array('f')
    for s in stars:
        buf.extend((s['x'], s['y'], s['z'], s['vx'] * 1e6, s['vy'] * 1e6, s['vz'] * 1e6, s['absmag'], s['ci']))
    with open(os.path.join(OUT, 'stars.bin'), 'wb') as f:
        buf.tofile(f)
    hip = array('I', (s['hip'] for s in stars))
    with open(os.path.join(OUT, 'stars_hip.bin'), 'wb') as f:
        hip.tofile(f)
    # metadata: brightest N stars get designation + spectral type; every proper name is kept
    NMETA = 16000
    meta = []
    for i, s in enumerate(stars[:NMETA]):
        meta.append('|'.join((s['proper'], s['bf'], s['spect'], str(s['hd'] or ''))))
    named = [[i, s['proper'], s['spect']] for i, s in enumerate(stars) if i >= NMETA and s['proper']]
    gliese = [[i, s['gl'], s['spect']] for i, s in enumerate(stars) if i >= NMETA and s['gl'] and not s['proper'] and s['dist'] < 12]
    exo = []
    for h in hosts.values():
        exo.append(dict(s=remap[h['star']], n=h['name'], t=h['teff'], r=h['rad'], m=h['mass'], p=h['planets']))
    exo.sort(key=lambda e: e['s'])
    json.dump(dict(count=len(stars), nmeta=NMETA, meta=meta, named=named, gliese=gliese), open(os.path.join(OUT, 'stars_meta.json'), 'w'),
              separators=(',', ':'), ensure_ascii=False)
    json.dump(exo, open(os.path.join(OUT, 'exoplanets.json'), 'w'), separators=(',', ':'), ensure_ascii=False)
    print(f'stars: {len(stars)} written, {sum(1 for s in stars if s["proper"])} with proper names')
    return stars


# ----------------------------------------------------------------------------
# Constellation figures -> pairs of star indices
# ----------------------------------------------------------------------------
def build_constellations(stars):
    bright = [(i, s) for i, s in enumerate(stars[:12000]) if s['dist'] > 0 and 'exoname' not in s]
    grid = {}
    for i, s in bright:
        grid.setdefault((int(s['ra'] / 2), int((s['dec'] + 90) / 2)), []).append(i)

    def nearest(ra, dec):
        ra %= 360.0
        cd = max(0.05, math.cos(math.radians(dec)))
        best, bi = 1e9, None
        span = int(1.5 / cd / 2) + 1
        for dx in range(-span, span + 1):
            for dy in (-1, 0, 1):
                for i in grid.get((int(ra / 2 + dx) % 180, int((dec + 90) / 2) + dy), ()):
                    s = stars[i]
                    dra = (s['ra'] - ra + 180) % 360 - 180
                    sep = math.hypot(dra * cd, s['dec'] - dec) + 0.02 * max(0, s['mag'] - 3)
                    if sep < best:
                        best, bi = sep, i
        return bi if best < 1.2 else None

    lines = json.load(open(os.path.join(RAW, 'const_lines.json')))
    pairs = []
    for feat in lines['features']:
        for seg in feat['geometry']['coordinates']:
            idx = [nearest(p[0], p[1]) for p in seg]
            for a, b in zip(idx, idx[1:]):
                if a is not None and b is not None and a != b:
                    pairs.extend((a, b))
    names = json.load(open(os.path.join(RAW, 'const_names.json')))
    labels = []
    for feat in names['features']:
        p = feat['properties']
        ra, dec = p['display'][0] % 360.0, p['display'][1]
        labels.append([p['name'], *[round(v, 4) for v in radec_to_three(ra, dec)]])
    json.dump(dict(lines=pairs, labels=labels), open(os.path.join(OUT, 'constellations.json'), 'w'), separators=(',', ':'))
    print(f'constellations: {len(pairs) // 2} segments, {len(labels)} labels')


# ----------------------------------------------------------------------------
# Galaxies
# ----------------------------------------------------------------------------
# Redshift-independent distances (Mpc) for nearby galaxies, where peculiar
# velocities make Hubble-law distances meaningless. Values are representative
# literature distances (TRGB / Cepheid / SBF).
DIST_OVERRIDE = {
    'NGC0224': 0.765, 'NGC0598': 0.86, 'NGC0221': 0.79, 'NGC0205': 0.82, 'NGC0147': 0.73, 'NGC0185': 0.62,
    'NGC0292': 0.0624, 'NGC6822': 0.50, 'IC1613': 0.75, 'IC0010': 0.79, 'NGC3109': 1.30, 'NGC0300': 2.0, 'NGC0055': 2.0,
    'NGC0253': 3.5, 'NGC0247': 3.6, 'NGC7793': 3.6, 'NGC3031': 3.6, 'NGC3034': 3.5, 'NGC2403': 3.2, 'NGC2976': 3.6,
    'NGC3077': 3.8, 'IC0342': 3.3, 'NGC1569': 3.2, 'NGC5128': 3.8, 'NGC4945': 3.7, 'NGC5236': 4.9, 'NGC5253': 3.6,
    'NGC4736': 4.7, 'NGC4826': 5.3, 'NGC4449': 4.0, 'NGC4214': 2.9, 'NGC4244': 4.3, 'NGC4395': 4.5, 'NGC5457': 6.7,
    'NGC5194': 8.6, 'NGC5195': 8.6, 'NGC5055': 8.9, 'NGC4258': 7.6, 'NGC6946': 7.7, 'NGC0628': 9.8, 'NGC3627': 10.5,
    'NGC3623': 10.5, 'NGC3628': 10.5, 'NGC3368': 10.7, 'NGC3351': 10.0, 'NGC3379': 10.6, 'NGC4594': 9.6, 'NGC1068': 13.5,
    'NGC0891': 9.8, 'NGC2903': 9.2, 'NGC2841': 14.1, 'NGC3521': 11.0, 'NGC7331': 14.0, 'NGC1313': 4.3, 'NGC4565': 11.9,
    'NGC4631': 7.4, 'NGC4486': 16.8, 'NGC4472': 16.7, 'NGC4374': 17.0, 'NGC4406': 16.8, 'NGC4649': 16.5, 'NGC4321': 16.0,
    'NGC4254': 15.0, 'NGC4501': 17.0, 'NGC4569': 16.8, 'NGC4382': 17.0, 'NGC4303': 16.0, 'NGC6744': 9.4, 'NGC1316': 20.8,
    'NGC1365': 18.6, 'NGC1399': 20.0, 'NGC4038': 22.0, 'NGC4039': 22.0, 'NGC1097': 14.5, 'NGC2997': 12.0, 'NGC5866': 15.0,
    'NGC3556': 14.0, 'NGC1291': 9.0, 'NGC2683': 9.0, 'NGC1023': 10.4, 'NGC0925': 9.2, 'NGC4490': 8.0, 'NGC4725': 12.4,
    'NGC4559': 8.9, 'NGC3115': 9.7, 'NGC0404': 3.1, 'NGC1560': 3.3, 'NGC2366': 3.3, 'NGC4236': 4.4, 'NGC5102': 3.7,
    'NGC5204': 4.6, 'NGC5474': 6.8, 'NGC5585': 7.8, 'NGC6503': 6.3, 'NGC0045': 6.6, 'NGC0024': 7.3, 'NGC1705': 5.1,
}

# Galaxies missing from the NGC/IC: (name, RA deg, Dec deg, distance Mpc, diameter kpc, type code, abs mag)
EXTRA_GALAXIES = [
    ('Large Magellanic Cloud', 80.894, -69.756, 0.0497, 9.9, 4, -18.1),
    ('Sagittarius Dwarf Spheroidal', 283.83, -30.55, 0.026, 3.0, 0, -13.5),
    ('Fornax Dwarf', 39.997, -34.449, 0.147, 1.5, 0, -13.4),
    ('Sculptor Dwarf', 15.039, -33.709, 0.086, 1.0, 0, -11.1),
    ('Carina Dwarf', 100.403, -50.966, 0.106, 0.6, 0, -9.1),
    ('Draco Dwarf', 260.052, 57.915, 0.076, 0.6, 0, -8.8),
    ('Ursa Minor Dwarf', 227.285, 67.223, 0.076, 0.6, 0, -8.8),
    ('Sextans Dwarf Spheroidal', 153.263, -1.615, 0.086, 1.0, 0, -9.3),
    ('Leo I', 152.117, 12.307, 0.254, 0.6, 0, -12.0),
    ('Leo II', 168.370, 22.152, 0.233, 0.5, 0, -9.8),
    ('Phoenix Dwarf', 27.776, -44.445, 0.415, 0.5, 4, -9.9),
    ('Wolf-Lundmark-Melotte (WLM)', 0.492, -15.461, 0.93, 2.5, 4, -14.2),
    ('Leo A', 149.860, 30.746, 0.80, 1.2, 4, -12.1),
    ('Sextans A', 152.753, -4.693, 1.43, 2.0, 4, -14.3),
    ('Sextans B', 150.000, 5.332, 1.43, 1.8, 4, -14.5),
    ('Aquarius Dwarf', 311.716, -12.848, 1.07, 0.7, 4, -10.6),
    ('Tucana Dwarf', 340.457, -64.419, 0.89, 0.6, 0, -9.5),
    ('Cetus Dwarf', 6.546, -11.044, 0.775, 1.0, 0, -11.2),
    ('Pegasus Dwarf Irregular', 352.151, 14.743, 0.92, 1.0, 4, -12.2),
    ('Antlia Dwarf', 151.017, -27.332, 1.32, 0.8, 4, -10.4),
    ('Andromeda I', 11.416, 38.041, 0.745, 0.7, 0, -11.7),
    ('Andromeda II', 19.124, 33.419, 0.652, 0.9, 0, -12.4),
    ('Andromeda III', 8.891, 36.498, 0.748, 0.5, 0, -10.0),
    ('Maffei 1', 39.148, 59.655, 3.4, 23.0, 0, -20.8),
    ('Maffei 2', 40.479, 59.604, 3.5, 15.0, 3, -20.2),
    ('Circinus Galaxy', 213.291, -65.339, 4.2, 12.0, 2, -19.8),
    ('Dwingeloo 1', 44.221, 58.911, 3.0, 8.0, 3, -18.8),
]

# Rich clusters: collapse redshift-space "fingers of god" onto the cluster distance.
# (name, RA, Dec, angular radius deg, v_helio min, max [km/s], distance Mpc or None -> from mean redshift, depth sigma Mpc)
CLUSTERS = [
    ('Virgo Cluster', 187.70, 12.39, 8.0, -900, 3000, 16.5, 1.3),
    ('Fornax Cluster', 54.62, -35.45, 3.0, 500, 2500, 20.0, 0.6),
    ('Antlia Cluster', 157.5, -35.3, 1.5, 1200, 4200, None, 0.8),
    ('Centaurus Cluster', 192.2, -41.31, 2.0, 1500, 5500, None, 1.0),
    ('Hydra Cluster', 159.17, -27.52, 1.5, 2000, 5500, None, 1.0),
    ('Norma Cluster', 243.6, -60.9, 1.5, 2500, 7000, 68.0, 1.0),
    ('Perseus Cluster', 49.95, 41.51, 1.5, 3000, 8000, None, 1.2),
    ('Leo Cluster', 176.1, 19.8, 1.2, 4500, 8500, None, 1.2),
    ('Coma Cluster', 194.95, 27.98, 2.0, 4000, 10000, None, 1.5),
    ('Hercules Cluster', 241.3, 17.75, 1.0, 8500, 13500, None, 1.5),
]


def hms_to_deg(s):
    h, m, sec = s.split(':')
    return (float(h) + float(m) / 60 + float(sec) / 3600) * 15.0


def dms_to_deg(s):
    sign = -1 if s.strip().startswith('-') else 1
    d, m, sec = s.strip().lstrip('+-').split(':')
    return sign * (float(d) + float(m) / 60 + float(sec) / 3600)


def angsep(ra1, dec1, ra2, dec2):
    a1, d1, a2, d2 = map(math.radians, (ra1, dec1, ra2, dec2))
    c = math.sin(d1) * math.sin(d2) + math.cos(d1) * math.cos(d2) * math.cos(a1 - a2)
    return math.degrees(math.acos(max(-1, min(1, c))))


def gauss(name, salt):
    u1 = max(1e-9, hash01(name, salt + 'a'))
    u2 = hash01(name, salt + 'b')
    return math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)


def build_galaxies():
    rows = []
    with open(os.path.join(RAW, 'NGC.csv'), newline='', encoding='utf-8') as f:
        for r in csv.DictReader(f, delimiter=';'):
            if r['Type'] != 'G' or not r['RA'] or not r['Dec']:
                continue
            rows.append(r)

    # pass 1: cluster mean redshifts (for clusters without a fixed distance)
    L0, B0, VDIP = math.radians(264.021), math.radians(48.253), 369.82
    cl_members = {c[0]: [] for c in CLUSTERS}
    parsed = []
    for r in rows:
        ra, dec = hms_to_deg(r['RA']), dms_to_deg(r['Dec'])
        v = fnum(r['RadVel'])
        if v is None and fnum(r['Redshift']) is not None:
            v = fnum(r['Redshift']) * C_KMS
        l, b = radec_to_gal(ra, dec)
        vcmb = None if v is None else v + VDIP * (math.sin(b) * math.sin(B0) + math.cos(b) * math.cos(B0) * math.cos(l - L0))
        # Local Group frame (Karachentsev & Makarov 1996)
        vlg = None if v is None else v + 316.0 * (math.sin(b) * math.sin(math.radians(-4)) + math.cos(b) * math.cos(math.radians(-4)) * math.cos(l - math.radians(93)))
        cl = None
        if v is not None:
            for c in CLUSTERS:
                if c[4] <= v <= c[5] and angsep(ra, dec, c[1], c[2]) <= c[3]:
                    cl = c
                    cl_members[c[0]].append(vcmb)
                    break
        parsed.append((r, ra, dec, v, vcmb, vlg, cl))
    cl_dist = {}
    for c in CLUSTERS:
        m = cl_members[c[0]]
        if c[6] is not None:
            cl_dist[c[0]] = c[6]
        elif m:
            cl_dist[c[0]] = comoving_distance_mpc(sum(m) / len(m) / C_KMS)
        print(f'  cluster {c[0]}: {len(m)} members, d = {cl_dist.get(c[0], float("nan")):.1f} Mpc')

    out = []
    stats = dict(override=0, cluster=0, hubble=0, skipped=0)
    for r, ra, dec, v, vcmb, vlg, cl in parsed:
        name = r['Name']
        method = 0
        if name in DIST_OVERRIDE:
            d = DIST_OVERRIDE[name]; method = 2; stats['override'] += 1
        elif cl is not None and cl[0] in cl_dist:
            d = max(0.5, cl_dist[cl[0]] + cl[7] * gauss(name, 'cl')); method = 1; stats['cluster'] += 1
        elif vcmb is not None and vcmb > 600 and vlg is not None and vlg > 250:
            # blend LG-frame velocity nearby into CMB-frame velocity in the Hubble flow
            w = min(1.0, max(0.0, (vcmb - 1500) / 3000))
            d = comoving_distance_mpc(((1 - w) * vlg + w * vcmb) / C_KMS); stats['hubble'] += 1
        else:
            stats['skipped'] += 1
            continue
        maj, mn, pa = fnum(r['MajAx']), fnum(r['MinAx']), fnum(r['PosAng'])
        rad_kpc = 8.0 if maj is None else max(0.4, min(90.0, math.radians(maj / 60.0) * 0.5 * d * 1000.0))
        q = 1.0 if (maj is None or mn is None or maj <= 0) else max(0.08, min(1.0, mn / maj))
        mag = fnum(r['B-Mag'])
        if mag is None:
            mag = fnum(r['V-Mag'])
            mag = None if mag is None else mag + 0.7
        if mag is None and fnum(r['K-Mag']) is not None:
            mag = fnum(r['K-Mag']) + 3.5
        absmag = -19.0 if mag is None else max(-24.5, min(-10.0, mag - 5 * math.log10(d * 1e5)))
        hub = (r['Hubble'] or '').strip()
        if hub.startswith('E') or hub.startswith('cD') or hub.startswith('dE'):
            t = 0
        elif hub.startswith('S0'):
            t = 1
        elif hub.startswith('SB') or hub.startswith('SAB'):
            t = 3
        elif hub.startswith('S'):
            t = 2
        elif hub.startswith('I') or hub.startswith('dI'):
            t = 4
        else:
            t = 2 if q < 0.6 else 0
        # 3D orientation of the disc from axis ratio (Hubble 1926, q0 = 0.2) and position angle
        s_hat = radec_to_three(ra, dec)
        n_hat = radec_to_three(ra + 0.0, dec + 0.0)
        rr, dd = math.radians(ra), math.radians(dec)
        north = eq_to_three(-math.sin(dd) * math.cos(rr), -math.sin(dd) * math.sin(rr), math.cos(dd))
        east = eq_to_three(-math.sin(rr), math.cos(rr), 0.0)
        if pa is None:
            pa = hash01(name, 'pa') * 180.0
        par = math.radians(pa)
        major = [math.cos(par) * north[i] + math.sin(par) * east[i] for i in range(3)]
        minor = [s_hat[1] * major[2] - s_hat[2] * major[1], s_hat[2] * major[0] - s_hat[0] * major[2], s_hat[0] * major[1] - s_hat[1] * major[0]]
        if t in (0,):
            cosi = 1.0
        else:
            q0 = 0.2
            cosi = math.sqrt(max(0.0, (q * q - q0 * q0) / (1 - q0 * q0)))
        sini = math.sqrt(1 - cosi * cosi) * (1 if hash01(name, 'flip') > 0.5 else -1)
        normal = [cosi * s_hat[i] + sini * minor[i] for i in range(3)]
        common = (r['Common names'] or '').split(',')[0].strip()
        label = name[:3].rstrip('0').replace('NGC', 'NGC ').replace('IC', 'IC ') if False else None
        cat = 'NGC' if name.startswith('NGC') else 'IC'
        num = name[len(cat):].lstrip('0')
        disp = f'{cat} {num}'
        mess = f"M{int(r['M'])}" if r['M'] else ''
        pos = [s_hat[i] * d for i in range(3)]
        out.append(dict(pos=pos, normal=normal, major=major, rad=rad_kpc, q=q, absmag=absmag, type=t,
                        name=disp, messier=mess, common=common, hubble=hub, method=method,
                        z=None if v is None else v / C_KMS, seed=hash01(name, 'seed')))
    for (nm, ra, dec, d, diam, t, am) in EXTRA_GALAXIES:
        s_hat = radec_to_three(ra, dec)
        ang = hash01(nm, 'n1') * 6.283
        cz = hash01(nm, 'n2') * 2 - 1
        sz = math.sqrt(1 - cz * cz)
        normal = [sz * math.cos(ang), cz, sz * math.sin(ang)]
        out.append(dict(pos=[s_hat[i] * d for i in range(3)], normal=normal, major=[1, 0, 0], rad=diam / 2, q=0.7, absmag=am,
                        type=t, name=nm, messier='', common='', hubble='', method=2, z=None, seed=hash01(nm, 'seed')))
    out.sort(key=lambda g: g['absmag'])
    buf = array('f')
    for g in out:
        buf.extend((*g['pos'], *g['normal'], g['rad'], g['absmag'], float(g['type']), g['seed'], *g['major'], g['q']))
    with open(os.path.join(OUT, 'galaxies.bin'), 'wb') as f:
        buf.tofile(f)
    meta = [[g['name'], g['messier'], g['common'], g['hubble'], g['method'], None if g['z'] is None else round(g['z'], 6)] for g in out]
    clusters = []
    for c in CLUSTERS:
        if c[0] in cl_dist:
            p = radec_to_three(c[1], c[2], cl_dist[c[0]])
            clusters.append([c[0], *[round(v, 3) for v in p]])
    json.dump(dict(count=len(out), stride=14, meta=meta, clusters=clusters), open(os.path.join(OUT, 'galaxies_meta.json'), 'w'),
              separators=(',', ':'), ensure_ascii=False)
    far = max(math.sqrt(sum(v * v for v in g['pos'])) for g in out)
    print(f'galaxies: {len(out)} written {stats}, most distant {far:.0f} Mpc')


# ----------------------------------------------------------------------------
# Small bodies
# ----------------------------------------------------------------------------
CLASS_CODE = {'MBA': 0, 'IMB': 0, 'OMB': 0, 'MCA': 0, 'HYA': 0, 'AST': 0, 'TJN': 1, 'AMO': 2, 'APO': 2, 'ATE': 2, 'IEO': 2, 'CEN': 3, 'TNO': 4}


def build_small_bodies():
    buf = array('f')
    n = 0
    epoch0 = 2461200.5
    GMS = 0.01720209895 ** 2                         # AU^3/day^2
    for fn in ('sb_inner.json', 'sb_outer.json'):
        d = json.load(open(os.path.join(RAW, fn)))
        for r in d['data']:
            a, e, i, om, w, ma, ep, H, cls = r
            try:
                a, e, i, om, w, ma, ep = map(float, (a, e, i, om, w, ma, ep))
            except (TypeError, ValueError):
                continue
            if not (0 < e < 0.99) or a <= 0:
                continue
            # bring mean anomaly to the common epoch
            nmot = math.sqrt(GMS / a ** 3)
            ma = (math.radians(ma) + nmot * (epoch0 - ep)) % (2 * math.pi)
            buf.extend((a, e, math.radians(i), math.radians(om), math.radians(w), ma,
                        float(CLASS_CODE.get(cls, 0)), float(H) if H else 15.0))
            n += 1
    with open(os.path.join(OUT, 'smallbodies.bin'), 'wb') as f:
        buf.tofile(f)
    named = []
    info = {'Ceres': (469.7, 'dwarf'), 'Vesta': (262.7, 'asteroid'), 'Pluto': (1188.3, 'dwarf'), 'Eris': (1163.0, 'dwarf'),
            'Haumea': (780.0, 'dwarf'), 'Makemake': (715.0, 'dwarf'), 'Sedna': (500.0, 'dwarf'), 'Gonggong': (615.0, 'dwarf'),
            'Quaoar': (545.0, 'dwarf'), '1P': (5.5, 'comet')}
    for key, (rad, kind) in info.items():
        d = json.load(open(os.path.join(RAW, f'sb_{key}.json')))
        el = {e['name']: float(e['value']) for e in d['orbit']['elements'] if e['value'] is not None}
        named.append(dict(name='Halley' if key == '1P' else key, kind=kind, radius=rad, epoch=float(d['orbit']['epoch']),
                          a=el['a'], e=el['e'], i=el['i'], om=el['om'], w=el['w'], ma=el['ma']))
    json.dump(dict(count=n, stride=8, epoch=epoch0, named=named), open(os.path.join(OUT, 'smallbodies.json'), 'w'), separators=(',', ':'))
    print(f'small bodies: {n} orbits, {len(named)} named')


# ----------------------------------------------------------------------------
# Textures
# ----------------------------------------------------------------------------
def build_textures():
    from PIL import Image, ImageFilter
    src = os.path.join(RAW, 'tex')
    jobs = [  # (source, output, width, quality, mode)
        ('2k_earth_daymap.jpg', 'earth_day.jpg', 2048, 84, 'RGB'),
        ('2k_earth_nightmap.jpg', 'earth_night.jpg', 2048, 78, 'RGB'),
        ('2k_earth_clouds.jpg', 'earth_clouds.jpg', 2048, 78, 'L'),
        ('2k_moon.jpg', 'moon.jpg', 2048, 80, 'RGB'),
        ('2k_mercury.jpg', 'mercury.jpg', 2048, 78, 'RGB'),
        ('2k_venus_atmosphere.jpg', 'venus.jpg', 2048, 82, 'RGB'),
        ('2k_mars.jpg', 'mars.jpg', 2048, 82, 'RGB'),
        ('2k_jupiter.jpg', 'jupiter.jpg', 2048, 86, 'RGB'),
        ('2k_saturn.jpg', 'saturn.jpg', 2048, 86, 'RGB'),
        ('2k_uranus.jpg', 'uranus.jpg', 1024, 86, 'RGB'),
        ('2k_neptune.jpg', 'neptune.jpg', 2048, 86, 'RGB'),
        ('2k_ceres_fictional.jpg', 'ceres.jpg', 1024, 78, 'RGB'),
        ('2k_eris_fictional.jpg', 'eris.jpg', 1024, 78, 'RGB'),
        ('2k_haumea_fictional.jpg', 'haumea.jpg', 1024, 78, 'RGB'),
        ('2k_makemake_fictional.jpg', 'makemake.jpg', 1024, 78, 'RGB'),
        ('pluto.jpg', 'pluto.jpg', 2048, 84, 'RGB'),
        ('triton.jpg', 'triton.jpg', 1024, 82, 'RGB'),
        ('ganymede.jpg', 'ganymede.jpg', 1024, 84, 'RGB'),
        ('io.jpg', 'io.jpg', 1024, 84, 'RGB'),
        ('enceladus.jpg', 'enceladus.jpg', 1024, 80, 'RGB'),
        ('iapetus.jpg', 'iapetus.jpg', 1024, 80, 'RGB'),
        ('mimas.jpg', 'mimas.jpg', 1024, 80, 'RGB'),
        ('dione.jpg', 'dione.jpg', 1024, 80, 'RGB'),
        ('rhea.jpg', 'rhea.jpg', 1024, 80, 'RGB'),
        ('tethys.jpg', 'tethys.jpg', 1024, 80, 'RGB'),
    ]
    total = 0
    for s, o, w, q, mode in jobs:
        p = os.path.join(src, s)
        if not os.path.exists(p):
            print('  missing texture', s)
            continue
        im = Image.open(p).convert('RGB')
        if o == 'io.jpg':
            # mosaic covers only part of the latitude range: pad poles with blurred edge rows
            W, H = im.size
            full = Image.new('RGB', (W, W // 2))
            pad = (W // 2 - H) // 2
            top = im.crop((0, 0, W, 8)).resize((W, pad)).filter(ImageFilter.GaussianBlur(24))
            bot = im.crop((0, H - 8, W, H)).resize((W, W // 2 - H - pad)).filter(ImageFilter.GaussianBlur(24))
            full.paste(top, (0, 0)); full.paste(im, (0, pad)); full.paste(bot, (0, pad + H))
            im = full
        if o == 'triton.jpg':
            # fill the never-imaged northern hemisphere (black) with the mean surface colour
            import numpy as np
            a = np.asarray(im).astype('float32')
            lum = a.sum(axis=2)
            mask = lum < 40
            mean = a[~mask].mean(axis=0)
            rng = np.random.default_rng(7)
            fill = mean[None, None, :] * (0.93 + 0.07 * rng.random((a.shape[0], a.shape[1], 1)))
            soft = np.asarray(Image.fromarray((mask * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(14))).astype('float32')[..., None] / 255.0
            soft = np.clip(soft * 1.6, 0, 1)
            a = a * (1 - soft) + fill * soft
            im = Image.fromarray(a.clip(0, 255).astype('uint8'))
        im = im.resize((w, w // 2), Image.LANCZOS).convert(mode)
        op = os.path.join(TEX, o)
        im.save(op, quality=q, optimize=True, progressive=True)
        total += os.path.getsize(op)
    ring = Image.open(os.path.join(src, '2k_saturn_ring_alpha.png')).convert('RGBA')
    ring = ring.crop((0, ring.size[1] // 2, ring.size[0], ring.size[1] // 2 + 1)).resize((1024, 1))
    ring.save(os.path.join(TEX, 'saturn_ring.png'))
    total += os.path.getsize(os.path.join(TEX, 'saturn_ring.png'))
    print(f'textures: {total / 1e6:.2f} MB')


if __name__ == '__main__':
    what = sys.argv[1:] or ['stars', 'galaxies', 'small', 'textures']
    if 'stars' in what:
        st = build_stars()
        hosts = build_exoplanets(st)
        st = write_stars(st, hosts)
        build_constellations(st)
    if 'galaxies' in what:
        build_galaxies()
    if 'small' in what:
        build_small_bodies()
    if 'textures' in what:
        build_textures()
    for fn in sorted(os.listdir(OUT)):
        print(f'  {fn:28s} {os.path.getsize(os.path.join(OUT, fn)) / 1e6:6.2f} MB')
