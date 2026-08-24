import * as t from '../../../common/tokens';
import { chipStyle, frostStyle, paneStyle } from './awsSignInVeilStyles.ts';

interface Props {
    reason: string | null;
    shown: boolean;
}

/** A profile that is merely *missing* -- the same pane saying so, and no click, because no login creates one. */
export default function AwsSignInVeilBlocked({ reason, shown }: Props) {
    return (
        <div data-testid="saved-blocked" title={reason ?? undefined} style={paneStyle(shown)}>
            <span aria-hidden="true" style={frostStyle(shown)} />
            {/* Filled but not outlined, and muted: nothing here is clickable, so
          nothing here draws an edge.

          Three words rather than the reason itself, which names the profile
          and so is as long as the profile is: this is what the pane can afford
          to say without covering the connection it is about, and the reason is
          the pane's `title`. */}
            <span
                style={{
                    ...chipStyle(shown),
                    padding: '4px 10px',
                    borderRadius: t.RADIUS_PILL,
                    background: t.VEIL_DEEP,
                    color: t.TEXT_MUTED,
                    opacity: shown ? 1 : 0,
                }}
            >
                Profile not set up
            </span>
        </div>
    );
}
