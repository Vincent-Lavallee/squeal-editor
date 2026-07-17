import type { Environment } from '../../shared/protocol.ts';

/**
 * The environments a connection can sit in, in the order they are shown.
 *
 * The order is the point of the list existing rather than a bare union: a
 * workspace's connections group under these headings, and Local-to-Production is
 * the order everyone already reads a deployment pipeline in. Alphabetical would
 * put Production second.
 *
 * It sits in `src/` beside `engines.ts` for the same reason that one does: the
 * connect form and the grouped list both need it, and a second copy is how the
 * two drift apart.
 */
export interface EnvironmentOption {
  value: Environment;
  label: string;
}

export const ENVIRONMENTS: EnvironmentOption[] = [
  { value: 'local', label: 'Local' },
  { value: 'dev', label: 'Dev' },
  { value: 'staging', label: 'Staging' },
  { value: 'production', label: 'Production' },
];

/**
 * What a connection gets when nobody has said otherwise -- the same answer the
 * store gives a row saved before environments existed, and for the same reason:
 * the guess that costs least is the one that never claims something is
 * Production.
 */
export const DEFAULT_ENVIRONMENT: Environment = 'local';

export const environmentLabel = (value: Environment): string =>
  ENVIRONMENTS.find((e) => e.value === value)?.label ?? ENVIRONMENTS[0]!.label;
