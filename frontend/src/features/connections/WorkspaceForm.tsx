import { useState } from 'react';

import type { Workspace, WorkspaceIconId } from '../../../../shared/protocol.ts';
import { DEFAULT_WORKSPACE_ICON, WORKSPACE_ICONS } from '../../workspaceIcons.ts';

export interface WorkspaceFormValues {
  name: string;
  icon: WorkspaceIconId;
}

interface Props {
  mode: 'new' | 'edit';
  /** The workspace being edited; absent when adding. */
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
      className="connect__form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ name: name.trim(), icon });
      }}
    >
      <div className="field">
        <label className="label" htmlFor="workspace-name">
          Name
        </label>
        <input
          id="workspace-name"
          className="input"
          value={name}
          autoFocus
          required
          placeholder="Acme"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="field">
        <span className="label">Icon</span>
        {/*
         * Radios rather than buttons: this is a single choice out of a fixed set,
         * which is what a radio group *is* -- and it brings arrow-key navigation
         * and the roving tab stop with it. The same rule as `.check` and
         * `.select`: take the platform's keyboard behaviour rather than rebuild
         * it out of divs and lose it. The input itself is hidden; the glyph
         * beside it is the control's face.
         */}
        <div className="ws-icons" role="radiogroup" aria-label="Icon">
          {WORKSPACE_ICONS.map(({ id, Glyph }) => (
            <label key={id} className={`ws-icons__pick${icon === id ? ' ws-icons__pick--on' : ''}`}>
              <input
                type="radio"
                name="workspace-icon"
                value={id}
                checked={icon === id}
                onChange={() => setIcon(id)}
              />
              <Glyph className="icon" />
            </label>
          ))}
        </div>
      </div>

      <div className="connect__actions">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn btn--primary connect__submit" disabled={busy || !name.trim()}>
          {busy ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create workspace'}
        </button>
      </div>
    </form>
  );
}
