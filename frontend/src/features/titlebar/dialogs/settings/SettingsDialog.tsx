import { useStringSetting } from '../../../../store/settingsSlice.ts';
import {
    DEFAULT_QUERY_TIMEOUT_SECONDS,
    QUERY_TIMEOUT_KEY,
} from '../../../../store/resultsSlice.ts';
import Button from '../../../../common/components/Button.tsx';
import Field from '../../../../common/components/Field.tsx';
import Input from '../../../../common/components/Input.tsx';
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
 * The Preferences menu's "Settings" screen: the theme picker, and how long
 * `db.query`/`db.browse` wait before giving up.
 */
export default function SettingsDialog({ onClose }: Props) {
    const [stored, setTheme] = useStringSetting(THEME_KEY, DEFAULT_THEME_CHOICE);
    const theme = isThemeChoice(stored) ? stored : DEFAULT_THEME_CHOICE;

    const [queryTimeout, setQueryTimeout] = useStringSetting(
        QUERY_TIMEOUT_KEY,
        String(DEFAULT_QUERY_TIMEOUT_SECONDS),
    );

    return (
        <Modal onClose={onClose} width={WIDTH}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: t.GAP }}>
                <h2 style={{ margin: 0, fontSize: t.TEXT_TITLE, fontWeight: 600 }}>Settings</h2>

                <Field label="Theme" htmlFor="theme">
                    <Select id="theme" value={theme} onSelect={setTheme} options={THEME_OPTIONS} />
                </Field>

                <Field label="Query timeout" htmlFor="query-timeout" hint="seconds, 0 for none">
                    <Input
                        id="query-timeout"
                        inputMode="numeric"
                        value={queryTimeout}
                        onChange={(e) => setQueryTimeout(e.target.value.replace(/\D/g, ''))}
                    />
                </Field>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: t.GAP_XS }}>
                    <Button onClick={onClose}>Close</Button>
                </div>
            </div>
        </Modal>
    );
}
