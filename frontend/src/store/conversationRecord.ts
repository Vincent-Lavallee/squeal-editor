import type { AiMessage } from '../../../shared/protocol/index.ts';

/**
 * What the thread shows about a tool call, beside the wire message recording it.
 *
 * `args` and `result` are held here rather than read back off the conversation
 * because the row that draws them would otherwise have to join two messages by
 * id on every render -- the call's arguments live on the assistant message and
 * its answer on a `tool` message somewhere after it.
 */
export interface ToolRecord {
  name: string;
  /** "orders · prod-replica" -- what the row and the approval card are about. */
  target: string;
  outcome: 'ran' | 'failed' | 'rejected';
  args: string;
  result: string;
  /**
   * What this call's answer looks like once it is **written down**, for a call
   * whose answer carried database values -- `128 rows of users(id, email,
   * created_at)`. Absent on every other call, which is written down as it
   * stands.
   *
   * The tool that returned the values is what produced this, at the moment it
   * answered; see `Tool.summarise` in `features/assistant/tools.ts`. Keeping it
   * beside the real result rather than replacing it is what lets the thread on
   * screen go on showing what the model was actually given, while the copy that
   * reaches the disk is the shape.
   */
  stored?: string;
}

/**
 * One conversation as it is kept on disk.
 *
 * An opaque string to the extension -- `connection_sessions`'s rule applied to a
 * thread -- so this file is the only place its shape is written down, the same
 * way `sessionSnapshot.ts` is for a session. It lives beside that one rather
 * than inside `assistantSlice` so the slice and the listener that persists it
 * both read the shape from one place, with the arrow pointing one way.
 *
 * What it holds is the conversation **minus its values**: see `toStored`.
 */
export interface StoredConversation {
  messages: AiMessage[];
  tools: Record<string, ToolRecord>;
}

/**
 * The conversation as it is written down: every attached result reduced to its
 * shape.
 *
 * This is the whole of the rule the feature was built around. Rows leave the
 * process on exactly one gesture -- the model calling `getTabResult`, which
 * leaves a row in the thread naming what it read -- and that gesture is about
 * answering a question now, not about those values sitting in `squeal.db`
 * afterwards, in a table nothing encrypts the way a password is. So a call that
 * carried values is stored as `128 rows of users(id, email, created_at)`, in
 * both places it appears: the `tool` message the model would be re-sent, and the
 * record the thread's disclosure draws.
 *
 * **What this does not reach, stated rather than hidden:** an answer that quotes
 * a value it read is prose, and prose is stored as written. Redacting that would
 * mean rewriting the model's sentences, which is a different and much worse
 * thing to do to a transcript. The rule is about the mechanical copy of a result
 * set, which is where the bulk of it would otherwise be.
 */
export function toStored({ messages, tools }: StoredConversation): StoredConversation {
  const shapeOf = (callId: string | undefined): string | undefined =>
    callId === undefined ? undefined : tools[callId]?.stored;

  return {
    messages: messages.map((message) => {
      const shape = message.role === 'tool' ? shapeOf(message.toolCallId) : undefined;
      return shape === undefined ? message : { ...message, content: shape };
    }),
    tools: Object.fromEntries(
      Object.entries(tools).map(([callId, { stored, ...record }]) => [
        callId,
        stored === undefined ? record : { ...record, result: stored },
      ])
    ),
  };
}

/**
 * Decode a stored conversation, or `null` for a body that does not parse.
 *
 * `parseSnapshot`'s reason, and its answer: the store hands back the string this
 * side wrote, so a parse failure is only reachable across a format change, and
 * an empty thread beats refusing to open the tab.
 */
export function parseConversation(raw: string): StoredConversation | null {
  try {
    const parsed = JSON.parse(raw) as StoredConversation;
    return Array.isArray(parsed.messages) ? { messages: parsed.messages, tools: parsed.tools ?? {} } : null;
  } catch {
    return null;
  }
}
