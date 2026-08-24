import type { FunctionInfo } from '../../../../../shared/protocol/index.ts';
import { FunctionIcon } from '../../../common/icons/icons.ts';
import * as t from '../../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };

interface Props {
    func: FunctionInfo;
    label: string;
    onClick: () => void;
}

export default function TreeFunctionNameButton({ func, label, onClick }: Props) {
    return (
        <button
            data-testid="tree-function-name"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                flex: 1,
                minWidth: 0,
                height: '100%',
                padding: '0 6px 0 0',
                border: 'none',
                background: 'none',
                color: t.TEXT,
                font: 'inherit',
                fontSize: t.TEXT_BADGE,
                textAlign: 'left',
                cursor: 'pointer',
            }}
            onClick={onClick}
            title={`${label} — click to view definition`}
        >
            <FunctionIcon style={{ ...iconSvg, color: t.TEXT_MUTED }} aria-hidden="true" />
            <span
                data-testid="tree-function-label"
                style={{
                    flex: '1 1 auto',
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                }}
            >
                {label}
            </span>
            <span
                style={{
                    flex: '0 999 auto',
                    minWidth: 0,
                    marginLeft: 'auto',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: t.TEXT_MUTED,
                    fontSize: '0.85em',
                }}
            >
                {func.kind}
            </span>
        </button>
    );
}
