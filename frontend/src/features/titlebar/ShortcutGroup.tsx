import { Label } from '../../common/components/Field.tsx';
import { formatChord, SHORTCUTS, type ShortcutId } from '../../common/shortcuts.ts';
import * as t from '../../common/tokens';
import ShortcutRow from './ShortcutRow.tsx';

const list: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    margin: 0,
    padding: 0,
    listStyle: 'none',
    border: `1px solid ${t.BORDER_STRONG}`,
    borderRadius: t.RADIUS,
    overflow: 'hidden',
};

export default function ShortcutGroup({
    group,
    recording,
    bindings,
    overrides,
    onReset,
    onStop,
    onStart,
}: {
    group: string;
    recording: ShortcutId | null;
    bindings: Record<ShortcutId, string>;
    overrides: Partial<Record<ShortcutId, string>>;
    onReset: (id: ShortcutId) => void;
    onStop: () => void;
    onStart: (id: ShortcutId) => void;
}) {
    return (
        <section style={{ display: 'flex', flexDirection: 'column', gap: t.GAP_XS }}>
            <Label>{group}</Label>
            <ul style={list}>
                {SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut, i) => {
                    const listening = recording === shortcut.id;
                    return (
                        <ShortcutRow
                            key={shortcut.id}
                            shortcut={shortcut}
                            first={i === 0}
                            chord={formatChord(bindings[shortcut.id])}
                            listening={listening}
                            hasOverride={overrides[shortcut.id] !== undefined}
                            onReset={() => {
                                onStop();
                                onReset(shortcut.id);
                            }}
                            onToggleListen={() => (listening ? onStop() : onStart(shortcut.id))}
                        />
                    );
                })}
            </ul>
        </section>
    );
}
