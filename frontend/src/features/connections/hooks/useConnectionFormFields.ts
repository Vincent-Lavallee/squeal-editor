import { useState } from 'react';

import type { EngineType, SavedConnection } from '../../../../../shared/protocol/index.ts';
import { engineByType, isFileBased } from '../../../common/db/engines.ts';
import {
    browseForSqliteFile,
    initialFormState,
    missingFields,
    submitValues,
} from '../connectionFormLogic.ts';
import type { AuthMethod, FormState, RequiredField } from '../connectionFormTypes.ts';

function setAuthMethodOn(
    setForm: React.Dispatch<React.SetStateAction<FormState>>,
    method: AuthMethod,
): void {
    setForm((prev) => ({ ...prev, authMethod: method, ssl: method === 'iam' ? true : prev.ssl }));
}

/**
 * Switching between a server engine and a file engine clears the address,
 * because `database` means a different thing on each side of that line -- a
 * database name over there, a path to a file here. Carrying `postgres` across
 * would offer it as a filename.
 */
function setEngineOn(
    setForm: React.Dispatch<React.SetStateAction<FormState>>,
    type: EngineType,
): void {
    setForm((prev) =>
        isFileBased(prev.type) === isFileBased(type)
            ? { ...prev, type }
            : { ...prev, type, database: '' },
    );
}

/**
 * The form's own field state and mutators -- everything in `useConnectionForm`
 * that is not about verifying the result. See `useConnectionFormTest.ts` for
 * the other half.
 */
export function useConnectionFormFields(args: {
    mode: 'new' | 'edit';
    initial: SavedConnection | undefined;
    defaultEnvironment: string;
    onSubmit: (values: ReturnType<typeof submitValues>) => void;
}) {
    const { mode, initial, defaultEnvironment, onSubmit } = args;
    const [form, setForm] = useState<FormState>(() =>
        initialFormState(initial, defaultEnvironment),
    );
    const [picking, setPicking] = useState(false);
    // Nothing is marked wrong until a submit has actually looked. A form that
    // reddens a field you have not reached yet is scolding you for not having
    // typed fast enough.
    const [submitted, setSubmitted] = useState(false);
    const engine = engineByType(form.type);

    function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
        setForm((prev) => ({ ...prev, [key]: value }));
    }

    const fileBased = isFileBased(form.type);
    // A file has no auth of any kind, so IAM cannot be in play even if the select
    // was left on it before the engine changed.
    const iam = !fileBased && form.authMethod === 'iam';
    const passwordUsed = mode === 'new' || form.savePassword;

    const missing = missingFields(form, iam, fileBased);
    const invalid = (field: RequiredField): boolean => submitted && missing.includes(field);

    async function browseForFile(): Promise<void> {
        const chosen = await browseForSqliteFile();
        if (chosen !== null) set('database', chosen);
    }

    /**
     * Submitting is always allowed, and an incomplete form answers by saying which
     * fields are empty rather than by having refused the click in the first place.
     * A disabled button states that something is wrong and nothing about what.
     */
    function handleSubmit(e: React.FormEvent): void {
        e.preventDefault();
        if (missing.length > 0) {
            setSubmitted(true);
            document.getElementById(missing[0]!)?.focus();
            return;
        }
        onSubmit(submitValues(form, iam, fileBased));
    }

    return {
        form,
        set,
        picking,
        setPicking,
        engine,
        fileBased,
        iam,
        passwordUsed,
        missing,
        invalid,
        setAuthMethod: (method: AuthMethod) => setAuthMethodOn(setForm, method),
        setEngine: (type: EngineType) => setEngineOn(setForm, type),
        browseForFile,
        handleSubmit,
    };
}
