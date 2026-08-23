import { useShortcuts } from '../../store/settingsSlice.ts';
import Button from '../../common/components/Button.tsx';
import Modal from '../../common/components/Modal.tsx';
import { SHORTCUTS } from '../../common/shortcuts.ts';
import * as t from '../../common/tokens';
import ShortcutGroup from './ShortcutGroup.tsx';
import { useShortcutRecorder } from './useShortcutRecorder.ts';

const WIDTH = 560;

/*
 * The groups scroll; the heading, the hint line and the buttons do not.
 *
 * Once the editor's own commands joined the registry this is thirty-odd rows,
 * which is taller than a window -- and a dialog whose *Close* has gone off the
 * bottom of the screen is one there is no way out of. The hint has to stay put
 * for the same reason it lives in one line: a clash named at the top of a list
 * scrolled away from is a refusal nobody sees.
 */
const scroller: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: t.GAP,
    overflowY: 'auto',
    maxHeight: '58vh',
    paddingRight: t.GAP_XS,
};

const GROUPS = [...new Set(SHORTCUTS.map((shortcut) => shortcut.group))];

interface Props {
    onClose: () => void;
}

/**
 * The Preferences menu's "Keyboard shortcuts" screen: every shortcut the app
 * owns, and the way to change one.
 */
export default function ShortcutsDialog({ onClose }: Props) {
    const { bindings, overrides, rebind, reset, resetAll } = useShortcuts();
    const { recording, clash, start, stop } = useShortcutRecorder(bindings, rebind);

    return (
        <Modal onClose={onClose} width={WIDTH}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: t.GAP }}>
                <h2 style={{ margin: 0, fontSize: t.TEXT_TITLE, fontWeight: 600 }}>
                    Keyboard shortcuts
                </h2>

                {/* One line, whether it is the instruction or a refusal -- the same slot
            a `<Field>`'s hint uses to say a value is wrong, so a clash never
            pushes the rows below it down the screen. */}
                <p
                    data-testid="shortcut-hint"
                    style={{
                        margin: 0,
                        color: clash ? t.RED_TEXT : t.TEXT_MUTED,
                        fontSize: t.TEXT_BODY,
                    }}
                >
                    {clash ?? 'Click a shortcut to record a new key. Esc cancels.'}
                </p>

                <div style={scroller}>
                    {GROUPS.map((group) => (
                        <ShortcutGroup
                            key={group}
                            group={group}
                            recording={recording}
                            bindings={bindings}
                            overrides={overrides}
                            onReset={reset}
                            onStop={stop}
                            onStart={start}
                        />
                    ))}
                </div>

                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginTop: t.GAP_XS,
                    }}
                >
                    <Button
                        variant="ghost"
                        disabled={Object.keys(overrides).length === 0}
                        onClick={() => {
                            stop();
                            resetAll();
                        }}
                    >
                        Reset all
                    </Button>
                    <Button onClick={onClose}>Close</Button>
                </div>
            </div>
        </Modal>
    );
}
