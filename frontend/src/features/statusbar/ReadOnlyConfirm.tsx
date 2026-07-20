import { useState } from 'react';

import type { Environment } from '../../../../shared/protocol/index.ts';
import { environmentLabel } from '../../common/db/environments.ts';
import Button from '../../common/components/Button.tsx';
import Input from '../../common/components/Input.tsx';
import Modal from '../../common/components/Modal.tsx';
import Field from '../../common/components/Field.tsx';
import Mono from '../../common/components/Mono.tsx';
import * as t from '../../common/tokens';

interface Props {
  environment: Environment;
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ReadOnlyConfirm({ environment, name, onConfirm, onCancel }: Props) {
  const [typed, setTyped] = useState('');
  const expected = environmentLabel(environment);
  const matches = typed.trim().toLowerCase() === expected.toLowerCase();

  return (
    <Modal onClose={onCancel}>
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: t.GAP }}
        onSubmit={(e) => {
          e.preventDefault();
          if (matches) onConfirm();
        }}
      >
        <h2 style={{ margin: `0 0 ${t.GAP}px`, fontSize: t.TEXT_TITLE, fontWeight: 600 }}>
          Make {name || 'this connection'} writable?
        </h2>
        <p style={{ margin: `0 0 ${t.GAP_LG}px`, color: t.TEXT_MUTED, fontSize: t.TEXT_BODY, lineHeight: 1.5 }}>
          It will stop refusing writes. Type <Mono>{expected}</Mono> to confirm you mean
          to write to a <Mono>{expected}</Mono> database.
        </p>

        <Field label="" htmlFor="confirm-env">
          <Input
            data-testid="modal-input"
            id="confirm-env"
            value={typed}
            autoFocus
            placeholder={expected}
            onChange={(e) => setTyped(e.target.value)}
          />
        </Field>

        <div style={{ display: 'flex', gap: t.GAP_SM, marginTop: t.GAP_XS }}>
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="submit" data-testid="modal-submit" variant="primary" style={{ justifyContent: 'center', height: 34, flex: 1 }} disabled={!matches}>
            Turn off read-only
          </Button>
        </div>
      </form>
    </Modal>
  );
}
