import type { ConnectionColorId, EnvironmentDef } from '../../../../shared/protocol/index.ts';
import { connectionColor } from '../../common/icons/connectionColors.ts';
import Select from '../../common/components/Select.tsx';
import Field from '../../common/components/Field.tsx';
import { readOnlyDefault } from './connectionFormLogic.ts';
import type { FormState } from './connectionFormTypes.ts';
import { swatchDot, swatchTile } from './connectionColorSwatchStyles.ts';

interface Props {
    environments: EnvironmentDef[];
    environment: string;
    color: ConnectionColorId;
    onEnvironmentChange: (environment: string, readOnly: boolean) => void;
    onOpenPicker: () => void;
}

export default function ConnectionEnvironmentRow({
    environments,
    environment,
    color,
    onEnvironmentChange,
    onOpenPicker,
}: Props) {
    return (
        <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <Field label="Environment" htmlFor="environment">
                    <Select
                        id="environment"
                        value={environment}
                        options={environments.map((env) => ({ value: env.name, label: env.name }))}
                        onSelect={(value: FormState['environment']) =>
                            onEnvironmentChange(value, readOnlyDefault(value))
                        }
                    />
                </Field>
            </div>
            <Field label="Color">
                <button
                    type="button"
                    data-testid="color-open"
                    style={swatchTile}
                    aria-expanded={false}
                    aria-label={`Color: ${color}. Choose another`}
                    onClick={onOpenPicker}
                >
                    <span
                        aria-hidden="true"
                        style={{ ...swatchDot, background: connectionColor(color) }}
                    />
                </button>
            </Field>
        </div>
    );
}
