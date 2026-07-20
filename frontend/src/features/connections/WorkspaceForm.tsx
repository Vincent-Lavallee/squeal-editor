import { useState } from 'react';

import type { Workspace, WorkspaceColorId, WorkspaceIconId } from '../../../../shared/protocol/index.ts';
import { DEFAULT_WORKSPACE_COLOR, WORKSPACE_COLORS } from '../../common/icons/workspaceColors.ts';
import { DEFAULT_WORKSPACE_ICON, WORKSPACE_ICONS } from '../../common/icons/workspaceIcons.ts';
import Button from '../../common/components/Button.tsx';
import Input from '../../common/components/Input.tsx';
import Field from '../../common/components/Field.tsx';
import SrOnly from '../../common/components/SrOnly.tsx';
import * as t from '../../common/tokens';

const iconSvg = { flex: 'none', width: 16, height: 16 };
const hiddenRadio: React.CSSProperties = { position: 'absolute', opacity: 0, pointerEvents: 'none' };
const pickBase: React.CSSProperties = { display: 'grid', placeItems: 'center', width: 34, height: 34, border: `1px solid ${t.BORDER_STRONG}`, borderRadius: t.RADIUS, cursor: 'pointer' };

export interface WorkspaceFormValues { name: string; icon: WorkspaceIconId; color: WorkspaceColorId; }

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
  const [color, setColor] = useState<WorkspaceColorId>(initial?.color ?? DEFAULT_WORKSPACE_COLOR);

  return (
    <form style={{ display: 'flex', flexDirection: 'column', gap: t.GAP }}
      onSubmit={(e) => { e.preventDefault(); onSubmit({ name: name.trim(), icon, color }); }}>
      <Field label="Name" htmlFor="workspace-name">
        <Input id="workspace-name" value={name} autoFocus required placeholder="Acme" onChange={(e) => setName(e.target.value)} />
      </Field>

      <Field label="Icon">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: t.GAP_SM }} role="radiogroup" aria-label="Icon">
          {WORKSPACE_ICONS.map(({ id, Glyph }) => {
            const on = icon === id;
            return (
              <label key={id} style={{ ...pickBase, color: t.TEXT_MUTED, ...(on ? { borderColor: t.ACCENT, background: t.SELECTED, color: t.ACCENT } : {}) }}>
                <input type="radio" name="workspace-icon" value={id} checked={on} onChange={() => setIcon(id)} style={hiddenRadio} />
                <Glyph style={iconSvg} />
              </label>
            );
          })}
        </div>
      </Field>

      <Field label="Colour">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: t.GAP_SM }} role="radiogroup" aria-label="Colour">
          {WORKSPACE_COLORS.map(({ id, value: hex }) => {
            const on = color === id;
            return (
              <label key={id} style={{ ...pickBase, ...(on ? { borderColor: t.ACCENT, background: t.SELECTED } : {}) }}>
                <input type="radio" name="workspace-color" value={id} checked={on} onChange={() => setColor(id)} style={hiddenRadio} />
                <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: t.RADIUS_PILL, background: hex }} />
                <SrOnly>{id}</SrOnly>
              </label>
            );
          })}
        </div>
      </Field>

      <div style={{ display: 'flex', gap: t.GAP_SM, marginTop: t.GAP_XS }}>
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button type="submit" data-testid="connect-submit" variant="primary" style={{ justifyContent: 'center', height: 34, flex: 1 }} disabled={busy || !name.trim()}>
          {busy ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create workspace'}
        </Button>
      </div>
    </form>
  );
}
