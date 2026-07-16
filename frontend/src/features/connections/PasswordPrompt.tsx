import { useState } from 'react';

import type { SavedConnection } from '../../../../shared/protocol.ts';
import { serverLabel } from '../../store/sessionSlice.ts';

interface Props {
  connection: SavedConnection;
  connecting: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

/** Where a connection that stores no password asks for one, and never keeps it. */
export default function PasswordPrompt({ connection, connecting, onSubmit, onCancel }: Props) {
  const [password, setPassword] = useState('');

  return (
    <form
      className="connect__form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(password);
      }}
    >
      <div className="field">
        <label className="label" htmlFor="prompt-password">
          Password for <span className="field__hint">{serverLabel(connection.config)}</span>
        </label>
        <input
          id="prompt-password"
          className="input"
          type="password"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <div className="connect__actions">
        <button type="button" className="btn" onClick={onCancel} disabled={connecting}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary connect__submit" disabled={connecting}>
          {connecting ? 'Connecting…' : `Connect to ${connection.name}`}
        </button>
      </div>
    </form>
  );
}
