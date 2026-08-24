import Button from '../../../common/components/Button.tsx';
import Input from '../../../common/components/Input.tsx';
import Field from '../../../common/components/Field.tsx';
import * as t from '../../../common/tokens';
import { invalidBox, requiredHint } from './connectionFormFieldHelpers.tsx';

interface Props {
    database: string;
    invalid: boolean;
    busy: boolean;
    onChange: (value: string) => void;
    onBrowse: () => void;
}

export default function ConnectionFileField({
    database,
    invalid,
    busy,
    onChange,
    onBrowse,
}: Props) {
    return (
        <Field label="Database file" htmlFor="database" hint={requiredHint(invalid)}>
            <div style={{ display: 'flex', gap: t.GAP_SM }}>
                <div style={{ flex: 1 }}>
                    <Input
                        id="database"
                        value={database}
                        placeholder="C:\path\to\app.db"
                        aria-invalid={invalid || undefined}
                        style={invalidBox(invalid)}
                        onChange={(e) => onChange(e.target.value)}
                    />
                </div>
                {/* Typing or pasting a path stays possible beside the dialog: when you
              already have the path, that is the shorter route to it. */}
                <Button onClick={onBrowse} disabled={busy}>
                    Browse…
                </Button>
            </div>
        </Field>
    );
}
