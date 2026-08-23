import Callout from '../../common/components/Callout.tsx';
import * as t from '../../common/tokens';
import type { AiStatus } from '../../../../shared/protocol/index.ts';

/**
 * `AiStatus` resolves rather than rejecting so this can tell "nothing stored
 * yet" from "the keychain would not answer": the second one draws a callout
 * naming what the OS said, because a key that cannot be *read* is not a key
 * that needs re-pasting, and offering the same form for both would send the
 * user round a loop that cannot end.
 */
export default function AiKeyStatusNotice({ status }: { status: AiStatus }) {
    if (status.state !== 'unavailable') return null;

    return (
        <Callout>
            The stored key could not be read.
            {status.reason ? (
                <div
                    style={{
                        marginTop: t.GAP_SM,
                        fontFamily: t.MONO,
                        wordBreak: 'break-word',
                    }}
                >
                    {status.reason}
                </div>
            ) : null}
        </Callout>
    );
}
