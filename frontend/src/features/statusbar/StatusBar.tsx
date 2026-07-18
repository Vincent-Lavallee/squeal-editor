import { useState } from 'react';

import { environmentLabel } from '../../environments.ts';
import { ReadOnlyIcon, WritableIcon } from '../../icons.ts';
import { useSession } from '../../store/sessionSlice.ts';
import ReadOnlyConfirm from './ReadOnlyConfirm.tsx';

/**
 * The bottom bar. Today it carries one thing -- whether the connection you are
 * looking at is refusing writes -- and it is here rather than in the editor's
 * toolbar because that toolbar is per-tab and hidden on a grid tab, while the
 * lock is a fact about the whole connection and has to be visible on every tab.
 *
 * It reads the *active* connection: switching the rail switches which lock this
 * shows, because read-only is per connection. Locking is free; unlocking asks
 * the connection's environment name back, which the modal handles.
 *
 * It also names the active connection's environment. The rail used to carry that
 * as a colour; now the rail's colour is the workspace's, so the environment shows
 * here as text -- grayscale like everything in this bar, since the rail no longer
 * has a hue to duplicate.
 */
export default function StatusBar() {
  const { connectionId, readOnly, environment, name, setReadOnly } = useSession();
  const [confirming, setConfirming] = useState(false);

  // Shell only renders while connected, so this is set -- but the type is nullable
  // and nothing here is worth drawing without it.
  if (!connectionId || !environment) return null;

  function toggle(): void {
    // Turning read-only *on* is the safe direction, so it is immediate. Turning
    // it off is the one that needs the confirmation.
    if (readOnly) setConfirming(true);
    else if (connectionId) setReadOnly(connectionId, true);
  }

  const Icon = readOnly ? ReadOnlyIcon : WritableIcon;

  return (
    <footer className="statusbar">
      <button
        type="button"
        className="statusbar__lock"
        onClick={toggle}
        title={readOnly ? 'This connection is read-only. Click to allow writes.' : 'Click to make this connection read-only.'}
      >
        <Icon className="icon" />
        {readOnly ? 'Read-only' : 'Writable'}
      </button>

      <span className="statusbar__env" title="The environment this connection is in">
        {environmentLabel(environment)}
      </span>

      {confirming && (
        <ReadOnlyConfirm
          environment={environment}
          name={name}
          onConfirm={() => {
            setConfirming(false);
            setReadOnly(connectionId, false);
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </footer>
  );
}
