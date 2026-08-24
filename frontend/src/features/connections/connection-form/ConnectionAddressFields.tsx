import type { SavedConnection } from '../../../../../shared/protocol/index.ts';
import ConnectionAuthFields from './ConnectionAuthFields.tsx';
import ConnectionFileField from './ConnectionFileField.tsx';
import ConnectionFormSection from './ConnectionFormSection.tsx';
import ConnectionServerFields from './ConnectionServerFields.tsx';
import type { useConnectionForm } from '../hooks/useConnectionForm.ts';

interface Props {
    f: ReturnType<typeof useConnectionForm>;
    mode: 'new' | 'edit';
    initial: SavedConnection | undefined;
    busy: boolean;
}

/** Where the server lives and how to get in -- absent entirely for a file engine, which has neither. */
export default function ConnectionAddressFields({ f, mode, initial, busy }: Props) {
    if (f.fileBased) {
        return (
            <ConnectionFileField
                database={f.form.database}
                invalid={f.invalid('database')}
                busy={busy}
                onChange={(value) => f.set('database', value)}
                onBrowse={() => void f.browseForFile()}
            />
        );
    }

    return (
        <>
            <ConnectionFormSection label="Server" />
            <ConnectionServerFields
                engine={f.engine}
                host={f.form.host}
                hostInvalid={f.invalid('host')}
                port={f.form.port}
                database={f.form.database}
                onHostChange={(value) => f.set('host', value)}
                onPortChange={(value) => f.set('port', value)}
                onDatabaseChange={(value) => f.set('database', value)}
            />
            <ConnectionAuthFields
                engine={f.engine}
                authMethod={f.form.authMethod}
                user={f.form.user}
                iam={f.iam}
                awsProfile={f.form.awsProfile}
                awsProfileInvalid={f.invalid('awsProfile')}
                awsRegion={f.form.awsRegion}
                awsRegionInvalid={f.invalid('awsRegion')}
                password={f.form.password}
                passwordUsed={f.passwordUsed}
                keepPasswordPlaceholder={mode === 'edit' && (initial?.hasPassword ?? false)}
                savePassword={f.form.savePassword}
                busy={busy}
                onAuthMethodChange={f.setAuthMethod}
                onUserChange={(value) => f.set('user', value)}
                onProfileChange={(value) => f.set('awsProfile', value)}
                onRegionChange={(value) => f.set('awsRegion', value)}
                onPasswordChange={(value) => {
                    f.set('password', value);
                    f.set('passwordTouched', true);
                }}
                onSavePasswordChange={(value) => f.set('savePassword', value)}
            />
        </>
    );
}
