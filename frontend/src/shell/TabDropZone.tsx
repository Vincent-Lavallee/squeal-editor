import { useState } from 'react';

import * as t from '../common/tokens';

/**
 * Where a dragged tab may be dropped inside a pane, over the pane's body.
 *
 * It starts below the tab strip (`top: TAB_H`) rather than covering the pane
 * whole: the strip runs its own drag, and swallowing its `dragover` would take
 * away the insertion mark that says *where* among the tabs it lands.
 *
 * `half` is the pane that has no split yet, where only the trailing half means
 * "open a second pane" -- the leading half is where the tab already is. It
 * carries an edge at rest, because a target that appears only once you are
 * already over it is one nobody finds; a whole-pane zone needs no such hint,
 * since by then there are two panes on screen and the gesture is to drop on
 * the other one.
 *
 * **Dashed, and grayscale until it is the one being dropped on.** A solid
 * accent edge standing by through every drag reads as a thing that is already
 * happening; dashed says *provisional*, which is what a drop target is, and
 * `--border-strong` keeps it in the chrome's grayscale until hovering earns it
 * the accent. The fill it takes then is `--selected`, the system's existing
 * word for "this one", and nothing louder.
 *
 * **It sits above the grid's own sticky chrome** (`zIndex`), which the first
 * cut did not: a sticky header or row gutter carries `z-index: 1`/`2`, and a
 * positioned element with no z-index of its own paints *below* those however
 * late it comes in the DOM -- so the zone was live over the rows and dead over
 * the header and the gutter. Well below the 50-tier floating layer (menus,
 * select popups), which must still cover it.
 */
export default function TabDropZone({
    testId,
    half,
    onDropTab,
}: {
    testId: string;
    half?: boolean;
    onDropTab: () => void;
}) {
    const [over, setOver] = useState(false);
    const edge = `1px dashed ${over ? t.ACCENT : t.BORDER_STRONG}`;
    return (
        <div
            data-testid={testId}
            onDragEnter={() => setOver(true)}
            onDragLeave={() => setOver(false)}
            // Without this the drop never fires: the default for a dragover is to
            // refuse the drop.
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                onDropTab();
            }}
            style={{
                position: 'absolute',
                zIndex: 20,
                top: t.TAB_H,
                bottom: 0,
                right: 0,
                left: half ? undefined : 0,
                width: half ? '50%' : undefined,
                background: over ? t.SELECTED : 'transparent',
                borderLeft: half ? edge : undefined,
                outline: over && !half ? edge : undefined,
                outlineOffset: -1,
            }}
        />
    );
}
