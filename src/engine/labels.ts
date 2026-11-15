import type { Entity } from './entity';

export interface LabelSpec {
  x: number;
  y: number;
  text: string;
  /** higher wins when labels overlap */
  priority: number;
  color?: string;
  entity?: Entity;
  /** lazily create the entity when the label is clicked */
  resolve?: () => Entity | null;
  /** px gap between the object and its label */
  offset?: number;
  kind?: string;
  /** 0..1 */
  alpha?: number;
  /** stable key for DOM reuse (defaults to text) */
  key?: string;
}

export type AddLabel = (l: LabelSpec) => void;
