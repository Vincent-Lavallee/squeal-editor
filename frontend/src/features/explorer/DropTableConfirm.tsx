import { useState } from 'react';

import type { TableInfo } from '../../../../shared/protocol.ts';

interface Props {
  table: TableInfo;
  /** Runs the drop. Rejects with a message the modal shows in place. */
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

/**
 * The drop confirmation: the same overlay and the same friction as leaving
 * read-only, because a drop is DDL and nothing rolls it back. It asks the name
 * typed back for the same reason `ReadOnlyConfirm` asks for the environment --
 * the muscle memory of clicking through is what makes an accident, so the guard
 * is the typing, not the click.
 *
 * The failure renders here rather than in the tree: a drop that the server
 * refuses -- a dependent view, a permission -- is news about the action just
 * taken in this dialog, so it belongs in this dialog.
 */
export default function DropTableConfirm({ table, onConfirm, onCancel }: Props) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);

  const noun = table.kind === 'view' ? 'view' : 'table';
  // Exact, case included: an identifier's case can matter, and asking for it back
  // exactly is the whole point of the friction.
  const matches = typed === table.name;

  async function submit(): Promise<void> {
    if (!matches || dropping) return;
    setDropping(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(typeof err === 'string' ? err : err instanceof Error ? err.message : String(err));
      setDropping(false);
    }
  }

  return (
    <div className="overlay" onMouseDown={onCancel}>
      {/* Stop a click inside the card from reaching the overlay's dismiss. */}
      <div className="modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <form
          className="connect__form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h2 className="modal__title">
            Drop {noun} {table.name}?
          </h2>
          <p className="modal__body">
            This runs <span className="modal__env">DROP {noun.toUpperCase()}</span> and cannot be undone. Type{' '}
            <span className="modal__env">{table.name}</span> to confirm.
          </p>

          <div className="field">
            <input
              className="input"
              value={typed}
              autoFocus
              placeholder={table.name}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>

          {error && <div className="callout--error">{error}</div>}

          <div className="connect__actions">
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary connect__submit" disabled={!matches || dropping}>
              {dropping ? 'Dropping…' : `Drop ${noun}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
