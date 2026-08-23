import * as t from '../../common/tokens';

/**
 * The insertion line. Absolutely positioned rather than a border on the tab, so
 * showing it never widens anything -- a 2px border appearing under the pointer
 * would shove every tab to its right and move the target out from under the drop.
 */
export default function DropMark({ side }: { side: 'left' | 'right' }) {
    return (
        <div
            data-testid="tab-drop-mark"
            aria-hidden="true"
            style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                [side]: 0,
                width: 2,
                background: t.ACCENT,
                pointerEvents: 'none',
            }}
        />
    );
}
