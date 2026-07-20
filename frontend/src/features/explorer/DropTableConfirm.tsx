import { useState } from 'react';

import type { TableInfo } from '../../../../shared/protocol/index.ts';
import Button from '../../common/components/Button.tsx';
import Input from '../../common/components/Input.tsx';
import Modal from '../../common/components/Modal.tsx';
import Field from '../../common/components/Field.tsx';
import Callout from '../../common/components/Callout.tsx';
import Mono from '../../common/components/Mono.tsx';
import * as t from '../../common/tokens';

interface Props {
  table: TableInfo;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export default function DropTableConfirm({ table, onConfirm, onCancel }: Props) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);

  const noun = table.kind === 'view' ? 'view' : 'table';
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
    <Modal onClose={onCancel}>
      <form
        style={{ display: 'flex', flexDirection: 'column', gap: t.GAP }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 style={{ margin: `0 0 ${t.GAP}px`, fontSize: t.TEXT_TITLE, fontWeight: 600 }}>
          Drop {noun} {table.name}?
        </h2>
        <p style={{ margin: `0 0 ${t.GAP_LG}px`, color: t.TEXT_MUTED, fontSize: t.TEXT_BODY, lineHeight: 1.5 }}>
          This runs <Mono>DROP {noun.toUpperCase()}</Mono> and cannot be undone. Type{' '}
          <Mono>{table.name}</Mono> to confirm.
        </p>

        <Field label="" htmlFor="drop-confirm-name">
          <Input
            data-testid="modal-input"
            id="drop-confirm-name"
            value={typed}
            autoFocus
            placeholder={table.name}
            onChange={(e) => setTyped(e.target.value)}
          />
        </Field>

        {error && <Callout>{error}</Callout>}

        <div style={{ display: 'flex', gap: t.GAP_SM, marginTop: t.GAP_XS }}>
          <Button onClick={onCancel}>Cancel</Button>
          <Button type="submit" data-testid="modal-submit" variant="primary" style={{ justifyContent: 'center', height: 34, flex: 1 }} disabled={!matches || dropping}>
            {dropping ? 'Dropping…' : `Drop ${noun}`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
