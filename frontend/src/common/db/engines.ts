import type { EngineType } from '../../../../shared/protocol/index.ts';

/**
 * The only engine-specific knowledge the UI is allowed to hold: a label, and
 * what to fall back to when the connect form is left blank. Nothing here knows
 * a dialect, a quoting rule or a catalog -- that lives in the drivers.
 *
 * It is shared rather than owned by the connect form because the toolbar needs
 * the label too, and a second copy of this table is how the two drift apart.
 */
export interface Engine {
  value: EngineType;
  label: string;
  defaultPort: number;
  defaultUser: string;
}

export const ENGINES: Engine[] = [
  { value: 'postgres', label: 'PostgreSQL', defaultPort: 5432, defaultUser: 'postgres' },
  { value: 'mysql', label: 'MySQL', defaultPort: 3306, defaultUser: 'root' },
];

export const engineByType = (type: EngineType): Engine =>
  ENGINES.find((e) => e.value === type) ?? ENGINES[0]!;

export const engineLabel = (type: EngineType): string => engineByType(type).label;
