import { useState } from 'react';

import type { TableInfo } from '../../../../../shared/protocol/index.ts';
import Button from '../../../common/components/Button.tsx';
import Input from '../../../common/components/Input.tsx';
import Modal from '../../../common/components/Modal.tsx';
import Field from '../../../common/components/Field.tsx';
import Callout from '../../../common/components/Callout.tsx';
import * as t from '../../../common/tokens';
import DropTableMessage from './DropTableMessage.tsx';
import { useDropSubmit } from './hooks/useDropSubmit.ts';

interface Props {
    table: TableInfo;
    onConfirm: () => Promise<void>;
    onCancel: () => void;
}

export default function DropTableConfirm({ table, onConfirm, onCancel }: Props) {
    const [typed, setTyped] = useState('');
    const noun = table.kind === 'view' ? 'view' : 'table';
    const matches = typed === table.name;
    const { error, dropping, submit } = useDropSubmit(onConfirm, matches);

    return (
        <Modal onClose={onCancel}>
            <form
                style={{ display: 'flex', flexDirection: 'column', gap: t.GAP }}
                onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                }}
            >
                <DropTableMessage noun={noun} tableName={table.name} />

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
                    <Button type="button" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        data-testid="modal-submit"
                        variant="primary"
                        style={{ justifyContent: 'center', flex: 1 }}
                        disabled={!matches || dropping}
                    >
                        {dropping ? 'Dropping…' : `Drop ${noun}`}
                    </Button>
                </div>
            </form>
        </Modal>
    );
}
