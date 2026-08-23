import AwsSignInVeilAction from './AwsSignInVeilAction.tsx';
import AwsSignInVeilBlocked from './AwsSignInVeilBlocked.tsx';

interface Props {
    profile: string;
    /** Why the row is blocked. The pane's `title`; never its label -- see `awsSignInVeilStyles.ts`'s `chipStyle`. */
    reason: string | null;
    actionable: boolean;
    shown: boolean;
    onSignedIn?: () => void;
}

export default function AwsSignInVeil({ profile, reason, actionable, shown, onSignedIn }: Props) {
    if (!actionable) return <AwsSignInVeilBlocked reason={reason} shown={shown} />;
    return (
        <AwsSignInVeilAction
            profile={profile}
            reason={reason}
            shown={shown}
            onSignedIn={onSignedIn}
        />
    );
}
