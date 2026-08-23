import Mono from '../../common/components/Mono.tsx';
import Input from '../../common/components/Input.tsx';
import Field from '../../common/components/Field.tsx';
import AwsSignInButton from './AwsSignInButton.tsx';
import AwsSignInStatus from './AwsSignInStatus.tsx';
import { invalidBox, requiredHint } from './connectionFormFieldHelpers.tsx';

interface Props {
    awsProfile: string;
    awsProfileInvalid: boolean;
    awsRegion: string;
    awsRegionInvalid: boolean;
    busy: boolean;
    onProfileChange: (value: string) => void;
    onRegionChange: (value: string) => void;
}

export default function ConnectionIamFields({
    awsProfile,
    awsProfileInvalid,
    awsRegion,
    awsRegionInvalid,
    busy,
    onProfileChange,
    onRegionChange,
}: Props) {
    return (
        <>
            <div style={{ display: 'flex', gap: 10 }}>
                <div style={{ flex: 1 }}>
                    <Field
                        label="AWS profile"
                        htmlFor="awsProfile"
                        hint={requiredHint(awsProfileInvalid)}
                    >
                        <Input
                            id="awsProfile"
                            value={awsProfile}
                            placeholder="default"
                            aria-invalid={awsProfileInvalid || undefined}
                            style={invalidBox(awsProfileInvalid)}
                            onChange={(e) => onProfileChange(e.target.value)}
                        />
                    </Field>
                </div>
                <div style={{ flex: 1 }}>
                    <Field label="Region" htmlFor="awsRegion" hint={requiredHint(awsRegionInvalid)}>
                        <Input
                            id="awsRegion"
                            value={awsRegion}
                            placeholder="us-east-1"
                            aria-invalid={awsRegionInvalid || undefined}
                            style={invalidBox(awsRegionInvalid)}
                            onChange={(e) => onRegionChange(e.target.value)}
                        />
                    </Field>
                </div>
            </div>

            {/* An expired SSO session is the common, recoverable failure here, and the
          only fix used to be a terminal the app never mentions again. This runs
          the same command in the same profile. There is nothing to retry
          afterwards -- the connection does not exist yet -- which is the whole
          difference from the saved list's copy of this. */}
            <AwsSignInButton
                profile={awsProfile.trim()}
                disabled={busy}
                hint={
                    <>
                        runs <Mono>aws sso login</Mono> and opens your browser
                    </>
                }
            />
            <AwsSignInStatus />
        </>
    );
}
