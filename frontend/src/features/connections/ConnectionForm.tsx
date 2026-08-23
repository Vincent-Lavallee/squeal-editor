import type { EnvironmentDef, SavedConnection } from '../../../../shared/protocol/index.ts';
import ConnectionFormActions from './ConnectionFormActions.tsx';
import ConnectionFormFields from './ConnectionFormFields.tsx';
import ConnectionFormSection from './ConnectionFormSection.tsx';
import ConnectionOptionsFields from './ConnectionOptionsFields.tsx';
import ConnectionTestResult from './ConnectionTestResult.tsx';
import { serverConfig } from './connectionFormLogic.ts';
import type { FormValues } from './connectionFormTypes.ts';
import { useConnectionForm } from './hooks/useConnectionForm.ts';
import * as t from '../../common/tokens';

export type { FormValues } from './connectionFormTypes.ts';

interface Props {
    mode: 'new' | 'edit';
    initial?: SavedConnection;
    environments: EnvironmentDef[];
    onSubmit: (values: FormValues) => void;
    onCancel?: () => void;
    busy: boolean;
    /**
     * Set only while a connect this form started is still in flight, and it is
     * what puts the actions row into its abort state. Absent means there is
     * nothing to stop -- including on the edit form, which saves rather than
     * connects and so never passes one.
     */
    onAbortConnect?: () => void;
    /** Seconds since that attempt began, ticked by the screen that owns the clock. */
    connectingElapsed?: number;
}

export default function ConnectionForm({
    mode,
    initial,
    environments,
    onSubmit,
    onCancel,
    busy,
    onAbortConnect,
    connectingElapsed,
}: Props) {
    const f = useConnectionForm({
        mode,
        initial,
        defaultEnvironment: environments[0]?.name ?? '',
        onSubmit,
        connectInFlight: onAbortConnect !== undefined,
        busy,
    });

    return (
        // `noValidate`: the browser's own bubble is the very "you may not submit
        // this" the form has stopped saying, and it fires before the handler runs.
        <form
            noValidate
            style={{ display: 'flex', flexDirection: 'column', gap: t.GAP }}
            onSubmit={f.handleSubmit}
        >
            <ConnectionFormFields
                f={f}
                mode={mode}
                initial={initial}
                environments={environments}
                busy={busy}
            />

            <ConnectionFormSection label="Options" />
            <ConnectionOptionsFields
                readOnly={f.form.readOnly}
                fileBased={f.fileBased}
                ssl={f.form.ssl}
                iam={f.iam}
                onReadOnlyChange={(value) => f.set('readOnly', value)}
                onSslChange={(value) => f.set('ssl', value)}
            />

            <ConnectionFormActions
                actionsRef={f.actions}
                mode={mode}
                busy={busy}
                testing={f.testing}
                testable={f.testable}
                onTest={() => f.test(serverConfig(f.form, f.iam), f.testPassword)}
                onCancel={onCancel}
                onAbortConnect={onAbortConnect}
                connectingElapsed={connectingElapsed}
            />

            <ConnectionTestResult
                engineLabel={f.engine.label}
                serverVersion={f.serverVersion}
                testError={f.testError}
            />
        </form>
    );
}
