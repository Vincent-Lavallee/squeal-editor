import { useStringSetting } from '../../../../store/settingsSlice.ts';
import Button from '../../../../common/components/Button.tsx';
import Field from '../../../../common/components/Field.tsx';
import Modal from '../../../../common/components/Modal.tsx';
import Select from '../../../../common/components/Select.tsx';
import { DEFAULT_THEME_CHOICE, isThemeChoice, THEME_KEY } from '../../../../common/theme/theme.ts';
import * as t from '../../../../common/tokens';

const WIDTH = 380;

const THEME_OPTIONS = [
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'system', label: 'System' },
];

interface Props {
    onClose: () => void;
}

/**
 * The Preferences menu's "Settings" screen. One preference today -- theme --
 * and the place the next one (language) arrives beside it, per the backlog.
 */
export default function SettingsDialog({ onClose }: Props) {
    const [stored, setTheme] = useStringSetting(THEME_KEY, DEFAULT_THEME_CHOICE);
    const theme = isThemeChoice(stored) ? stored : DEFAULT_THEME_CHOICE;

    return (
        <Modal onClose={onClose} width={WIDTH}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: t.GAP }}>
                <h2 style={{ margin: 0, fontSize: t.TEXT_TITLE, fontWeight: 600 }}>Settings</h2>

                <Field label="Theme" htmlFor="theme">
                    <Select id="theme" value={theme} onSelect={setTheme} options={THEME_OPTIONS} />
                </Field>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: t.GAP_XS }}>
                    <Button onClick={onClose}>Close</Button>
                </div>
            </div>
        </Modal>
    );
}
