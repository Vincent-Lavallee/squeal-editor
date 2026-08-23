import type { EngineType } from '../../../../shared/protocol/index.ts';
import { engineLabel } from '../../common/db/engines.ts';
import Badge from '../../common/components/Badge.tsx';
import * as t from '../../common/tokens';

interface Props {
    name: string;
    engineType: EngineType;
    alreadyOpen: boolean;
}

export default function SavedConnectionHeader({ name, engineType, alreadyOpen }: Props) {
    return (
        <span style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, minWidth: 0 }}>
            <span
                data-testid="saved-name"
                style={{
                    overflow: 'hidden',
                    fontSize: t.TEXT_BODY,
                    fontWeight: 500,
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}
            >
                {name}
            </span>
            <Badge kind="accent">{engineLabel(engineType)}</Badge>
            {/* The long name beside it is what gives way -- it has an ellipsis and this
          has nothing to lose a character of. */}
            {alreadyOpen && (
                <Badge kind="neutral" testId="saved-open" style={{ flex: 'none' }}>
                    Open
                </Badge>
            )}
        </span>
    );
}
