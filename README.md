# Universe Engine

An interactive 3D simulation of the universe that runs in a browser, from 10 km above a moon to
the cosmic microwave background 46 billion light-years away, in one continuous zoom.
It is built on real catalogues where measurements exist and on physical models where they do
not, and it says which is which.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # physics validation (25 tests, incl. comparison with JPL Horizons)
npm run build      # production bundle in dist/
```

Live: https://sumit6511.github.io/universe-engine/ (deployed from `main` by `.github/workflows/pages.yml`).

Requires WebGL 2. Detail level: `?q=low|medium|high|ultra` or the View menu.

## What is in it

| Scale | Content | Source |
|---|---|---|
| Planets and moons | Sun, 8 planets, 6 dwarf planets, 23 moons, Halley's comet; rotation, seasons, eclipses, ring and moon shadows, ray-marched atmospheres | JPL Keplerian elements, Astronomical Almanac lunar series, moon orbits fitted to JPL Horizons, IAU rotation models |
| Small bodies | 40,188 asteroid, Trojan, Centaur and Kuiper-belt orbits propagated on the GPU | JPL Small-Body Database |
| Stars | 113,313 stars at measured distances, with proper motion; constellation figures tied to the 3D stars | HYG 4.1 |
| Exoplanets | 6,428 planets around 4,825 stars, each system visitable | NASA Exoplanet Archive |
| Milky Way | Particle model with spiral arms from maser parallaxes | Reid et al. 2019; Bland-Hawthorn & Gerhard 2016 |
| Black holes | Sgr A*, M87*, Cygnus X-1 with per-pixel Schwarzschild geodesics and a relativistic thin disc | GRAVITY 2022, EHT 2019, Miller-Jones 2021 |
| Galaxies | 10,168 NGC/IC galaxies and Local Group dwarfs in 3D | OpenNGC |
| Cosmic web | ΛCDM realisation, tiled to the particle horizon, on our past light cone; scrubbable structure formation | Planck 2018, Eisenstein & Hu 1998, Zel'dovich 1970 |
| Spacecraft | Voyager 1 and 2, Pioneer 10 and 11, New Horizons at their real positions | JPL Horizons state vectors |
| Relativistic flight | Aberration, Doppler shift and beaming of the whole sky at up to 0.9999 c | Special relativity |
| Guides | Habitable zones (Sun and every exoplanet host), reach of human radio signals | Kopparapu et al. 2013 |
| Gravity lab | GPU N-body: galaxy encounters (restricted three-body) and a self-gravitating cluster (direct summation) | Toomre & Toomre 1972 |

## Architecture

```
src/
  core/        constants, reference frames (ecliptic / equatorial / galactic)
  physics/     kepler, ephemeris, cosmology, stellar           <- pure, unit-tested
  data/        body definitions, fitted moon orbits
  engine/      renderer + layers, multi-scale camera, entities, quality presets
  scene/       solar system, stars + exoplanets, Milky Way, galaxies, cosmic web, black holes
  shaders/     GLSL: planets, rings, atmosphere, stars, noise, black-body colour
  workers/     Zel'dovich initial conditions (3D FFT) off the main thread
  lab/         GPU N-body
  ui/          DOM interface, tour, formatting
tools/         data pipeline (Python): build_data.py, fit_moons.py, make_artifact.py
tests/         vitest suites + JPL Horizons reference vectors
```

### Twenty orders of magnitude

A single float cannot hold both a planet's surface and a galaxy cluster, so:

* **Positions are split.** Every entity has an `anchor` in parsecs (its system) and a `local`
  offset in kilometres, both in JavaScript doubles. Bodies in one system share an anchor, so
  their relative positions are exact even 16 Mpc from the Sun.
* **Rendering is camera-relative.** The camera sits at the origin; the CPU subtracts positions
  in double precision and the GPU only sees small camera-relative numbers.
* **Four layers** are drawn back to front in their own units: cosmic (Mpc), galactic (pc),
  stellar (pc), near (km). Only the near layer holds solid geometry; it uses a logarithmic
  depth buffer (0.05 km to 10¹⁹ km).
* **The camera** orbits a focus at a distance stored as a logarithm. Travel between objects
  zooms out until both ends are in view, pans, and zooms in, switching the precision anchor
  at the midpoint.
* **Splats conserve flux.** Galaxy and cosmic-web particles have a physical size; once they
  shrink below a pixel their brightness falls instead, so surface brightness is consistent at
  every zoom level.

Post-processing is HDR (half-float targets), bloom, an optional cinematic lens pass
(anamorphic streaks, chromatic aberration, vignette, grain) and ACES tone mapping.

Shareable links encode the view in the URL hash: `#at/<entity id>/<ln distance km>/<yaw>/<pitch>/<Julian date>`.

## Physics and validation

`npm test` checks, among other things:

* Kepler solver to 1e-10 for eccentricities up to 0.99.
* Planet positions against **JPL Horizons** (DE441) at four epochs from 1969 to 2040:
  better than 0.05° for the inner planets, 0.35° worst case (Saturn).
* The Moon to 0.5° and 0.6% in distance; all 21 fitted moons to within 4°. The fit recovers
  Mimas's 43°, 70-year libration (resonance with Tethys) and the nodal precession of
  Miranda (17.8 yr) and Triton (688 yr) from the Horizons data alone.
* Earth's sub-solar point at J2000 noon; Saturn's ring-plane crossing in March 2025.
* Cosmology: age 13.8 Gyr, last scattering at 13.9 Gpc, particle horizon ~14.2 Gpc,
  growth factor, σ₈ normalisation of the power spectrum.
* The variance of the generated density field against the integral of the input power
  spectrum (to 3%), and a 3D rms displacement of ~14 Mpc.

A visual check worth trying: set the clock to 2027-08-02 10:07 UTC and look at Earth from
the Sun. The Moon's shadow lies on Egypt, on the real path of totality.

Black-hole rays integrate `a = -(3/2) h² x / |x|⁵` (the Cartesian form of the Schwarzschild
Binet equation, r_s = 1). The disc runs from the ISCO at 3 r_s with a Shakura–Sunyaev
temperature profile; intensity scales as g⁴T⁴ with g the product of Doppler and
gravitational shifts. The background is a cube map of the actual surrounding scene.

## Known limitations

* The relativistic view moves along the line of sight and applies to stars, the Milky Way and
  galaxies; solid bodies are not warped. Colour temperature shifts exactly by the Doppler factor,
  but brightness is compressed (true beaming goes as D⁴ and would saturate the display).
* Spacecraft positions are a straight-line extrapolation of a 2026 state vector, so each probe
  is hidden before roughly twelve years after its launch.

* Planet elements are valid for 3000 BC – 3000 AD; outside that span the orbit shapes are
  frozen and only the mean longitude advances.
* Small bodies and Pluto use two-body propagation (about 1° error within 15 years of epoch,
  several degrees after 60).
* Redshift distances ignore peculiar velocities. Nearby galaxies use measured distances and
  rich clusters are collapsed to their cluster distance.
* The galaxy catalogue is brightness-limited, so it thins with distance. Beyond it the cosmic
  web is statistically representative, not a map.
* Black holes are non-rotating (Schwarzschild); jets are not modelled.
* The Zel'dovich approximation is first-order: it gives the web's morphology, not virialised
  haloes.
* Exoplanet appearances, orbit orientations and phases are illustrative.
* Europa, Callisto, Charon, Titan and several small moons have procedural surfaces.

## Data and licences

Regenerate everything in `public/` with `python3 tools/build_data.py` (raw inputs go in
`data-raw/`, see the script header) and `python3 tools/fit_moons.py`.

* **HYG Database 4.1** — David Nash, CC BY-SA 4.0
* **OpenNGC** — Mattia Verga, CC BY-SA 4.0
* **NASA Exoplanet Archive** — Caltech/IPAC under contract with NASA
* **JPL Solar System Dynamics** — approximate planetary elements, Horizons, SBDB
* **Solar System Scope textures** — CC BY 4.0, based on NASA imagery
* **Cassini moon maps** — NASA/JPL-Caltech/SSI/LPI; **Pluto** — NASA/JHUAPL/SwRI;
  **Io, Triton** — NASA/JPL/USGS; **Ganymede** — Björn Jónsson
* **Constellation figures** — d3-celestial, Olaf Frohn, BSD-3
* **three.js** — MIT; simplex noise — Ashima Arts / Ian McEwan, MIT

The 2MASS Redshift Survey was considered for the galaxy layer and not used because its terms
forbid redistribution.
