import type { App } from '../app';
import { AU_KM, KPC_KM, LY_KM, MPC_KM } from '../core/constants';
import type { Entity } from '../engine/entity';

export interface TourStep {
  title: string;
  text: string;
  target: (app: App) => Entity | null;
  dist?: (e: Entity) => number;
  pitch?: number;
  /** camera auto-rotation, rad/s */
  spin?: number;
  /** time-rate index (see TIME_RATES) */
  rate?: number;
}

/** A guided journey outward through 20 orders of magnitude. */
export const TOUR: TourStep[] = [
  {
    title: 'Earth, right now',
    text: 'The day–night line, the tilt of the axis and the Moon’s position are computed for this moment. The thin blue rim is a physically ray-marched atmosphere 100 km deep on a planet 12,742 km wide.',
    target: (a) => a.find('Earth'), dist: (e) => e.radiusKm * 3.6, pitch: -0.2, spin: 0.05, rate: 3,
  },
  {
    title: 'The Moon',
    text: '384,400 km away — thirty Earth diameters, or 1.3 light-seconds. It keeps one face toward us because tides have locked its rotation to its orbit.',
    target: (a) => a.find('Moon'), pitch: -0.12, spin: 0.06, rate: 3,
  },
  {
    title: 'The Sun',
    text: 'A 5,772 K ball of plasma 109 Earths across. Sunlight takes 8 minutes 20 seconds to reach Earth. The darker edge is limb darkening: at the rim we see cooler, higher layers.',
    target: (a) => a.find('Sun'), dist: (e) => e.radiusKm * 5.5, pitch: -0.1, spin: 0.03, rate: 3,
  },
  {
    title: 'Jupiter and its moons',
    text: 'Io, Europa and Ganymede orbit in a 4:2:1 resonance. Time is running at six hours per second; watch for moon shadows crossing the cloud tops.',
    target: (a) => a.find('Jupiter'), dist: (e) => e.radiusKm * 14, pitch: -0.14, spin: 0.02, rate: 4,
  },
  {
    title: 'Saturn',
    text: 'The rings are 280,000 km across and about ten metres thick. The planet’s shadow falls across them, and theirs falls back on the planet, at the true angle for today’s date.',
    target: (a) => a.find('Saturn'), dist: (e) => e.radiusKm * 8, pitch: -0.3, spin: 0.03, rate: 3,
  },
  {
    title: 'The solar system',
    text: 'Eight planets on orbits from NASA/JPL elements, and 40,000 real asteroids and Kuiper-belt objects, each following its own Kepler orbit. A month passes every second.',
    target: (a) => a.find('Sun'), dist: () => 70 * AU_KM, pitch: -0.95, spin: 0.02, rate: 7,
  },
  {
    title: 'Alpha Centauri',
    text: 'The nearest star system, 4.37 light-years away. At the speed of the fastest spacecraft ever launched, the trip would take about 7,000 years.',
    target: (a) => a.find('Rigil Kentaurus'), dist: (e) => e.radiusKm * 30, pitch: -0.15, spin: 0.03, rate: 3,
  },
  {
    title: 'The stars we know',
    text: 'Every point is a real star at its measured distance: 113,000 of them. The constellations are figures of chance alignment; from here, 60 light-years out, they have already begun to distort.',
    target: (a) => a.find('Sun'), dist: () => 60 * LY_KM, pitch: -0.35, spin: 0.04, rate: 3,
  },
  {
    title: 'The Milky Way',
    text: 'A barred spiral 100,000 light-years across. The arms follow radio parallax measurements of star-forming regions; the Sun sits in a minor spur, 26,600 light-years from the centre.',
    target: (a) => a.find('Milky Way'), dist: () => 42 * KPC_KM, pitch: -1.0, spin: 0.02,
  },
  {
    title: 'Sagittarius A*',
    text: 'At the centre of the galaxy, four million solar masses in a region smaller than Mercury’s orbit. Light rays are traced through curved spacetime: the bright ring is starlight bent right around the hole.',
    target: (a) => a.find('Sagittarius A*') ?? a.find('Milky Way'), pitch: -0.12, spin: 0.05,
  },
  {
    title: 'Andromeda',
    text: 'The nearest large galaxy, 2.5 million light-years away and closing at 110 km/s. The light you would see from here left before our species existed.',
    target: (a) => a.find('Andromeda Galaxy') ?? a.find('M31'), pitch: -0.5, spin: 0.03,
  },
  {
    title: 'The Local Group',
    text: 'Our galaxy, Andromeda, Triangulum and some eighty dwarfs, bound together by gravity in a volume ten million light-years across.',
    target: (a) => a.find('Milky Way'), dist: () => 2.6 * MPC_KM, pitch: -0.6, spin: 0.03,
  },
  {
    title: 'The Virgo Cluster',
    text: 'Fifty-four million light-years away: more than a thousand galaxies falling into a common well, and the heart of our local supercluster. Every galaxy shown is a real catalogued object.',
    target: (a) => a.find('Virgo Cluster'), dist: () => 14 * MPC_KM, pitch: -0.3, spin: 0.03,
  },
  {
    title: 'The cosmic web',
    text: 'On the largest scales, matter forms filaments and walls around empty voids. This structure is computed from the ΛCDM model: quantum ripples in the early universe, amplified by 13.8 billion years of gravity.',
    target: (a) => a.find('Milky Way'), dist: () => 520 * MPC_KM, pitch: -0.4, spin: 0.025,
  },
  {
    title: 'The observable universe',
    text: 'Ninety-three billion light-years across. Looking outward is looking back in time: past the first galaxies to the glowing wall of the cosmic microwave background, 380,000 years after the Big Bang. Beyond it, light has not yet had time to reach us.',
    target: (a) => a.find('Observable Universe'), pitch: -0.3, spin: 0.03,
  },
];
