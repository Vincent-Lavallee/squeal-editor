import type { SavedConnection } from '../../../../../shared/protocol/index.ts';
import type { submitValues } from '../connection-form/connectionFormLogic.ts';
import { useConnectionFormFields } from './useConnectionFormFields.ts';
import { useConnectionFormTest } from './useConnectionFormTest.ts';

/**
 * Every piece of state and derived value `ConnectionForm` and its field groups
 * need, split out purely for length. Composes `useConnectionFormFields.ts`
 * (the fields themselves) and `useConnectionFormTest.ts` (verifying them).
 */
export function useConnectionForm(args: {
    mode: 'new' | 'edit';
    initial: SavedConnection | undefined;
    defaultEnvironment: string;
    onSubmit: (values: ReturnType<typeof submitValues>) => void;
    connectInFlight: boolean;
    busy: boolean;
}) {
    const { mode, initial, defaultEnvironment, onSubmit, connectInFlight, busy } = args;
    const fields = useConnectionFormFields({ mode, initial, defaultEnvironment, onSubmit });
    const testState = useConnectionFormTest({
        form: fields.form,
        mode,
        initial,
        iam: fields.iam,
        fileBased: fields.fileBased,
        busy,
        connectInFlight,
    });

    return { ...fields, ...testState };
}
