import type { Engine } from '../../../common/db/engines.ts';
import Select from '../../../common/components/Select.tsx';
import Input from '../../../common/components/Input.tsx';
import Field from '../../../common/components/Field.tsx';
import { OPTIONAL } from './connectionFormFieldHelpers.tsx';
import type { AuthMethod } from './connectionFormTypes.ts';

interface Props {
    engine: Engine;
    authMethod: AuthMethod;
    user: string;
    onAuthMethodChange: (method: AuthMethod) => void;
    onUserChange: (value: string) => void;
}

export default function ConnectionAuthMethodFields({
    engine,
    authMethod,
    user,
    onAuthMethodChange,
    onUserChange,
}: Props) {
    return (
        <>
            <Field label="Method" htmlFor="authMethod">
                <Select
                    id="authMethod"
                    value={authMethod}
                    onSelect={(value) => onAuthMethodChange(value as AuthMethod)}
                    options={[
                        { value: 'password', label: 'Password' },
                        { value: 'iam', label: 'AWS IAM (RDS)' },
                    ]}
                />
            </Field>

            <Field label="Database user" hint={OPTIONAL} htmlFor="user">
                <Input
                    id="user"
                    value={user}
                    placeholder={engine.defaultUser}
                    onChange={(e) => onUserChange(e.target.value)}
                />
            </Field>
        </>
    );
}
