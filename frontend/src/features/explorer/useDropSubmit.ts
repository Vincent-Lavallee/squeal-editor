import { useState } from 'react';

export function useDropSubmit(onConfirm: () => Promise<void>, matches: boolean) {
    const [error, setError] = useState<string | null>(null);
    const [dropping, setDropping] = useState(false);

    async function submit(): Promise<void> {
        if (!matches || dropping) return;
        setDropping(true);
        setError(null);
        try {
            await onConfirm();
        } catch (err) {
            setError(
                typeof err === 'string' ? err : err instanceof Error ? err.message : String(err),
            );
            setDropping(false);
        }
    }

    return { error, dropping, submit };
}
