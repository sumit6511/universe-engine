// A curated set of well-known nebulae, star clusters and pulsars with measured distances.
// Coordinates are J2000 (degrees); distances in parsecs and radii in parsecs are representative
// literature values (Gaia cluster distances, expansion parallaxes, pulsar timing / VLBI).

export type DeepSkyType = 'emission' | 'planetary' | 'remnant' | 'open' | 'globular' | 'pulsar';

export interface DeepSkyDef {
  name: string; alt?: string; type: DeepSkyType; ra: number; dec: number; dist: number; radius: number;
  /** pulsar spin period, seconds */
  period?: number;
  blurb: string;
}

export const DEEP_SKY: DeepSkyDef[] = [
  { name: 'Orion Nebula', alt: 'M42', type: 'emission', ra: 83.82, dec: -5.39, dist: 412, radius: 3.7, blurb: 'The nearest massive star-forming region. Four young stars, the Trapezium, light up a cavity in a cloud that is still collapsing into hundreds of new suns.' },
  { name: 'Lagoon Nebula', alt: 'M8', type: 'emission', ra: 270.92, dec: -24.38, dist: 1250, radius: 17, blurb: 'A giant cloud of glowing hydrogen in Sagittarius, visible to the naked eye from dark sites.' },
  { name: 'Trifid Nebula', alt: 'M20', type: 'emission', ra: 270.6, dec: -23.03, dist: 1260, radius: 6, blurb: 'Emission, reflection and dark nebulae in one object, split three ways by dust lanes.' },
  { name: 'Eagle Nebula', alt: 'M16', type: 'emission', ra: 274.7, dec: -13.8, dist: 1740, radius: 10, blurb: 'Home of the Pillars of Creation: columns of cold gas several light-years tall being eroded by the light of newborn stars.' },
  { name: 'Omega Nebula', alt: 'M17', type: 'emission', ra: 275.2, dec: -16.18, dist: 1700, radius: 6, blurb: 'One of the brightest star-forming regions in the galaxy, holding some 800 solar masses of gas.' },
  { name: 'Carina Nebula', alt: 'NGC 3372', type: 'emission', ra: 161.27, dec: -59.87, dist: 2300, radius: 35, blurb: 'Four times larger than the Orion Nebula, and home to Eta Carinae, a star system more than a hundred times the mass of the Sun that may explode at any time.' },
  { name: 'Rosette Nebula', alt: 'NGC 2237', type: 'emission', ra: 97.98, dec: 4.94, dist: 1600, radius: 20, blurb: 'A ring of gas hollowed out by the winds of the young cluster at its centre.' },
  { name: 'North America Nebula', alt: 'NGC 7000', type: 'emission', ra: 314.7, dec: 44.3, dist: 795, radius: 15, blurb: 'An emission nebula near Deneb whose outline, shaped by a foreground dust cloud, resembles the continent.' },
  { name: 'Horsehead Nebula', alt: 'Barnard 33', type: 'emission', ra: 85.24, dec: -2.46, dist: 400, radius: 1.5, blurb: 'A dark pillar of dust silhouetted against glowing hydrogen, just south of Orion’s Belt.' },
  { name: 'Ring Nebula', alt: 'M57', type: 'planetary', ra: 283.396, dec: 33.029, dist: 790, radius: 0.2, blurb: 'The cast-off outer layers of a Sun-like star, lit by the white dwarf left at the centre. The Sun will end this way in about five billion years.' },
  { name: 'Dumbbell Nebula', alt: 'M27', type: 'planetary', ra: 299.9, dec: 22.72, dist: 389, radius: 0.45, blurb: 'The first planetary nebula ever discovered (Messier, 1764).' },
  { name: 'Helix Nebula', alt: 'NGC 7293', type: 'planetary', ra: 337.41, dec: -20.84, dist: 200, radius: 0.45, blurb: 'One of the closest planetary nebulae, covering half the width of the full Moon in our sky.' },
  { name: 'Cat’s Eye Nebula', alt: 'NGC 6543', type: 'planetary', ra: 269.64, dec: 66.63, dist: 1000, radius: 0.1, blurb: 'Eleven concentric shells record pulses of mass loss every 1,500 years from the dying star.' },
  { name: 'Crab Nebula', alt: 'M1', type: 'remnant', ra: 83.633, dec: 22.014, dist: 2000, radius: 1.7, blurb: 'The remains of a supernova recorded by Chinese astronomers in 1054. It is still expanding at 1,500 km/s, powered by the pulsar at its heart.' },
  { name: 'Veil Nebula', alt: 'Cygnus Loop', type: 'remnant', ra: 312.75, dec: 30.67, dist: 735, radius: 18, blurb: 'Filaments of shocked gas from a star that exploded about 20,000 years ago.' },
  { name: 'Vela Supernova Remnant', type: 'remnant', ra: 128.5, dec: -45.83, dist: 290, radius: 20, blurb: 'One of the nearest supernova remnants, from an explosion some 11,000 years ago.' },
  { name: 'Cassiopeia A', type: 'remnant', ra: 350.85, dec: 58.815, dist: 3400, radius: 1.5, blurb: 'The youngest known remnant in the galaxy: its light first reached Earth around 1680. The brightest radio source in the sky beyond the solar system.' },
  { name: 'Pleiades', alt: 'M45', type: 'open', ra: 56.75, dec: 24.12, dist: 136, radius: 2.7, blurb: 'A cluster of about a thousand stars only 100 million years old. Its brightest members are individually present in the star catalogue shown here.' },
  { name: 'Hyades', type: 'open', ra: 66.75, dec: 15.87, dist: 47, radius: 5, blurb: 'The nearest open cluster, forming the face of Taurus. Its distance anchors the cosmic distance ladder.' },
  { name: 'Beehive Cluster', alt: 'M44', type: 'open', ra: 130.1, dec: 19.67, dist: 187, radius: 3.5, blurb: 'A naked-eye cluster in Cancer; two of its Sun-like stars are known to host planets.' },
  { name: 'Double Cluster', alt: 'h and χ Persei', type: 'open', ra: 34.75, dec: 57.15, dist: 2300, radius: 9, blurb: 'Two young, massive clusters side by side, each with thousands of stars about 14 million years old.' },
  { name: 'Ptolemy Cluster', alt: 'M7', type: 'open', ra: 268.46, dec: -34.79, dist: 300, radius: 4, blurb: 'Described by Ptolemy in 130 AD as a "little cloud" following the sting of Scorpius.' },
  { name: 'Jewel Box', alt: 'NGC 4755', type: 'open', ra: 193.4, dec: -60.37, dist: 1950, radius: 3, blurb: 'A compact young cluster in the Southern Cross, named for its mix of blue and orange stars.' },
  { name: 'Wild Duck Cluster', alt: 'M11', type: 'open', ra: 282.77, dec: -6.27, dist: 1900, radius: 3.5, blurb: 'One of the richest open clusters known, with nearly 3,000 stars.' },
  { name: 'Omega Centauri', alt: 'NGC 5139', type: 'globular', ra: 201.7, dec: -47.48, dist: 5400, radius: 26, blurb: 'The largest globular cluster of the Milky Way: ten million stars, and probably the stripped core of a dwarf galaxy our own swallowed.' },
  { name: '47 Tucanae', alt: 'NGC 104', type: 'globular', ra: 6.02, dec: -72.08, dist: 4500, radius: 18, blurb: 'A dense ball of about a million ancient stars, home to at least 25 millisecond pulsars.' },
  { name: 'Hercules Cluster', alt: 'M13', type: 'globular', ra: 250.42, dec: 36.46, dist: 7100, radius: 22, blurb: 'Target of the 1974 Arecibo message. The signal will arrive in about 25,000 years.' },
  { name: 'Messier 4', alt: 'M4', type: 'globular', ra: 245.9, dec: -26.53, dist: 1850, radius: 10, blurb: 'The closest globular cluster to the Sun, 12.2 billion years old.' },
  { name: 'Messier 22', alt: 'M22', type: 'globular', ra: 279.1, dec: -23.9, dist: 3200, radius: 15, blurb: 'One of the brightest globulars, lying in front of the galactic bulge.' },
  { name: 'Messier 3', alt: 'M3', type: 'globular', ra: 205.55, dec: 28.38, dist: 10400, radius: 27, blurb: 'Half a million stars, including more variable stars than any other cluster.' },
  { name: 'Messier 15', alt: 'M15', type: 'globular', ra: 322.49, dec: 12.17, dist: 10900, radius: 26, blurb: 'One of the densest clusters known; its core has collapsed, perhaps around an intermediate-mass black hole.' },
  { name: 'Crab Pulsar', alt: 'PSR B0531+21', type: 'pulsar', ra: 83.6331, dec: 22.0145, dist: 2000, radius: 0.02, period: 0.0338, blurb: 'The neutron star left by the supernova of 1054, spinning 30 times a second and powering the Crab Nebula with the output of 100,000 Suns.' },
  { name: 'Vela Pulsar', alt: 'PSR B0833−45', type: 'pulsar', ra: 128.836, dec: -45.176, dist: 287, radius: 0.02, period: 0.0893, blurb: 'The brightest persistent gamma-ray source in the sky, spinning 11 times a second.' },
  { name: 'PSR B1919+21', alt: 'CP 1919', type: 'pulsar', ra: 290.44, dec: 21.88, dist: 300, radius: 0.02, period: 1.3373, blurb: 'The first pulsar, found by Jocelyn Bell in 1967. Its regular 1.34-second beat was briefly nicknamed LGM-1, for "little green men".' },
  { name: 'PSR J0437−4715', type: 'pulsar', ra: 69.316, dec: -47.253, dist: 157, radius: 0.02, period: 0.00576, blurb: 'The nearest millisecond pulsar, spinning 174 times a second with a stability that rivals atomic clocks.' },
  { name: 'Hulse–Taylor Pulsar', alt: 'PSR B1913+16', type: 'pulsar', ra: 288.87, dec: 16.11, dist: 6400, radius: 0.02, period: 0.0590, blurb: 'Two neutron stars orbiting every 7.75 hours. Their orbit shrinks exactly as general relativity predicts for energy lost to gravitational waves: the 1993 Nobel Prize.' },
  { name: 'Geminga', alt: 'PSR J0633+1746', type: 'pulsar', ra: 98.476, dec: 17.77, dist: 250, radius: 0.02, period: 0.2371, blurb: 'A nearby, radio-quiet pulsar discovered through its gamma rays. The supernova that made it may have carved the Local Bubble around the Sun.' },
];
