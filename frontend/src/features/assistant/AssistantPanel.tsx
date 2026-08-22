/**
 * One assistant tab's body: a bar, the thread, and the composer.
 *
 * **A tab is a conversation**, so everything here is keyed by the tab it is
 * drawn in and several may be open at once. What is *not* per-tab is the
 * account — whose key is stored, the catalog, the chosen model, the approval
 * mode — which is why it arrives through a second hook.
 */

import { useEffect, useState } from 'react';

import Button from '../../common/components/Button.tsx';
import Select from '../../common/components/Select.tsx';
import { AssistantIcon, NewConversationIcon, SendIcon, StopIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';
import { loadModels, useAssistantAccount, useConversation } from '../../store/assistantSlice.ts';
import { useAppDispatch } from '../../store/hooks.ts';
import type { AiApprovalMode } from '../../../../shared/protocol/index.ts';
import Connect from './Connect.tsx';
import History from './History.tsx';
import Thread from './Thread.tsx';

const MODES: { value: AiApprovalMode; label: string; hint: string }[] = [
  { value: 'manual', label: 'Ask every time', hint: 'Every query it wants to run stops for you.' },
  { value: 'auto', label: 'Auto-approve', hint: 'It runs queries without asking — except on a production connection.' },
  { value: 'bypass', label: 'Bypass', hint: 'Nothing stops it, production included.' },
];

export default function AssistantPanel({ tabId }: { tabId: string }) {
  const dispatch = useAppDispatch();
  const account = useAssistantAccount();
  const conversation = useConversation(tabId);
  const [draft, setDraft] = useState('');

  const { status } = account;
  const ready = status?.state === 'ready';

  /*
   * The most recent turn's `inputTokens` is the size of everything sent to get
   * that reply -- the rebuilt context, every message before it, every tool
   * definition -- so it is this conversation's current footprint, not a running
   * total the way `outputTokens` summed across turns would be. Read backwards
   * because the last assistant message is usually the most recent one and this
   * skips a full-array pass on every render of a long thread.
   */
  let contextTokens: number | null = null;
  for (let i = conversation.messages.length - 1; i >= 0; i -= 1) {
    const usage = conversation.messages[i]?.usage;
    if (usage) {
      contextTokens = usage.inputTokens + usage.outputTokens;
      break;
    }
  }

  // The catalog is read once a key is stored, not at launch: it is that key's
  // catalog, so asking before there is one would only ever fail. Several tabs
  // asking is one fetch's worth of waste and no correctness problem.
  useEffect(() => {
    if (ready) void dispatch(loadModels());
  }, [dispatch, ready]);

  const submit = () => {
    const text = draft.trim();
    if (!text || conversation.running) return;
    setDraft('');
    conversation.send(text);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, height: '100%' }} data-testid="assistant-panel">
      {/*
        The bar holds only what acts on this conversation. Which provider is in
        use, and removing its key, are the status bar's — they are facts about
        the app rather than about this tab. The model and the mode live in the
        composer footer, where there is width for them.
      */}
      <div style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, flex: 'none', height: t.TAB_H, padding: `0 ${t.GAP_SM}px`, borderBottom: `1px solid ${t.BORDER}` }}>
        <AssistantIcon style={{ flex: 'none', width: t.ICON, height: t.ICON, color: t.TEXT_MUTED }} />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', color: t.TEXT_MUTED, fontSize: t.TEXT_BADGE, fontWeight: 600, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          Assistant
        </span>
        {contextTokens !== null ? (
          <span title={`This conversation's last turn sent ${contextTokens.toLocaleString()} tokens of context.`}
            style={{ flex: 'none', color: t.TEXT_FAINT, fontSize: t.TEXT_BADGE, fontVariantNumeric: 'tabular-nums' }}>
            {formatTokenCount(contextTokens)} tokens
          </span>
        ) : null}
        {/* The history is offered whether or not this tab holds anything --
            reaching a past conversation is most wanted from an empty one --
            while starting a new one only appears once there is one to leave.

            A `+` and not a bin: nothing is destroyed by it. The thread being
            left keeps its stored row and is in the popup beside this button by
            the time the next message lands, so the gesture is *start another*
            rather than *throw this away*, and the glyph has to say the same
            thing the behaviour does. */}
        {ready ? <History tabId={tabId} onOpen={conversation.open} disabled={conversation.running} /> : null}
        {ready && conversation.messages.length ? (
          <Button variant="ghost" style={{ flex: 'none', height: t.BUTTON_H_BAR, padding: '0 6px' }} onClick={conversation.startNew}
            title="New conversation" aria-label="New conversation" data-testid="ai-new-conversation">
            <NewConversationIcon style={{ width: t.ICON, height: t.ICON }} />
          </Button>
        ) : null}
      </div>

      {status === null ? (
        <div style={{ padding: t.GAP_XL, color: t.TEXT_FAINT, fontSize: t.TEXT_BODY }}>Checking for an API key…</div>
      ) : !ready ? (
        <Connect status={status} connecting={account.connecting} error={account.connectError} onConnect={account.saveKey} />
      ) : (
        <>
          <Thread
            messages={conversation.messages}
            tools={conversation.tools}
            streaming={conversation.streaming}
            running={conversation.running}
            pending={conversation.pending}
            error={conversation.error}
            onApprove={conversation.approve}
            onReject={conversation.reject}
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: t.GAP_SM, flex: 'none', padding: t.GAP_SM, borderTop: `1px solid ${t.BORDER}` }}>
            {/*
              `stretch`, not `flex-end`: the button is the box's height rather
              than a control parked at its bottom corner, which is what the two
              of them being one input wants to look like.
            */}
            <div style={{ display: 'flex', alignItems: 'stretch', gap: t.GAP_SM }}>
              <textarea
                data-testid="ai-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                // Enter sends and Shift+Enter breaks the line, which is the chat
                // idiom -- and the box is a textarea rather than an input precisely
                // so the second half is possible.
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={2}
                placeholder="Ask about your schema, a query, or an error…"
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: t.GAP_SM,
                  border: `1px solid ${t.BORDER_STRONG}`,
                  borderRadius: t.RADIUS,
                  background: t.BG,
                  color: t.TEXT,
                  font: 'inherit',
                  fontSize: t.TEXT_BODY,
                  resize: 'none',
                }}
              />
              {conversation.running ? (
                <Button onClick={conversation.cancel} title="Stop" aria-label="Stop" data-testid="ai-cancel"
                  style={{ height: 'auto', alignSelf: 'stretch' }}>
                  <StopIcon style={{ width: t.ICON, height: t.ICON }} />
                </Button>
              ) : (
                <Button variant="primary" onClick={submit} disabled={!draft.trim()} title="Send" aria-label="Send" data-testid="ai-send"
                  style={{ height: 'auto', alignSelf: 'stretch' }}>
                  <SendIcon style={{ width: t.ICON, height: t.ICON }} />
                </Button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, minWidth: 0 }}>
              {account.models.length ? (
                <div style={{ flex: '0 1 auto', minWidth: 0, maxWidth: 240 }}>
                  <Select variant="bare" searchable align="start" data-testid="ai-model-select"
                    value={account.model ?? ''} options={account.models.map((model) => ({ value: model.id, label: model.name }))}
                    onSelect={account.chooseModel} />
                </div>
              ) : null}

              <div style={{ flex: 1, minWidth: 0 }} />

              <div style={{ flex: 'none', width: 132 }}>
                <Select variant="bare" align="end" data-testid="ai-mode-select"
                  value={account.mode} options={MODES.map((mode) => ({ value: mode.value, label: mode.label }))}
                  onSelect={(value) => account.setMode(value as AiApprovalMode)}
                  title={MODES.find((mode) => mode.value === account.mode)?.hint} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** "842", "12.4K" -- a badge, not a precise reading, so it drops to one decimal past three digits rather than ever growing a comma. */
function formatTokenCount(count: number): string {
  return count < 1000 ? `${count}` : `${(count / 1000).toFixed(1)}K`;
}
