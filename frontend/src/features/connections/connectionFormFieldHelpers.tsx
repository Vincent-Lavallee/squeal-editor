import type { CSSProperties, ReactNode } from 'react';

import * as t from '../../common/tokens';

/** Optional is the exception here, so only the exceptions are labelled. */
export const OPTIONAL: ReactNode = <span>(optional)</span>;
/** What a field says once a submit has found it empty. */
export const REQUIRED: ReactNode = <span style={{ color: t.RED_TEXT }}>required</span>;

export const requiredHint = (isInvalid: boolean): ReactNode => (isInvalid ? REQUIRED : undefined);
export const invalidBox = (isInvalid: boolean): CSSProperties | undefined =>
    isInvalid ? { borderColor: t.RED } : undefined;
