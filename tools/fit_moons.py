#!/usr/bin/env python3
"""
Fit simple precessing-free mean orbits for the major moons directly from JPL Horizons
state vectors (DE441 + satellite ephemerides), in the J2000 ecliptic frame.

For each moon we query planetocentric position/velocity at t0 = J2000 and at a
geometric ladder of later epochs, then derive
    normal   orbit-plane normal (angular momentum direction at t0)
    n        mean motion (deg/day), refined over a ~45 year baseline by phase unwrapping
    L0       mean longitude at t0, measured in the orbit plane from the plane's ascending
             node on the ecliptic
    e, peri  eccentricity and longitude of periapsis (only for the two clearly eccentric,
             weakly perturbed moons, Titan and Iapetus; the rest are treated as circular)
    a        mean distance (km), from the JPL mean-element table

Output: src/data/moonfit.json
"""
import json, math, os, re, subprocess, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T0 = 2451545.0
LADDER = [0, 0.25, 1, 4, 16, 64, 256, 1024, 4096, 16384]

# id: (Horizons id, centre, semi-major axis km (JPL mean elements), GM of planet km^3/s^2, keep eccentricity)
MOONS = {
    'phobos': ('401', '500@499', 9375, 42828.37, False), 'deimos': ('402', '500@499', 23457, 42828.37, False),
    'io': ('501', '500@599', 421800, 126686534.9, False), 'europa': ('502', '500@599', 671100, 126686534.9, False),
    'ganymede': ('503', '500@599', 1070400, 126686534.9, False), 'callisto': ('504', '500@599', 1882700, 126686534.9, False),
    'mimas': ('601', '500@699', 186000, 37931207.8, False), 'enceladus': ('602', '500@699', 238400, 37931207.8, False),
    'tethys': ('603', '500@699', 295000, 37931207.8, False), 'dione': ('604', '500@699', 377700, 37931207.8, False),
    'rhea': ('605', '500@699', 527200, 37931207.8, False), 'titan': ('606', '500@699', 1221900, 37931207.8, True),
    'iapetus': ('608', '500@699', 3561700, 37931207.8, True),
    'miranda': ('705', '500@799', 129846, 5793951.3, False), 'ariel': ('701', '500@799', 190929, 5793951.3, False),
    'umbriel': ('702', '500@799', 265986, 5793951.3, False), 'titania': ('703', '500@799', 436298, 5793951.3, False),
    'oberon': ('704', '500@799', 583511, 5793951.3, False),
    'triton': ('801', '500@899', 354800, 6835099.97, False), 'proteus': ('808', '500@899', 117700, 6835099.97, False),
    'charon': ('901', '500@999', 19600, 869.6, False),
}


def horizons(cmd, centre, times):
    q = {'format': 'text', 'COMMAND': f"'{cmd}'", 'OBJ_DATA': "'NO'", 'MAKE_EPHEM': "'YES'", 'EPHEM_TYPE': "'VECTORS'",
         'CENTER': f"'{centre}'", 'TLIST': ','.join(f"'{t}'" for t in times), 'VEC_TABLE': "'2'", 'REF_PLANE': "'ECLIPTIC'",
         'OUT_UNITS': "'KM-S'"}
    url = 'https://ssd.jpl.nasa.gov/api/horizons.api?' + urllib.parse.urlencode(q)
    txt = subprocess.run(['curl', '-sS', '-m', '90', url], capture_output=True, text=True).stdout
    body = txt.split('$$SOE')[1].split('$$EOE')[0]
    out = []
    num = r'[-+]?\d\.\d+E[-+]\d+'
    for blk in re.split(r'\n(?=\d{7}\.\d+ = )', body.strip()):
        vals = [float(v) for v in re.findall(num, blk)]
        out.append((float(blk.split('=')[0]), vals[:3], vals[3:6]))
    return out


def cross(a, b): return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
def dot(a, b): return sum(x * y for x, y in zip(a, b))
def norm(a):
    n = math.sqrt(dot(a, a)); return [x / n for x in a]


def fit(key):
    hid, centre, a, gm, keep_e = MOONS[key]
    rows = horizons(hid, centre, [T0 + d for d in LADDER])
    _, r0, v0 = rows[0]
    h = cross(r0, v0)
    nrm = norm(h)
    xr = norm(cross([0, 0, 1], nrm))
    yr = cross(nrm, xr)
    lon = lambda r: math.degrees(math.atan2(dot(r, yr), dot(r, xr)))
    # eccentricity vector
    rmag = math.sqrt(dot(r0, r0))
    ev = [c / gm - r / rmag for c, r in zip(cross(v0, h), r0)]
    e = math.sqrt(dot(ev, ev)) if keep_e else 0.0
    peri = lon(ev) if keep_e else 0.0

    def mean_lon(r):
        th = lon(r)
        if not keep_e:
            return th
        # true -> mean anomaly
        nu = math.radians(th - peri)
        E = 2 * math.atan2(math.sqrt(1 - e) * math.sin(nu / 2), math.sqrt(1 + e) * math.cos(nu / 2))
        return peri + math.degrees(E - e * math.sin(E))

    L0 = mean_lon(r0)
    # initial mean motion from the osculating state, then refine by phase unwrapping
    n = math.degrees(math.sqrt(gm / a ** 3)) * 86400.0
    for (jd, r, _v) in rows[1:]:
        dt = jd - T0
        pred = L0 + n * dt
        meas = mean_lon(r)
        diff = (meas - pred + 180) % 360 - 180
        n += diff / dt
    return dict(a=a, e=round(e, 5), n=n, L0=L0 % 360, peri=peri % 360, normal=[round(c, 8) for c in nrm])


POLES = {  # IAU spin poles (RA, Dec deg) used as precession axes
    'miranda': (77.311, 15.175), 'triton': (299.36, 43.46),
}
EPS = math.radians(23.4392911)


def rot(v, axis, ang):
    c, s_ = math.cos(ang), math.sin(ang)
    k = cross(axis, v)
    d = dot(axis, v)
    return [v[i] * c + k[i] * s_ + axis[i] * d * (1 - c) for i in range(3)]


def fit_precessing(key):
    """Orbit plane precessing uniformly about the planet's pole (Miranda, Triton)."""
    hid, centre, a, gm, _ = MOONS[key]
    ra, dec = (math.radians(x) for x in POLES[key])
    q = [math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec)]
    pole = [q[0], q[1] * math.cos(EPS) + q[2] * math.sin(EPS), -q[1] * math.sin(EPS) + q[2] * math.cos(EPS)]
    rows = horizons(hid, centre, [T0 + d for d in LADDER])
    ux = norm(cross(pole, [1, 0, 0])); uy = cross(pole, ux)
    az = lambda v: math.degrees(math.atan2(dot(v, uy), dot(v, ux)))
    n0 = norm(cross(rows[0][1], rows[0][2]))
    rate = 0.0
    for (jd, r, v) in rows[1:]:
        dt = jd - T0
        if dt < 64: continue
        nn = norm(cross(r, v))
        diff = (az(nn) - az(n0) - rate * dt + 180) % 360 - 180
        rate += diff / dt
    xr0 = norm(cross([0, 0, 1], n0)); yr0 = cross(n0, xr0)
    def lon(r, dt):
        ang = math.radians(rate * dt)
        xr, yr = rot(xr0, pole, ang), rot(yr0, pole, ang)
        return math.degrees(math.atan2(dot(r, yr), dot(r, xr)))
    L0 = lon(rows[0][1], 0)
    n = math.degrees(math.sqrt(gm / a ** 3)) * 86400.0
    for (jd, r, _v) in rows[1:]:
        dt = jd - T0
        diff = (lon(r, dt) - (L0 + n * dt) + 180) % 360 - 180
        n += diff / dt
    return dict(a=a, e=0.0, n=n, L0=L0 % 360, peri=0.0, normal=[round(c, 8) for c in n0], pole=[round(c, 8) for c in pole], prec=rate)


def fit_mimas():
    """Mimas: 2:4 inclination resonance with Tethys makes its mean longitude librate by ~43 deg over ~70 yr."""
    hid, centre, a, gm, _ = MOONS['mimas']
    times = [T0 + (y - 2000) * 365.25 for y in [1900 + 2.5 * i for i in range(81)]]
    rows = horizons(hid, centre, times)
    k0 = min(range(len(rows)), key=lambda i: abs(rows[i][0] - T0))
    nrm = norm(cross(rows[k0][1], rows[k0][2]))
    xr = norm(cross([0, 0, 1], nrm)); yr = cross(nrm, xr)
    lon = lambda r: math.degrees(math.atan2(dot(r, yr), dot(r, xr)))
    n_nom = 381.9944948
    res = []
    prev = None
    for (jd, r, _v) in rows:
        d = (lon(r) - n_nom * (jd - T0) + 180) % 360 - 180
        if prev is not None:
            while d - prev > 180: d -= 360
            while d - prev < -180: d += 360
        prev = d
        res.append((jd - T0, d))
    best = None
    import itertools
    for per_yr in [60 + 0.05 * i for i in range(500)]:
        w = 2 * math.pi / (per_yr * 365.25)
        # least squares for d = c0 + c1 t + c2 sin wt + c3 cos wt
        A = [[1, t / 36525.0, math.sin(w * t), math.cos(w * t)] for t, _ in res]
        y = [d for _, d in res]
        N = [[sum(A[i][p] * A[i][q] for i in range(len(A))) for q in range(4)] for p in range(4)]
        b = [sum(A[i][p] * y[i] for i in range(len(A))) for p in range(4)]
        # gaussian elimination
        M = [N[i] + [b[i]] for i in range(4)]
        for i in range(4):
            piv = max(range(i, 4), key=lambda r_: abs(M[r_][i])); M[i], M[piv] = M[piv], M[i]
            for r_ in range(4):
                if r_ != i:
                    f = M[r_][i] / M[i][i]
                    M[r_] = [x - f * z for x, z in zip(M[r_], M[i])]
        c = [M[i][4] / M[i][i] for i in range(4)]
        sse = sum((sum(A[i][p] * c[p] for p in range(4)) - y[i]) ** 2 for i in range(len(A)))
        if best is None or sse < best[0]:
            best = (sse, per_yr, c)
    sse, per_yr, c = best
    amp = math.hypot(c[2], c[3]); phase = math.atan2(c[3], c[2])
    print(f'  mimas libration: amplitude {amp:.2f} deg, period {per_yr:.2f} yr, rms residual {math.sqrt(sse / len(res)):.2f} deg')
    return dict(a=a, e=0.0, n=n_nom + c[1] / 36525.0, L0=c[0] % 360, peri=0.0, normal=[round(x, 8) for x in nrm],
                lib=dict(amp=amp, period=per_yr * 365.25, phase=phase))


if __name__ == '__main__':
    out = {}
    for k in MOONS:
        out[k] = fit_mimas() if k == 'mimas' else fit_precessing(k) if k in POLES else fit(k)
        print(f"{k:10s} n={out[k]['n']:.7f} deg/d  P={360 / out[k]['n']:.6f} d  e={out[k]['e']}")
        time.sleep(0.5)
    json.dump(out, open(os.path.join(ROOT, 'src', 'data', 'moonfit.json'), 'w'), indent=1)
