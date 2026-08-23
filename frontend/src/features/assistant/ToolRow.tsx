import { useState } from 'react';

import * as t from '../../common/tokens';
import type { ToolRecord } from '../../store/assistantSlice.ts';
import ToolRowDetail from './ToolRowDetail.tsx';
import ToolRowSummary from './ToolRowSummary.tsx';

/**
 * One call, collapsed to a line. Expanding it is how "what did it just read" is
 * answered — which is the whole reason the row exists, so the disclosure has to
 * actually disclose something.
 *
 * `args` and `result` come off the record rather than being joined out of the
 * conversation here: the arguments live on the assistant message and the answer
 * on a `tool` message somewhere after it, and re-pairing them by id on every
 * render is work the slice already did once.
 */
export default function ToolRow({
    record,
    name,
}: {
    record: ToolRecord | undefined;
    name: string;
}) {
    const [open, setOpen] = useState(false);

    return (
        <div style={{ fontSize: t.TEXT_BADGE }}>
            <ToolRowSummary
                record={record}
                name={name}
                open={open}
                onToggle={() => setOpen((was) => !was)}
            />
            {open && record ? <ToolRowDetail record={record} /> : null}
        </div>
    );
}
