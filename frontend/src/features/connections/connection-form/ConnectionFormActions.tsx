import type { Ref } from 'react';

import * as t from '../../../common/tokens';
import ConnectionFormAbortActions from './ConnectionFormAbortActions.tsx';
import ConnectionFormSubmitActions from './ConnectionFormSubmitActions.tsx';

interface Props {
    actionsRef: Ref<HTMLDivElement>;
    mode: 'new' | 'edit';
    busy: boolean;
    testing: boolean;
    testable: boolean;
    onTest: () => void;
    onCancel?: () => void;
    onAbortConnect?: () => void;
    connectingElapsed?: number;
}

/**
 * One height across the row: a shorter Cancel and Test beside a taller Connect
 * read as two rows of controls that happen to be on one line.
 *
 * While a connect is in flight the row becomes the way to stop it. The screen
 * has an abort of its own, under everything, and on a form this tall that is
 * reliably below the fold -- so the attempt you just started could only be
 * called off by scrolling to find the button.
 */
export default function ConnectionFormActions({
    actionsRef,
    mode,
    busy,
    testing,
    testable,
    onTest,
    onCancel,
    onAbortConnect,
    connectingElapsed,
}: Props) {
    return (
        <div
            ref={actionsRef}
            data-testid="connect-actions"
            style={{ display: 'flex', gap: t.GAP_SM, marginTop: t.GAP_XS }}
        >
            {onAbortConnect ? (
                <ConnectionFormAbortActions
                    onAbortConnect={onAbortConnect}
                    connectingElapsed={connectingElapsed}
                />
            ) : (
                <ConnectionFormSubmitActions
                    mode={mode}
                    busy={busy}
                    testing={testing}
                    testable={testable}
                    onTest={onTest}
                    onCancel={onCancel}
                />
            )}
        </div>
    );
}
