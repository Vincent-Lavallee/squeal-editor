import type { Engine } from '../../common/db/engines.ts';
import ConnectionAuthMethodFields from './ConnectionAuthMethodFields.tsx';
import ConnectionFormSection from './ConnectionFormSection.tsx';
import ConnectionIamFields from './ConnectionIamFields.tsx';
import ConnectionPasswordField from './ConnectionPasswordField.tsx';
import type { AuthMethod } from './connectionFormTypes.ts';

interface Props {
    engine: Engine;
    authMethod: AuthMethod;
    user: string;
    iam: boolean;
    awsProfile: string;
    awsProfileInvalid: boolean;
    awsRegion: string;
    awsRegionInvalid: boolean;
    password: string;
    passwordUsed: boolean;
    keepPasswordPlaceholder: boolean;
    savePassword: boolean;
    busy: boolean;
    onAuthMethodChange: (method: AuthMethod) => void;
    onUserChange: (value: string) => void;
    onProfileChange: (value: string) => void;
    onRegionChange: (value: string) => void;
    onPasswordChange: (value: string) => void;
    onSavePasswordChange: (value: boolean) => void;
}

/**
 * The method and what it needs are one question, so they are one section:
 * choosing IAM swaps the fields under this heading and nothing else on the
 * screen moves.
 */
export default function ConnectionAuthFields({
    engine,
    authMethod,
    user,
    iam,
    awsProfile,
    awsProfileInvalid,
    awsRegion,
    awsRegionInvalid,
    password,
    passwordUsed,
    keepPasswordPlaceholder,
    savePassword,
    busy,
    onAuthMethodChange,
    onUserChange,
    onProfileChange,
    onRegionChange,
    onPasswordChange,
    onSavePasswordChange,
}: Props) {
    return (
        <>
            <ConnectionFormSection label="Authentication" />

            <ConnectionAuthMethodFields
                engine={engine}
                authMethod={authMethod}
                user={user}
                onAuthMethodChange={onAuthMethodChange}
                onUserChange={onUserChange}
            />

            {iam ? (
                <ConnectionIamFields
                    awsProfile={awsProfile}
                    awsProfileInvalid={awsProfileInvalid}
                    awsRegion={awsRegion}
                    awsRegionInvalid={awsRegionInvalid}
                    busy={busy}
                    onProfileChange={onProfileChange}
                    onRegionChange={onRegionChange}
                />
            ) : (
                <ConnectionPasswordField
                    password={password}
                    passwordUsed={passwordUsed}
                    keepPlaceholder={keepPasswordPlaceholder}
                    savePassword={savePassword}
                    onPasswordChange={onPasswordChange}
                    onSavePasswordChange={onSavePasswordChange}
                />
            )}
        </>
    );
}
