import { useState } from 'react';

import type { Environment } from '../../../../shared/protocol.ts';
import { environmentLabel } from '../../common/db/environments.ts';

interface Props {
  environment: Environment;
  /** What the connection is called, so the warning is about a thing, not "this". */
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The one confirmation in the app that asks you to type something back.
 *
 * `SavedConnectionList` explains why the app has no modals: a saved connection is
 * cheap enough to lose that a whole overlay would cost more than the mistake.
 * Leaving read-only is the case that inverts it -- the thing being guarded is a
 * stray write against production, which is neither cheap nor undoable, so it is
 * worth the one overlay and the friction of typing the environment's name.
 *
 * The friction is uniform across environments on purpose: the muscle memory of
 * unlocking is what makes an accident, and a Local connection that trains you to
 * click through without reading is training you for the Production one.
 */
export default function ReadOnlyConfirm({ environment, name, onConfirm, onCancel }: Props) {
  const [typed, setTyped] = useState('');
  const expected = environmentLabel(environment);
  // Case-insensitive so "production" clears it as well as "Production"; the
  // spelling is the check, not the casing.
  const matches = typed.trim().toLowerCase() === expected.toLowerCase();

  return (
    <div className="overlay" onMouseDown={onCancel}>
      {/* Stop a click inside the card from reaching the overlay's dismiss. */}
      <div className="modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <form
          className="connect__form"
          onSubmit={(e) => {
            e.preventDefault();
            if (matches) onConfirm();
          }}
        >
          <h2 className="modal__title">Make {name || 'this connection'} writable?</h2>
          <p className="modal__body">
            It will stop refusing writes. Type <span className="modal__env">{expected}</span> to confirm you mean
            to write to a <span className="modal__env">{expected}</span> database.
          </p>

          <div className="field">
            <input
              className="input"
              value={typed}
              autoFocus
              placeholder={expected}
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>

          <div className="connect__actions">
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn btn--primary connect__submit" disabled={!matches}>
              Turn off read-only
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
