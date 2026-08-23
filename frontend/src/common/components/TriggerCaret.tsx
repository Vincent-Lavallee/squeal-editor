import { SelectCaretIcon } from '../icons/icons.ts';
import * as t from '../tokens';

export default function TriggerCaret({
    disabled,
    isAttached,
}: {
    disabled: boolean | undefined;
    isAttached: boolean;
}) {
    return (
        <SelectCaretIcon
            // `currentColor` when attached: the muted grey is a readable step down
            // from `--text` on the app background, and illegible on an accent fill.
            style={{
                flex: 'none',
                width: t.ICON,
                height: t.ICON,
                color: disabled ? t.TEXT_FAINT : isAttached ? 'currentColor' : t.TEXT_MUTED,
            }}
            aria-hidden="true"
        />
    );
}
