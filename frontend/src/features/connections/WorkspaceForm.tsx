import { useState } from 'react';

import type { Workspace, WorkspaceIconId } from '../../../../shared/protocol/index.ts';
import { DEFAULT_WORKSPACE_ICON } from '../../common/icons/workspaceIcons.ts';
import Button from '../../common/components/Button.tsx';
import Input from '../../common/components/Input.tsx';
import Field from '../../common/components/Field.tsx';
import * as t from '../../common/tokens';
import WorkspaceIconPicker from './WorkspaceIconPicker.tsx';

export interface WorkspaceFormValues {
    name: string;
    icon: WorkspaceIconId;
}

interface Props {
    mode: 'new' | 'edit';
    initial?: Workspace;
    onSubmit: (values: WorkspaceFormValues) => void;
    onCancel: () => void;
    busy: boolean;
}

export default function WorkspaceForm({ mode, initial, onSubmit, onCancel, busy }: Props) {
    const [name, setName] = useState(initial?.name ?? '');
    const [icon, setIcon] = useState<WorkspaceIconId>(initial?.icon ?? DEFAULT_WORKSPACE_ICON);

    return (
        <form
            style={{ display: 'flex', flexDirection: 'column', gap: t.GAP }}
            onSubmit={(e) => {
                e.preventDefault();
                onSubmit({ name: name.trim(), icon });
            }}
        >
            <Field label="Name" htmlFor="workspace-name">
                <Input
                    id="workspace-name"
                    value={name}
                    autoFocus
                    required
                    placeholder="Acme"
                    onChange={(e) => setName(e.target.value)}
                />
            </Field>

            <Field label="Icon">
                <WorkspaceIconPicker icon={icon} onChange={setIcon} />
            </Field>

            <div style={{ display: 'flex', gap: t.GAP_SM, marginTop: t.GAP_XS }}>
                <Button onClick={onCancel} disabled={busy}>
                    Cancel
                </Button>
                <Button
                    type="submit"
                    data-testid="connect-submit"
                    variant="primary"
                    style={{ justifyContent: 'center', flex: 1 }}
                    disabled={busy || !name.trim()}
                >
                    {busy ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create workspace'}
                </Button>
            </div>
        </form>
    );
}
