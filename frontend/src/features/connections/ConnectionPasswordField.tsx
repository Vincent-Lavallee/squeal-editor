import Checkbox from '../../common/components/Checkbox.tsx';
import Input from '../../common/components/Input.tsx';
import Field from '../../common/components/Field.tsx';
import * as t from '../../common/tokens';
import { OPTIONAL } from './connectionFormFieldHelpers.tsx';

interface Props {
    password: string;
    passwordUsed: boolean;
    keepPlaceholder: boolean;
    savePassword: boolean;
    onPasswordChange: (value: string) => void;
    onSavePasswordChange: (value: boolean) => void;
}

export default function ConnectionPasswordField({
    password,
    passwordUsed,
    keepPlaceholder,
    savePassword,
    onPasswordChange,
    onSavePasswordChange,
}: Props) {
    return (
        <Field label="Password" hint={OPTIONAL} htmlFor="password">
            <Input
                id="password"
                type="password"
                value={password}
                disabled={!passwordUsed}
                placeholder={keepPlaceholder ? 'unchanged' : ''}
                onChange={(e) => onPasswordChange(e.target.value)}
            />
            <div style={{ marginTop: t.GAP_XS }}>
                <Checkbox
                    id="savePassword"
                    label="Save the password"
                    hint="otherwise you are asked for it each time"
                    checked={savePassword}
                    onChange={(e) => onSavePasswordChange(e.target.checked)}
                />
            </div>
        </Field>
    );
}
