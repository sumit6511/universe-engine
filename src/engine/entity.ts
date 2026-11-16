import { Vector3 } from 'three';
import { PC_KM } from '../core/constants';

export type EntityKind =
  | 'star' | 'planet' | 'dwarf' | 'moon' | 'asteroid' | 'comet' | 'exoplanet'
  | 'blackhole' | 'galaxy' | 'cluster' | 'region' | 'spacecraft';

export interface InfoRow { k: string; v: string; hint?: string }
export interface InfoData {
  title: string;
  subtitle: string;
  blurb?: string;
  rows: InfoRow[];
  notes?: string[];
  /** related things the user can jump to */
  links?: { label: string; get: () => Entity | null }[];
}

/**
 * Anything the camera can focus on.
 *
 * Positions are split in two for precision across 20 orders of magnitude:
 * `anchor` is the position of the entity's system in parsecs (world frame,
 * heliocentric) and `local` is the offset from that anchor in kilometres.
 * Bodies in the same system share an anchor, so their relative positions are
 * exact to the millimetre even tens of megaparsecs from the Sun.
 */
export class Entity {
  anchor = new Vector3();
  local = new Vector3();
  radiusKm = 1;
  /** closest allowed camera distance (centre to camera), km */
  minDistKm = 0;
  /** distance used when flying to this entity */
  viewDistKm = 0;
  parent: Entity | null = null;
  color = 0xffffff;
  subtitle = '';
  searchTerms = '';
  /** higher = shown first when labels compete */
  rank = 0;
  getInfo: (() => InfoData) | null = null;
  /** called when this entity becomes / stops being the camera focus */
  onFocus: ((on: boolean) => void) | null = null;

  constructor(public id: string, public name: string, public kind: EntityKind) {}

  /** Vector from `from` to this entity in kilometres. */
  relativeTo(fromAnchor: Vector3, fromLocal: Vector3, out: Vector3): Vector3 {
    out.subVectors(this.anchor, fromAnchor).multiplyScalar(PC_KM);
    out.x += this.local.x - fromLocal.x;
    out.y += this.local.y - fromLocal.y;
    out.z += this.local.z - fromLocal.z;
    return out;
  }

  get minDist(): number {
    return this.minDistKm || this.radiusKm * 1.3;
  }
  get viewDist(): number {
    return this.viewDistKm || this.radiusKm * 4.2;
  }
}
