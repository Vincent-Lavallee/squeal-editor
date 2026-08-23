import type { Engine } from '../../common/db/engines.ts';
import Input from '../../common/components/Input.tsx';
import Field from '../../common/components/Field.tsx';
import { invalidBox, OPTIONAL, requiredHint } from './connectionFormFieldHelpers.tsx';

interface Props {
    engine: Engine;
    host: string;
    hostInvalid: boolean;
    port: string;
    database: string;
    onHostChange: (value: string) => void;
    onPortChange: (value: string) => void;
    onDatabaseChange: (value: string) => void;
}

export default function ConnectionServerFields({
    engine,
    host,
    hostInvalid,
    port,
    database,
    onHostChange,
    onPortChange,
    onDatabaseChange,
}: Props) {
    return (
        <>
            <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                    <Field label="Host" htmlFor="host" hint={requiredHint(hostInvalid)}>
                        <Input
                            id="host"
                            value={host}
                            aria-invalid={hostInvalid || undefined}
                            style={invalidBox(hostInvalid)}
                            onChange={(e) => onHostChange(e.target.value)}
                        />
                    </Field>
                </div>
                <div style={{ width: 108 }}>
                    <Field label="Port" hint={OPTIONAL} htmlFor="port">
                        <Input
                            id="port"
                            value={port}
                            placeholder={String(engine.defaultPort)}
                            onChange={(e) => onPortChange(e.target.value)}
                        />
                    </Field>
                </div>
            </div>

            <Field
                label="Database"
                htmlFor="database"
                hint={engine.value === 'postgres' ? <span>(default: postgres)</span> : OPTIONAL}
            >
                <Input
                    id="database"
                    value={database}
                    onChange={(e) => onDatabaseChange(e.target.value)}
                />
            </Field>
        </>
    );
}
