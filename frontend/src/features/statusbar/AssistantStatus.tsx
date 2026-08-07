/**
 * Which provider the assistant is talking to, with the way out behind it.
 *
 * It is here rather than in the assistant tab's own header because it is a fact
 * about the **app**, not about that tab: one key serves every conversation, and
 * the status bar is where this app already states things that are true of the
 * whole window (the read-only lock, the environment). Keeping it in the tab also
 * meant it only existed while that tab was open, which is the wrong answer for
 * "is this thing set up".
 *
 * A menu rather than a bare button, for the reason the tab strip's close is not a
 * bare button either: throwing away a key is not a thing to do by mis-clicking a
 * status bar, and a menu makes the click that does it a second one.
 */

import { useState } from 'react';

import ContextMenu from '../../common/components/ContextMenu.tsx';
import { AssistantIcon } from '../../common/icons/icons.ts';
import { useAssistantAccount } from '../../store/assistantSlice.ts';
import { useTabs } from '../../store/tabsSlice.ts';
import { providerLabel } from '../../../../shared/protocol/index.ts';
import * as t from '../../common/tokens';

export default function AssistantStatus() {
  const { status, anyRunning, forgetKey } = useAssistantAccount();
  const { openAssistantTab } = useTabs();
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [hovered, setHovered] = useState(false);

  // Nothing at all until the launch read lands, rather than a segment that says
  // "checking" and then changes width under the controls beside it.
  if (status === null) return null;

  const connected = status.state === 'ready';
  // The provider's name, because that is the fact worth a segment: *which* model
  // is answering is chosen per conversation and stated in the composer, but who
  // is being billed is true of the whole window.
  const provider = status.provider ? providerLabel(status.provider) : null;
  const label = connected && provider ? provider : 'Assistant';
  const title = connected
    ? `Assistant: using your ${provider ?? 'stored'} API key`
    : status.state === 'unavailable'
      ? `The stored API key could not be read: ${status.reason ?? 'the keychain would not answer'}`
      : 'No API key yet';

  return (
    <>
      <button type="button" data-testid="statusbar-assistant"
        style={{
          display: 'flex', alignItems: 'center', gap: t.GAP_XS, height: '100%', padding: `0 ${t.GAP}px`,
          border: 'none', borderLeft: `1px solid ${t.BORDER}`, background: hovered ? t.HOVER : 'none',
          // Grayscale like every other segment here: having a key is a state,
          // not a status, so it spends no hue. The dot below is the exception and
          // it is `--accent` because it means "this is happening now".
          color: hovered ? t.TEXT : connected ? t.TEXT_MUTED : t.TEXT_FAINT,
          font: 'inherit', fontSize: t.TEXT_BADGE, cursor: 'pointer',
        }}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        onClick={(e) => setMenuAt({ x: e.clientX, y: e.currentTarget.getBoundingClientRect().top })}
        title={title}>
        <AssistantIcon style={{ flex: 'none', width: t.ICON, height: t.ICON }} />
        <span style={{ overflow: 'hidden', maxWidth: 140, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {anyRunning && (
          <span data-testid="statusbar-assistant-busy" aria-hidden="true"
            style={{ flex: 'none', width: 5, height: 5, borderRadius: t.RADIUS_PILL, background: t.ACCENT }} />
        )}
      </button>

      {menuAt && (
        <ContextMenu x={menuAt.x} y={menuAt.y} onClose={() => setMenuAt(null)}
          items={
            connected
              ? [
                  { label: `Using your ${provider ?? 'stored'} API key`, disabled: true, onSelect: () => undefined },
                  { label: 'Remove the API key', danger: true, onSelect: forgetKey },
                ]
              : [
                  { label: title, disabled: true, onSelect: () => undefined },
                  /*
                   * Adding a key *starts* here and *happens* in a tab. The form is
                   * a provider, a field and a warning about which product sells
                   * one, and a 26px strip has nowhere to put any of that -- so
                   * this opens the tab that already draws it rather than growing a
                   * second copy of that screen.
                   */
                  { label: 'Add an API key', onSelect: openAssistantTab },
                ]
          }
        />
      )}
    </>
  );
}
