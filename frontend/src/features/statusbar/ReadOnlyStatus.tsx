import { useState } from 'react';

import ReadOnlyConfirm from './ReadOnlyConfirm.tsx';
import ReadOnlyLock from './ReadOnlyLock.tsx';

interface Props {
    connectionId: string;
    readOnly: boolean;
    environment: string;
    name: string;
    setReadOnly: (connectionId: string, value: boolean) => Promise<unknown>;
}

/** The read-only lock and the confirmation it opens to turn writes back on --
 *  split out of `StatusBar` purely for length. */
export default function ReadOnlyStatus({
    connectionId,
    readOnly,
    environment,
    name,
    setReadOnly,
}: Props) {
    const [confirming, setConfirming] = useState(false);

    function toggle(): void {
        if (readOnly) setConfirming(true);
        else void setReadOnly(connectionId, true);
    }

    return (
        <>
            <ReadOnlyLock readOnly={readOnly} onToggle={toggle} />
            {confirming && (
                <ReadOnlyConfirm
                    environment={environment}
                    name={name}
                    onConfirm={() => {
                        setConfirming(false);
                        void setReadOnly(connectionId, false);
                    }}
                    onCancel={() => setConfirming(false)}
                />
            )}
        </>
    );
}
