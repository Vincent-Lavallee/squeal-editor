import { useState } from 'react';

import type { SavedConnection } from '../../../../shared/protocol.ts';
import { serverLabel } from '../../store/sessionSlice.ts';
import Button from '../../common/components/Button.tsx';
import Input from '../../common/components/Input.tsx';
import Field from '../../common/components/Field.tsx';
import * as t from '../../common/tokens';

interface Props {
  connection: SavedConnection;
  connecting: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

export default function PasswordPrompt({ connection, connecting, onSubmit, onCancel }: Props) {
  const [password, setPassword] = useState('');

  return (
    <form
      style={{ display: 'flex', flexDirection: 'column', gap: t.GAP }}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(password);
      }}
    >
      <Field
        label="Password for"
        htmlFor="prompt-password"
        hint={<span style={{ color: t.TEXT_FAINT }}>{serverLabel(connection.config)}</span>}
      >
        <Input
          id="prompt-password"
          type="password"
          value={password}
          autoFocus
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      <div style={{ display: 'flex', gap: t.GAP_SM, marginTop: t.GAP_XS }}>
        <Button onClick={onCancel} disabled={connecting}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" style={{ justifyContent: 'center', height: 34, flex: 1 }} disabled={connecting}>
          {connecting ? 'Connecting…' : `Connect to ${connection.name}`}
        </Button>
      </div>
    </form>
  );
}
