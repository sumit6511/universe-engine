// Solar-system bodies: physical data, IAU rotation models, orbits and rendering hints.
// Physical parameters: NASA planetary fact sheets / JPL SSD.  Rotation: IAU WGCCRE 2015.
// Satellite orbits: fitted to JPL Horizons state vectors (moonfit.json).

import type { RotationModel, SatFit, PlanetName } from '../physics/ephemeris';
import moonFit from './moonfit.json';

/** Moon orbits fitted to JPL Horizons (see tools/fit_moons.py). */
export const MOON_FIT = moonFit as unknown as Record<string, SatFit>;

export interface AtmosphereDef {
  /** top of atmosphere as a fraction of the planet radius above the surface */
  height: number;
  /** Rayleigh scattering coefficient at the surface, per planet radius (rgb) */
  betaR: [number, number, number];
  /** Mie scattering coefficient at the surface, per planet radius */
  betaM: [number, number, number];
  /** scale heights as fractions of the planet radius */
  hR: number;
  hM: number;
  /** Mie asymmetry */
  g: number;
  intensity: number;
}

export interface RingDef {
  inner: number; // km
  outer: number;
  texture?: string;
  /** procedural ringlets: [radius km, width km, opacity] */
  ringlets?: [number, number, number][];
  color: [number, number, number];
}

export type OrbitDef =
  | { type: 'planet'; name: PlanetName }
  | { type: 'earth' }
  | { type: 'moon' }
  | { type: 'sat' }
  | { type: 'small'; key: string };

export interface BodyDef {
  id: string;
  name: string;
  kind: 'star' | 'planet' | 'dwarf' | 'moon' | 'asteroid' | 'comet';
  parent?: string;
  radius: number; // mean radius, km
  flattening?: number;
  mass: number; // kg
  rot?: RotationModel;
  /** synchronous rotation: one face always toward the parent */
  locked?: boolean;
  texture?: string;
  /** surface style for bodies without a map */
  procedural?: 'rock' | 'ice' | 'haze';
  color: number;
  /** 0 = Lambert (thick atmosphere), 1 = lunar-like regolith */
  regolith: number;
  albedo: number;
  orbit?: OrbitDef;
  atmosphere?: AtmosphereDef;
  ring?: RingDef;
  blurb: string;
  textureNote?: string;
}

const EARTH_ATMO: AtmosphereDef = { height: 0.0157, betaR: [35.0, 82.8, 142.7], betaM: [14, 14, 14], hR: 1.2557e-3, hM: 1.884e-4, g: 0.76, intensity: 11 };

export const BODIES: BodyDef[] = [
  {
    id: 'sun', name: 'Sun', kind: 'star', radius: 695700, mass: 1.98847e30, color: 0xfff1d6, regolith: 0, albedo: 1,
    rot: { ra0: 286.13, ra1: 0, dec0: 63.87, dec1: 0, w0: 84.176, wd: 14.1844 },
    blurb: 'A G2V main-sequence star 4.57 billion years old. It holds 99.86% of the solar system\'s mass and fuses about 600 million tonnes of hydrogen every second.',
  },
  {
    id: 'mercury', name: 'Mercury', kind: 'planet', parent: 'sun', radius: 2439.7, mass: 3.3011e23, color: 0x9c9388, regolith: 1, albedo: 0.142,
    rot: { ra0: 281.0103, ra1: -0.0328, dec0: 61.4155, dec1: -0.0049, w0: 329.5988, wd: 6.1385108 },
    texture: 'mercury.jpg', orbit: { type: 'planet', name: 'Mercury' },
    blurb: 'The smallest planet, locked in a 3:2 spin-orbit resonance: it rotates three times for every two orbits. Its 43 arcsecond-per-century perihelion advance was the first confirmed test of general relativity.',
  },
  {
    id: 'venus', name: 'Venus', kind: 'planet', parent: 'sun', radius: 6051.8, mass: 4.8675e24, color: 0xe8d9b0, regolith: 0, albedo: 0.689,
    rot: { ra0: 272.76, ra1: 0, dec0: 67.16, dec1: 0, w0: 160.2, wd: -1.4813688 },
    texture: 'venus.jpg', orbit: { type: 'planet', name: 'Venus' },
    atmosphere: { height: 0.02, betaR: [60, 52, 30], betaM: [40, 36, 26], hR: 2.6e-3, hM: 1.0e-3, g: 0.7, intensity: 16 },
    blurb: 'Shrouded in sulphuric-acid clouds over a 92-bar CO2 atmosphere, with a surface at 737 K. It rotates backwards, once every 243 days. Shown here as seen in visible light: the cloud tops.',
  },
  {
    id: 'earth', name: 'Earth', kind: 'planet', parent: 'sun', radius: 6371.0084, flattening: 0.0033528, mass: 5.97237e24, color: 0x6fa8ff, regolith: 0, albedo: 0.306,
    rot: { ra0: 0, ra1: -0.641, dec0: 90, dec1: -0.557, w0: 190.147, wd: 360.9856235 },
    texture: 'earth_day.jpg', orbit: { type: 'earth' }, atmosphere: EARTH_ATMO,
    blurb: 'The only world known to host life. City lights, cloud cover, ocean glint and the terminator are rendered for the current simulation date and time.',
  },
  {
    id: 'moon', name: 'Moon', kind: 'moon', parent: 'earth', radius: 1737.4, mass: 7.342e22, color: 0xc9c5bd, regolith: 1, albedo: 0.12,
    rot: { ra0: 269.9949, ra1: 0.0031, dec0: 66.5392, dec1: 0.013, w0: 38.3213, wd: 13.17635815 },
    texture: 'moon.jpg', orbit: { type: 'moon' },
    blurb: 'Earth\'s only natural satellite, receding at 3.8 cm per year. Its position uses the Astronomical Almanac lunar series, so phases and eclipses fall close to their true dates.',
  },
  {
    id: 'mars', name: 'Mars', kind: 'planet', parent: 'sun', radius: 3389.5, flattening: 0.00589, mass: 6.4171e23, color: 0xe27b58, regolith: 0.5, albedo: 0.17,
    rot: { ra0: 317.269202, ra1: -0.10927547, dec0: 54.432516, dec1: -0.05827105, w0: 176.049863, wd: 350.891982443297 },
    texture: 'mars.jpg', orbit: { type: 'planet', name: 'Mars' },
    atmosphere: { height: 0.03, betaR: [9, 6.0, 3.2], betaM: [10, 7, 4.5], hR: 3.3e-3, hM: 2.0e-3, g: 0.76, intensity: 10 },
    blurb: 'A cold desert world with the tallest volcano (Olympus Mons, 21.9 km) and the longest canyon system (Valles Marineris) in the solar system. Its thin CO2 atmosphere is 0.6% of Earth\'s surface pressure.',
  },
  {
    id: 'phobos', name: 'Phobos', kind: 'moon', parent: 'mars', radius: 11.1, mass: 1.0659e16, color: 0x8a7f74, regolith: 1, albedo: 0.071, locked: true, procedural: 'rock',
    orbit: { type: 'sat' },
    blurb: 'Orbits Mars three times a day, below synchronous altitude. Tides are drawing it inward by about 1.8 m per century; it will break up or impact within ~50 million years.',
  },
  {
    id: 'deimos', name: 'Deimos', kind: 'moon', parent: 'mars', radius: 6.2, mass: 1.4762e15, color: 0x9a8f80, regolith: 1, albedo: 0.068, locked: true, procedural: 'rock',
    orbit: { type: 'sat' },
    blurb: 'The smaller, outer moon of Mars, only about 12 km across.',
  },
  {
    id: 'jupiter', name: 'Jupiter', kind: 'planet', parent: 'sun', radius: 69911, flattening: 0.06487, mass: 1.89813e27, color: 0xd9b48a, regolith: 0, albedo: 0.503,
    rot: { ra0: 268.056595, ra1: -0.006499, dec0: 64.495303, dec1: 0.002413, w0: 284.95, wd: 870.536 },
    texture: 'jupiter.jpg', orbit: { type: 'planet', name: 'Jupiter' },
    atmosphere: { height: 0.012, betaR: [14, 16, 20], betaM: [6, 6, 6], hR: 1.6e-3, hM: 8e-4, g: 0.7, intensity: 8 },
    ring: undefined,
    blurb: 'More than twice the mass of all the other planets combined. Its day is under 10 hours, flattening the planet by 6.5%. Shadows of the Galilean moons cross its cloud tops.',
  },
  {
    id: 'io', name: 'Io', kind: 'moon', parent: 'jupiter', radius: 1821.6, mass: 8.9319e22, color: 0xe9d36c, regolith: 0.8, albedo: 0.63, locked: true,
    texture: 'io.jpg', orbit: { type: 'sat' },
    blurb: 'The most volcanically active body known, heated by tidal flexing in its 1:2:4 Laplace resonance with Europa and Ganymede.',
  },
  {
    id: 'europa', name: 'Europa', kind: 'moon', parent: 'jupiter', radius: 1560.8, mass: 4.7998e22, color: 0xd8cfc0, regolith: 0.7, albedo: 0.67, locked: true, procedural: 'ice',
    orbit: { type: 'sat' },
    blurb: 'An ice shell over a global salt-water ocean holding roughly twice the volume of Earth\'s oceans.', textureNote: 'Procedural surface (no map bundled).',
  },
  {
    id: 'ganymede', name: 'Ganymede', kind: 'moon', parent: 'jupiter', radius: 2634.1, mass: 1.4819e23, color: 0xa39a8c, regolith: 0.8, albedo: 0.43, locked: true,
    texture: 'ganymede.jpg', orbit: { type: 'sat' },
    blurb: 'The largest moon in the solar system, bigger than Mercury, and the only moon with its own magnetic field.',
  },
  {
    id: 'callisto', name: 'Callisto', kind: 'moon', parent: 'jupiter', radius: 2410.3, mass: 1.0759e23, color: 0x6f6659, regolith: 1, albedo: 0.17, locked: true, procedural: 'rock',
    orbit: { type: 'sat' },
    blurb: 'One of the most heavily cratered surfaces known, essentially unchanged for four billion years.', textureNote: 'Procedural surface (no map bundled).',
  },
  {
    id: 'saturn', name: 'Saturn', kind: 'planet', parent: 'sun', radius: 58232, flattening: 0.09796, mass: 5.6834e26, color: 0xe6d3a3, regolith: 0, albedo: 0.342,
    rot: { ra0: 40.589, ra1: -0.036, dec0: 83.537, dec1: -0.004, w0: 38.9, wd: 810.7939024 },
    texture: 'saturn.jpg', orbit: { type: 'planet', name: 'Saturn' },
    atmosphere: { height: 0.012, betaR: [14, 15, 17], betaM: [6, 6, 5], hR: 1.8e-3, hM: 9e-4, g: 0.7, intensity: 7 },
    ring: { inner: 74500, outer: 140220, texture: 'saturn_ring.png', color: [1, 0.96, 0.88] },
    blurb: 'The least dense planet (0.69 g/cm3) and the most oblate. Its rings span 280,000 km yet are typically only ~10 m thick; ring and planet cast shadows on each other.',
  },
  {
    id: 'mimas', name: 'Mimas', kind: 'moon', parent: 'saturn', radius: 198.2, mass: 3.7493e19, color: 0xbdbdbd, regolith: 0.8, albedo: 0.96, locked: true,
    texture: 'mimas.jpg', orbit: { type: 'sat' },
    blurb: 'Dominated by the 130 km crater Herschel. Its 2:1 resonance with ring particles clears the Cassini Division.',
  },
  {
    id: 'enceladus', name: 'Enceladus', kind: 'moon', parent: 'saturn', radius: 252.1, mass: 1.08022e20, color: 0xf2f5f7, regolith: 0.6, albedo: 1.0, locked: true,
    texture: 'enceladus.jpg', orbit: { type: 'sat' },
    blurb: 'The most reflective body in the solar system. Geysers at its south pole vent a subsurface ocean into space, feeding Saturn\'s E ring.',
  },
  {
    id: 'tethys', name: 'Tethys', kind: 'moon', parent: 'saturn', radius: 531.1, mass: 6.17449e20, color: 0xcfcfcf, regolith: 0.8, albedo: 0.8, locked: true,
    texture: 'tethys.jpg', orbit: { type: 'sat' },
    blurb: 'An almost pure water-ice moon scarred by the 2,000 km long canyon Ithaca Chasma.',
  },
  {
    id: 'dione', name: 'Dione', kind: 'moon', parent: 'saturn', radius: 561.4, mass: 1.095452e21, color: 0xc9c9c9, regolith: 0.8, albedo: 0.7, locked: true,
    texture: 'dione.jpg', orbit: { type: 'sat' },
    blurb: 'Bright ice cliffs streak its trailing hemisphere.',
  },
  {
    id: 'rhea', name: 'Rhea', kind: 'moon', parent: 'saturn', radius: 763.8, mass: 2.306518e21, color: 0xc4c4c4, regolith: 0.8, albedo: 0.7, locked: true,
    texture: 'rhea.jpg', orbit: { type: 'sat' },
    blurb: 'Saturn\'s second-largest moon, a heavily cratered ball of ice and rock.',
  },
  {
    id: 'titan', name: 'Titan', kind: 'moon', parent: 'saturn', radius: 2574.7, mass: 1.3452e23, color: 0xe0a44f, regolith: 0, albedo: 0.22, locked: true, procedural: 'haze',
    orbit: { type: 'sat' },
    atmosphere: { height: 0.2, betaR: [5.5, 3.6, 1.3], betaM: [5.0, 3.6, 1.6], hR: 0.035, hM: 0.03, g: 0.6, intensity: 9 },
    blurb: 'The only moon with a dense atmosphere (1.45 bar of nitrogen) and the only other world with stable surface liquids: methane and ethane seas.',
  },
  {
    id: 'iapetus', name: 'Iapetus', kind: 'moon', parent: 'saturn', radius: 734.5, mass: 1.805635e21, color: 0xa39a8c, regolith: 0.9, albedo: 0.3, locked: true,
    texture: 'iapetus.jpg', orbit: { type: 'sat' },
    blurb: 'A two-toned moon: its leading hemisphere is as dark as coal, its trailing side as bright as snow.',
  },
  {
    id: 'uranus', name: 'Uranus', kind: 'planet', parent: 'sun', radius: 25362, flattening: 0.02293, mass: 8.681e25, color: 0xa8e3e8, regolith: 0, albedo: 0.3,
    rot: { ra0: 257.311, ra1: 0, dec0: -15.175, dec1: 0, w0: 203.81, wd: -501.1600928 },
    texture: 'uranus.jpg', orbit: { type: 'planet', name: 'Uranus' },
    atmosphere: { height: 0.014, betaR: [8, 18, 22], betaM: [4, 5, 5], hR: 2.0e-3, hM: 1e-3, g: 0.7, intensity: 7 },
    ring: {
      inner: 41000, outer: 52000, color: [0.55, 0.58, 0.62],
      ringlets: [[41837, 2, 0.3], [42234, 2, 0.3], [42571, 2.5, 0.3], [44718, 7, 0.4], [45661, 8, 0.4], [47176, 2, 0.35], [47627, 5, 0.4], [48300, 5, 0.4], [51149, 58, 0.9]],
    },
    blurb: 'An ice giant tipped on its side: its axis is tilted 97.8 degrees, so each pole spends 42 years in sunlight and 42 in darkness.',
  },
  {
    id: 'miranda', name: 'Miranda', kind: 'moon', parent: 'uranus', radius: 235.8, mass: 6.4e19, color: 0xb5b5b5, regolith: 0.9, albedo: 0.32, locked: true, procedural: 'ice',
    orbit: { type: 'sat' },
    blurb: 'A patchwork world with 20 km high cliffs, the tallest known in the solar system.',
  },
  {
    id: 'ariel', name: 'Ariel', kind: 'moon', parent: 'uranus', radius: 578.9, mass: 1.251e21, color: 0xc0bcb6, regolith: 0.9, albedo: 0.53, locked: true, procedural: 'ice',
    orbit: { type: 'sat' },
    blurb: 'The brightest Uranian moon, crossed by fault valleys.',
  },
  {
    id: 'umbriel', name: 'Umbriel', kind: 'moon', parent: 'uranus', radius: 584.7, mass: 1.275e21, color: 0x7d7b78, regolith: 1, albedo: 0.26, locked: true, procedural: 'rock',
    orbit: { type: 'sat' },
    blurb: 'The darkest of Uranus\'s large moons.',
  },
  {
    id: 'titania', name: 'Titania', kind: 'moon', parent: 'uranus', radius: 788.4, mass: 3.4e21, color: 0xb0a9a0, regolith: 0.9, albedo: 0.35, locked: true, procedural: 'ice',
    orbit: { type: 'sat' },
    blurb: 'The largest moon of Uranus.',
  },
  {
    id: 'oberon', name: 'Oberon', kind: 'moon', parent: 'uranus', radius: 761.4, mass: 3.076e21, color: 0x9f968d, regolith: 1, albedo: 0.31, locked: true, procedural: 'rock',
    orbit: { type: 'sat' },
    blurb: 'The outermost large moon of Uranus, heavily cratered.',
  },
  {
    id: 'neptune', name: 'Neptune', kind: 'planet', parent: 'sun', radius: 24622, flattening: 0.01708, mass: 1.02413e26, color: 0x5b8cff, regolith: 0, albedo: 0.29,
    rot: { ra0: 299.36, ra1: 0, dec0: 43.46, dec1: 0, w0: 249.978, wd: 541.1397757 },
    texture: 'neptune.jpg', orbit: { type: 'planet', name: 'Neptune' },
    atmosphere: { height: 0.014, betaR: [6, 12, 26], betaM: [4, 4, 5], hR: 2.0e-3, hM: 1e-3, g: 0.7, intensity: 7 },
    blurb: 'The outermost planet, found in 1846 from its gravitational pull on Uranus. Its winds reach 2,100 km/h, the fastest in the solar system.',
  },
  {
    id: 'triton', name: 'Triton', kind: 'moon', parent: 'neptune', radius: 1353.4, mass: 2.139e22, color: 0xd6c9c0, regolith: 0.7, albedo: 0.76, locked: true,
    texture: 'triton.jpg', orbit: { type: 'sat' },
    blurb: 'A captured Kuiper belt object orbiting backwards. Nitrogen geysers erupt from its 38 K surface.', textureNote: 'Northern hemisphere was never imaged; filled with mean colour.',
  },
  {
    id: 'proteus', name: 'Proteus', kind: 'moon', parent: 'neptune', radius: 210, mass: 4.4e19, color: 0x7a7570, regolith: 1, albedo: 0.096, locked: true, procedural: 'rock',
    orbit: { type: 'sat' },
    blurb: 'Neptune\'s second-largest moon, about as large as an irregular body can be before gravity makes it round.',
  },
  {
    id: 'pluto', name: 'Pluto', kind: 'dwarf', parent: 'sun', radius: 1188.3, mass: 1.303e22, color: 0xd9b89a, regolith: 0.7, albedo: 0.52,
    rot: { ra0: 132.993, ra1: 0, dec0: -6.163, dec1: 0, w0: 302.695, wd: 56.3625225 },
    texture: 'pluto.jpg', orbit: { type: 'small', key: 'Pluto' },
    atmosphere: { height: 0.12, betaR: [0.5, 0.9, 1.9], betaM: [0.15, 0.2, 0.3], hR: 0.04, hM: 0.03, g: 0.7, intensity: 6 },
    blurb: 'A dwarf planet in a 3:2 resonance with Neptune. New Horizons (2015) revealed nitrogen-ice glaciers, water-ice mountains and blue haze layers.',
  },
  {
    id: 'charon', name: 'Charon', kind: 'moon', parent: 'pluto', radius: 606, mass: 1.586e21, color: 0x9e9a96, regolith: 0.9, albedo: 0.38, locked: true, procedural: 'ice',
    orbit: { type: 'sat' },
    blurb: 'Half Pluto\'s diameter. The pair are mutually tidally locked and orbit a point between them.', textureNote: 'Procedural surface (no map bundled).',
  },
  {
    id: 'ceres', name: 'Ceres', kind: 'dwarf', parent: 'sun', radius: 469.7, mass: 9.3839e20, color: 0x9a938a, regolith: 1, albedo: 0.09,
    rot: { ra0: 291.418, ra1: 0, dec0: 66.764, dec1: 0, w0: 170.65, wd: 952.1532 },
    texture: 'ceres.jpg', orbit: { type: 'small', key: 'Ceres' },
    blurb: 'The largest object in the asteroid belt and the only dwarf planet in the inner solar system; a third of the belt\'s total mass.', textureNote: 'Texture is an artist\'s impression.',
  },
  {
    id: 'vesta', name: 'Vesta', kind: 'asteroid', parent: 'sun', radius: 262.7, mass: 2.59076e20, color: 0xa8a29a, regolith: 1, albedo: 0.42, procedural: 'rock',
    orbit: { type: 'small', key: 'Vesta' },
    blurb: 'The brightest asteroid and source of the HED meteorites; a differentiated protoplanet that survived from the solar system\'s first few million years.',
  },
  {
    id: 'haumea', name: 'Haumea', kind: 'dwarf', parent: 'sun', radius: 780, mass: 4.006e21, color: 0xd6d6d6, regolith: 0.7, albedo: 0.66,
    texture: 'haumea.jpg', orbit: { type: 'small', key: 'Haumea' },
    blurb: 'A dwarf planet spun into an elongated ellipsoid by its 3.9 hour day, with two moons and a ring.', textureNote: 'Texture is an artist\'s impression; shown as a sphere.',
  },
  {
    id: 'makemake', name: 'Makemake', kind: 'dwarf', parent: 'sun', radius: 715, mass: 3.1e21, color: 0xc9a188, regolith: 0.7, albedo: 0.82,
    texture: 'makemake.jpg', orbit: { type: 'small', key: 'Makemake' },
    blurb: 'A methane-ice covered Kuiper belt dwarf planet discovered in 2005.', textureNote: 'Texture is an artist\'s impression.',
  },
  {
    id: 'eris', name: 'Eris', kind: 'dwarf', parent: 'sun', radius: 1163, mass: 1.6466e22, color: 0xd9d9d9, regolith: 0.6, albedo: 0.96,
    texture: 'eris.jpg', orbit: { type: 'small', key: 'Eris' },
    blurb: 'The most massive known dwarf planet, 27% heavier than Pluto. Its discovery in 2005 led to the 2006 redefinition of "planet".', textureNote: 'Texture is an artist\'s impression.',
  },
  {
    id: 'sedna', name: 'Sedna', kind: 'dwarf', parent: 'sun', radius: 500, mass: 1e21, color: 0xc86a4a, regolith: 0.9, albedo: 0.32, procedural: 'rock',
    orbit: { type: 'small', key: 'Sedna' },
    blurb: 'A detached object on an ~11,000 year orbit that never comes closer than 76 AU; it reaches perihelion in 2076.',
  },
  {
    id: 'halley', name: 'Halley\'s Comet', kind: 'comet', parent: 'sun', radius: 5.5, mass: 2.2e14, color: 0xbfe8ff, regolith: 1, albedo: 0.04, procedural: 'rock',
    orbit: { type: 'small', key: 'Halley' },
    blurb: 'The most famous periodic comet, on a retrograde 76-year orbit. Last perihelion 9 February 1986; next in July 2061.',
  },
];

export const BODY_BY_ID = new Map(BODIES.map((b) => [b.id, b]));
