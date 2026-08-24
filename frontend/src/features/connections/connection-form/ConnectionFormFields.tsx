import type {
    EngineType,
    EnvironmentDef,
    SavedConnection,
} from '../../../../../shared/protocol/index.ts';
import { ENGINES } from '../../../common/db/engines.ts';
import Input from '../../../common/components/Input.tsx';
import Select from '../../../common/components/Select.tsx';
import Field from '../../../common/components/Field.tsx';
import ConnectionAddressFields from './ConnectionAddressFields.tsx';
import ConnectionColorEnvironmentField from './ConnectionColorEnvironmentField.tsx';
import { invalidBox, requiredHint } from './connectionFormFieldHelpers.tsx';
import type { useConnectionForm } from '../hooks/useConnectionForm.ts';

interface Props {
    f: ReturnType<typeof useConnectionForm>;
    mode: 'new' | 'edit';
    initial: SavedConnection | undefined;
    environments: EnvironmentDef[];
    busy: boolean;
}

/**
 * Everything above the Options section: which engine, what to call it, its
 * colour and environment, and however the address and credentials for that
 * engine are collected. Split out of `ConnectionForm` purely for length.
 */
export default function ConnectionFormFields({ f, mode, initial, environments, busy }: Props) {
    return (
        <>
            {/* First, because it decides which of the fields below even exist -- a
          file engine has no host, no port and no authentication at all. Asked
          last, every answer above it was given without knowing that. */}
            <Field label="Engine" htmlFor="type">
                <Select
                    id="type"
                    value={f.form.type}
                    onSelect={(value) => f.setEngine(value as EngineType)}
                    options={ENGINES.map((e) => ({ value: e.value, label: e.label }))}
                />
            </Field>

            <Field label="Name" htmlFor="name" hint={requiredHint(f.invalid('name'))}>
                <Input
                    id="name"
                    value={f.form.name}
                    autoFocus
                    placeholder={mode === 'edit' ? '' : 'prod-analytics'}
                    aria-invalid={f.invalid('name') || undefined}
                    style={invalidBox(f.invalid('name'))}
                    onChange={(e) => f.set('name', e.target.value)}
                />
            </Field>

            <ConnectionColorEnvironmentField
                environments={environments}
                environment={f.form.environment}
                color={f.form.color}
                picking={f.picking}
                onPickingChange={f.setPicking}
                onColorChange={(color) => f.set('color', color)}
                onEnvironmentChange={(environment, readOnly) => {
                    f.set('environment', environment);
                    f.set('readOnly', readOnly);
                }}
            />

            <ConnectionAddressFields f={f} mode={mode} initial={initial} busy={busy} />
        </>
    );
}
