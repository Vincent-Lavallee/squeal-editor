import Button from '../../../../common/components/Button.tsx';
import type { SHORTCUTS } from '../../../../common/shortcuts.ts';
import * as t from '../../../../common/tokens';

const CHORD_W = 156;
/** Reserved whether or not the row has a Reset in it, so nothing shifts when one appears. */
const RESET_W = 64;

const row: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: t.GAP_SM,
    padding: `${t.GAP_XS}px 10px`,
};

export default function ShortcutRow({
    shortcut,
    first,
    chord,
    listening,
    hasOverride,
    onReset,
    onToggleListen,
}: {
    shortcut: (typeof SHORTCUTS)[number];
    first: boolean;
    chord: string;
    listening: boolean;
    hasOverride: boolean;
    onReset: () => void;
    onToggleListen: () => void;
}) {
    return (
        <li
            data-testid="shortcut-row"
            style={{ ...row, ...(first ? {} : { borderTop: `1px solid ${t.BORDER}` }) }}
        >
            <span style={{ flex: 1, fontSize: t.TEXT_BODY }}>{shortcut.label}</span>
            <span
                style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    flex: 'none',
                    width: RESET_W,
                }}
            >
                {hasOverride && (
                    <Button variant="ghost" onClick={onReset}>
                        Reset
                    </Button>
                )}
            </span>
            <Button
                data-testid="shortcut-chord"
                data-shortcut={shortcut.id}
                style={{
                    flex: 'none',
                    justifyContent: 'center',
                    width: CHORD_W,
                    fontFamily: t.MONO,
                    ...(listening ? { borderColor: t.ACCENT, color: t.TEXT_MUTED } : {}),
                }}
                onClick={onToggleListen}
            >
                {listening ? 'Press a key…' : chord || '—'}
            </Button>
        </li>
    );
}
