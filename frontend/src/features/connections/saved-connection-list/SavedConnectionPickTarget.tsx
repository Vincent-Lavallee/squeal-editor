import type { SavedConnection } from '../../../../../shared/protocol/index.ts';
import type { ProfileStatus } from '../../../store/awsSignInSlice.ts';
import AwsSignInVeil from '../aws-sign-in/AwsSignInVeil.tsx';
import SavedConnectionButton from './SavedConnectionButton.tsx';

interface Props {
    connection: SavedConnection;
    alreadyOpen: boolean;
    connecting: boolean;
    connectingPhase: string | null;
    busy: boolean;
    blocked: ProfileStatus | null;
    shown: boolean;
    onPick: () => void;
}

/**
 * The veil is laid over the pick target and nothing else, so a row you cannot
 * open is still a row you can edit or delete -- editing the profile name
 * being one of the two ways out of this state.
 */
export default function SavedConnectionPickTarget({
    connection: c,
    alreadyOpen,
    connecting,
    connectingPhase,
    busy,
    blocked,
    shown,
    onPick,
}: Props) {
    return (
        <span style={{ position: 'relative', display: 'flex', flex: 1, minWidth: 0 }}>
            <SavedConnectionButton
                connection={c}
                alreadyOpen={alreadyOpen}
                blocked={blocked !== null}
                connecting={connecting}
                connectingPhase={connectingPhase}
                busy={busy}
                onPick={onPick}
            />
            {blocked && (
                <AwsSignInVeil
                    profile={c.config.iam!.profile}
                    actionable={blocked.signInHelps}
                    reason={
                        blocked.signInHelps
                            ? blocked.problem
                            : `AWS profile “${c.config.iam!.profile}” is not set up`
                    }
                    // Focus too, or the pane is unreachable by keyboard -- the same
                    // amendment the row's own hover-revealed actions needed.
                    shown={shown}
                    onSignedIn={onPick}
                />
            )}
        </span>
    );
}
