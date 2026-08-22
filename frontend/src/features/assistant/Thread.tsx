/**
 * The conversation, its tool calls, and the card that stops one.
 *
 * **Every tool call leaves a row**, not only the ones that asked permission.
 * The silent ones are exactly the calls with no approval card to remember them
 * by, so a thread that showed only the interruptions would have no record of
 * what the model actually read -- which is the first thing anyone wants when it
 * produces a confidently wrong query.
 */

import { useEffect, useRef, useState } from 'react';
import { ThinkingOrb } from 'thinking-orbs';

import Badge from '../../common/components/Badge.tsx';
import Button from '../../common/components/Button.tsx';
import Callout from '../../common/components/Callout.tsx';
import { AssistantIcon, DisclosureIcon, ToolIcon } from '../../common/icons/icons.ts';
import * as t from '../../common/tokens';
import type { PendingApproval, ToolRecord } from '../../store/assistantSlice.ts';
import type { AiMessage } from '../../../../shared/protocol/index.ts';
import Markdown from './Markdown.tsx';

interface Props {
  messages: AiMessage[];
  tools: Record<string, ToolRecord>;
  streaming: string;
  running: boolean;
  pending: PendingApproval | null;
  error: string | null;
  onApprove: (always: boolean) => void;
  onReject: () => void;
}

export default function Thread({ messages, tools, streaming, running, pending, error, onApprove, onReject }: Props) {
  const end = useRef<HTMLDivElement>(null);

  // Keyed on the length and the streaming text, so the view follows an answer as
  // it is generated rather than only when one lands.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, streaming, pending]);

  if (!messages.length && !running) return <EmptyState />;

  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', gap: t.GAP_LG, padding: t.GAP_LG, overflowY: 'auto' }} data-testid="ai-thread">
      {messages.map((message, index) => (
        <Message key={index} message={message} tools={tools} />
      ))}

      {streaming ? <Prose text={streaming} /> : null}
      {running && !streaming && !pending ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, color: t.TEXT_FAINT, fontSize: t.TEXT_BODY }}>
          <ThinkingOrb state="shaping" size={20} theme="dark" aria-label="Thinking" />
          Thinking…
        </div>
      ) : null}
      {pending ? <ApprovalCard pending={pending} onApprove={onApprove} onReject={onReject} /> : null}
      {error ? <Callout>{error}</Callout> : null}

      <div ref={end} />
    </div>
  );
}

/**
 * A conversation with nothing in it yet.
 *
 * Centred rather than pinned to the top, and given its glyph, because an empty
 * pane reads as *broken* when its only content is two sentences hanging in the
 * top-left corner. The words are unchanged; what changed is that they are
 * arranged like an invitation rather than like an error nobody styled.
 *
 * The mark is `--text-faint` and the copy steps down from `--text` to
 * `--text-muted`: one background, structure from spacing and weight, no card
 * around it. Anything boxed here would be the "lighter surface" rule 1 has no
 * room for.
 */
function EmptyState() {
  return (
    <div data-testid="ai-empty"
      style={{ display: 'flex', flex: 1, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: t.GAP, padding: `${t.GAP_XL}px ${t.GAP_XL}px 15%`, textAlign: 'center' }}>
      <AssistantIcon style={{ flex: 'none', width: 28, height: 28, color: t.TEXT_FAINT }} aria-hidden="true" />
      <div style={{ color: t.TEXT, fontSize: t.TEXT_TITLE, fontWeight: 600 }}>Ask about the database you are connected to.</div>
      <div style={{ maxWidth: 380, color: t.TEXT_MUTED, fontSize: t.TEXT_BODY, lineHeight: 1.5 }}>
        It can read your schema, your open tabs and the error on screen. It asks before running anything or changing a tab.
      </div>
    </div>
  );
}

function Message({ message, tools }: { message: AiMessage; tools: Record<string, ToolRecord> }) {
  // A tool *result* is not drawn: the call's own row already stands for it, and
  // the raw JSON below it would be the transcript arguing with itself.
  if (message.role === 'tool') return null;

  if (message.role === 'user') {
    return (
      <div style={{ alignSelf: 'flex-end', maxWidth: '85%', padding: `${t.GAP_SM}px ${t.GAP}px`, border: `1px solid ${t.BORDER_STRONG}`, borderRadius: t.RADIUS_LG, fontSize: t.TEXT_BODY, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {message.content}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: t.GAP_SM }}>
      {message.content ? <Prose text={message.content} /> : null}
      {message.toolCalls?.map((call) => <ToolRow key={call.id} record={tools[call.id]} name={call.name} />)}
    </div>
  );
}

/**
 * The answer's text.
 *
 * It handled fenced code and nothing else for a while, on the reading that the
 * fence is the only markup that matters in an answer about SQL. Models format
 * their answers regardless, so what that shipped was tables as raw pipes and
 * `**` around words meant to be bold. `Markdown.tsx` is the hand-rolled subset
 * that replaced it — still no dependency, still no raw HTML, still nothing
 * clickable. See `docs/decisions.md`.
 */
const Prose = ({ text }: { text: string }) => <Markdown text={text} />;

/**
 * One call, collapsed to a line. Expanding it is how "what did it just read" is
 * answered — which is the whole reason the row exists, so the disclosure has to
 * actually disclose something.
 *
 * `args` and `result` come off the record rather than being joined out of the
 * conversation here: the arguments live on the assistant message and the answer
 * on a `tool` message somewhere after it, and re-pairing them by id on every
 * render is work the slice already did once.
 */
/**
 * What the second half of an expanded row is called. A stopped call's "result"
 * is the app saying why it never ran, and *Received* over that would read as an
 * answer from a database that was never asked.
 */
const RESULT_LABEL: Record<ToolRecord['outcome'], string> = { ran: 'Received', rejected: 'Received', failed: 'Error', stopped: 'Not run' };

function ToolRow({ record, name }: { record: ToolRecord | undefined; name: string }) {
  const [open, setOpen] = useState(false);
  const outcome = record?.outcome;

  return (
    <div style={{ fontSize: t.TEXT_BADGE }}>
      <button
        data-testid="ai-tool-row"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, width: '100%', padding: `2px ${t.GAP_SM}px`, border: 'none', borderRadius: t.RADIUS, background: 'none', color: t.TEXT_MUTED, font: 'inherit', fontSize: t.TEXT_BADGE, textAlign: 'left', cursor: 'pointer' }}
      >
        <DisclosureIcon style={{ flex: 'none', width: t.ICON, height: t.ICON, transform: open ? 'rotate(90deg)' : undefined }} />
        <ToolIcon style={{ flex: 'none', width: t.ICON, height: t.ICON }} />
        <span style={{ flex: 'none', fontFamily: t.MONO }}>{record?.name ?? name}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', color: t.TEXT_FAINT, textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{record?.target}</span>
        {outcome === 'rejected' ? <Badge kind="neutral">declined</Badge> : null}
        {outcome === 'stopped' ? <Badge kind="neutral">not run</Badge> : null}
        {outcome === 'failed' ? <Badge kind="red">failed</Badge> : null}
      </button>

      {open && record ? (
        <div data-testid="ai-tool-detail" style={{ display: 'flex', flexDirection: 'column', gap: t.GAP_XS, margin: `${t.GAP_XS}px 0 0 ${t.ICON + t.GAP_SM}px`, paddingLeft: t.GAP_SM, borderLeft: `1px solid ${t.BORDER}` }}>
          <Snippet label="Sent" text={record.args} />
          <Snippet label={RESULT_LABEL[record.outcome]} text={record.result} tone={outcome === 'failed' ? 'error' : 'normal'} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * One half of an expanded call.
 *
 * The result is capped rather than scrolled: a `getRelationships` answer is tens
 * of kilobytes of JSON, and a box that long buries the conversation it is
 * supposed to annotate. What is worth reading is at the front.
 */
function Snippet({ label, text, tone = 'normal' }: { label: string; text: string; tone?: 'normal' | 'error' }) {
  const CAP = 2000;
  const shown = text.length > CAP ? `${text.slice(0, CAP)}\n… ${text.length - CAP} more characters` : text;

  return (
    <div>
      <div style={{ color: t.TEXT_FAINT, fontSize: t.TEXT_LABEL, letterSpacing: t.TRACKING_LABEL, textTransform: 'uppercase' }}>{label}</div>
      <pre style={{ maxHeight: 220, margin: 0, overflow: 'auto', color: tone === 'error' ? t.RED_TEXT : t.TEXT_MUTED, fontFamily: t.MONO, fontSize: t.TEXT_BADGE, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {shown}
      </pre>
    </div>
  );
}

function ApprovalCard({ pending, onApprove, onReject }: { pending: PendingApproval; onApprove: (always: boolean) => void; onReject: () => void }) {
  const [always, setAlways] = useState(false);

  return (
    <div data-testid="ai-approval" style={{ display: 'flex', flexDirection: 'column', gap: t.GAP, padding: t.GAP_LG, border: `1px solid ${t.ACCENT}`, borderRadius: t.RADIUS_LG, background: t.SELECTED }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, fontSize: t.TEXT_BODY }}>
        <AssistantIcon style={{ flex: 'none', width: t.ICON, height: t.ICON }} />
        <span style={{ fontFamily: t.MONO, fontWeight: 600 }}>{pending.name}</span>
        <span style={{ color: t.TEXT_MUTED }}>{pending.target}</span>
      </div>

      <pre style={{ maxHeight: 200, margin: 0, padding: t.GAP, overflow: 'auto', border: `1px solid ${t.BORDER}`, borderRadius: t.RADIUS, color: t.TEXT_MUTED, fontFamily: t.MONO, fontSize: t.TEXT_BADGE }}>
        {pending.args}
      </pre>

      {/* Not offered for `getTabResult` at all, and not on a production
          connection: the grant is a convenience, and those are the two places
          this app spends friction rather than saving it. */}
      {pending.offerAlways ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: t.GAP_SM, color: t.TEXT_MUTED, fontSize: t.TEXT_BADGE, cursor: 'pointer' }}>
          <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />
          Allow this tool on this connection for the rest of the conversation
        </label>
      ) : null}

      <div style={{ display: 'flex', gap: t.GAP_SM }}>
        <Button variant="primary" style={{ flex: 1 }} onClick={() => onApprove(always)} data-testid="ai-approve">Approve</Button>
        <Button onClick={onReject} data-testid="ai-reject">Reject</Button>
      </div>
    </div>
  );
}
