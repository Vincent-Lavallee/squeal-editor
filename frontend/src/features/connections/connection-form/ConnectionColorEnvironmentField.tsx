import type { ConnectionColorId, EnvironmentDef } from '../../../../../shared/protocol/index.ts';
import ConnectionColorPicker from './ConnectionColorPicker.tsx';
import ConnectionEnvironmentRow from './ConnectionEnvironmentRow.tsx';

interface Props {
    environments: EnvironmentDef[];
    environment: string;
    color: ConnectionColorId;
    picking: boolean;
    onPickingChange: (picking: boolean) => void;
    onColorChange: (color: ConnectionColorId) => void;
    onEnvironmentChange: (environment: string, readOnly: boolean) => void;
}

/**
 * The colour is a property of the same thing the environment is -- which
 * connection this is, rather than how to reach it -- so the two share a row.
 * Expanded, the picker takes the whole row over instead of floating a panel
 * above it: the swatches are the same 32px as the select they replace, so the
 * row is exactly as tall either way and nothing below moves.
 */
export default function ConnectionColorEnvironmentField({
    environments,
    environment,
    color,
    picking,
    onPickingChange,
    onColorChange,
    onEnvironmentChange,
}: Props) {
    if (picking) {
        return (
            <ConnectionColorPicker
                color={color}
                onChange={onColorChange}
                onClose={() => onPickingChange(false)}
            />
        );
    }

    return (
        <ConnectionEnvironmentRow
            environments={environments}
            environment={environment}
            color={color}
            onEnvironmentChange={onEnvironmentChange}
            onOpenPicker={() => onPickingChange(true)}
        />
    );
}
