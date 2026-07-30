import { useState } from 'react';

import type { SavedQuery } from '../../../../shared/protocol/index.ts';
import { useSavedQueries } from '../../store/savedQueriesSlice.ts';
import Button from '../../common/components/Button.tsx';
import Callout from '../../common/components/Callout.tsx';
import Field from '../../common/components/Field.tsx';
import Input from '../../common/components/Input.tsx';
import Modal from '../../common/components/Modal.tsx';
import * as t from '../../common/tokens';

interface Props {
  /** What the tab is called now, which is the name being offered. */
  initialName: string;
  sql: string;
  onSaved: (query: SavedQuery) => void;
  onClose: () => void;
}

/**
 * The name a query is saved under, asked once.
 *
 * Only an *unlinked* tab reaches this: once a tab knows which saved query it is,
 * Ctrl+S writes over that row and says so by clearing the strip's unsaved mark,
 * with nothing to ask about. So this is the first save and the only one, which is
 * why the field is a name rather than a name plus a "replace?" question.
 */
export default function SaveQueryDialog({ initialName, sql, onSaved, onClose }: Props) {
  const { saving, error, save, dismissError } = useSavedQueries();
  const [name, setName] = useState(initialName);

  function close(): void {
    dismissError();
    onClose();
  }

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    // The dialog stays open on a failure -- a name already taken is fixed by
    // typing another one, and closing would throw away the text just typed.
    try {
      onSaved(await save({ name: trimmed, sql }));
    } catch {
      /* renders below */
    }
  }

  return (
    <Modal onClose={close}>
      <form style={{ display: 'flex', flexDirection: 'column', gap: t.GAP }} onSubmit={(e) => void submit(e)}>
        <h2 style={{ margin: 0, fontSize: t.TEXT_TITLE, fontWeight: 600 }}>Save query</h2>
        <p style={{ margin: 0, color: t.TEXT_MUTED, fontSize: t.TEXT_BODY }}>
          Saved queries are global — open one into a tab on any connection.
        </p>

        <Field label="Name" htmlFor="saved-query-name">
          {/* Selected on focus, not merely focused: the field arrives holding
              the tab's current name, which is a suggestion to type over rather
              than a prefix to append to.

              No placeholder. The field is never empty when it opens, so one
              would only ever be seen by someone who cleared it on purpose --
              and a made-up example name shown at that moment reads as an
              instruction about what to call things. */}
          <Input
            id="saved-query-name"
            data-testid="save-query-name"
            autoFocus
            value={name}
            disabled={saving}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        {error && <Callout>{error}</Callout>}

        <div style={{ display: 'flex', gap: t.GAP_SM, justifyContent: 'flex-end' }}>
          <Button onClick={close}>Cancel</Button>
          <Button data-testid="save-query-submit" type="submit" variant="primary" disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
