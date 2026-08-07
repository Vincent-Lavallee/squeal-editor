/**
 * The assistant: the conversation, and the loop that advances it.
 *
 * A slice by the usual test -- every message crossed the bridge, since the
 * extension is what sent it. What is *not* here is the panel's own furniture
 * (whether it is open, how wide it is), which has never left the webview.
 *
 * **The loop runs on this side**, which is the design's one surprising part and
 * has one reason: nine of the fifteen tools answer from the tabs, the editor
 * selection and the results, none of which the extension has heard of. The
 * extension holds the API key and makes the request; deciding what to do with
 * the answer is up here, where the answer is about things that live up here. See
 * `docs/decisions.md`.
 */

import { createSlice, isAnyOf, nanoid, type PayloadAction } from '@reduxjs/toolkit';
import { useCallback, useEffect, useMemo } from 'react';

import { call } from '../common/bridge/bridge.ts';
import { buildContext } from '../features/assistant/context.ts';
import { TOOL_DEFS, toolByName, type ToolContext } from '../features/assistant/tools.ts';
import { parseConversation, type ToolRecord } from './conversationRecord.ts';
import { useAppDispatch, useAppSelector } from './hooks.ts';
import { connectionActivated, disconnect } from './sessionSlice.ts';
import { saveSetting } from './settingsSlice.ts';
import { tabActivated, tabRenamed, tabsClosed } from './tabsSlice.ts';
import { createAppThunk, errorMessage } from './thunk.ts';
import type { AppDispatch, RootState } from './index.ts';
import type {
  AiApprovalMode,
  AiConversationSummary,
  AiMessage,
  AiModel,
  AiProvider,
  AiStatus,
  AiToolCall,
} from '../../../shared/protocol/index.ts';

/**
 * How many tools one turn may call before the loop stops and says so.
 *
 * A ceiling rather than only a Cancel button, because every call here is a real
 * round trip to a real database: a model looping on `getSchema` would hammer the
 * server for as long as nobody was watching, and "nobody was watching" is the
 * normal state of a panel behind a collapsed titlebar toggle.
 */
const MAX_TOOL_CALLS = 30;

/** A turn that calls tools can run for minutes; the bridge's own default would give up first. */
const TURN_TIMEOUT_MS = 5 * 60_000;

export type { ToolRecord } from './conversationRecord.ts';

export interface PendingApproval {
  callId: string;
  name: string;
  target: string;
  /** The model's arguments, pretty-printed, so the card can show exactly what was asked for. */
  args: string;
  /**
   * The connection the grant would cover, or null when the call names none.
   *
   * A grant is **per connection** so it cannot travel to a server the user was
   * not thinking about when they gave it.
   */
  connectionId: string | null;
  /**
   * Whether "allow for this conversation" may be offered at all.
   *
   * False on a `production` connection, where the app already treats the
   * environment as a reason for more friction rather than less -- the same line
   * the `auto` approval mode draws.
   */
  offerAlways: boolean;
}

/**
 * One conversation, which is one assistant tab's.
 *
 * **Keyed by tab, not global.** It shipped as a single thread every tab was a
 * window onto, which is why opening a second one used to focus the first
 * instead: two identical views of one conversation is not a second tab, it is
 * the same tab drawn twice. Once several tabs are worth having, each has to be
 * worth having *something different in it* -- so a tab is a conversation, the
 * way a tab is a query. See `docs/decisions.md`.
 *
 * Everything above this in `AssistantState` is about the **account** — who is
 * signed in, what models exist, which one is chosen — and stays singular,
 * because none of it is a fact about one thread.
 */
export interface Conversation {
  /**
   * The stored row this thread is, or `null` while it is nothing yet.
   *
   * Minted on the first message rather than when the tab opens, so an assistant
   * tab opened and closed without a word leaves nothing behind. It is what
   * `conversations.save` writes under and what a restored tab is reopened from,
   * so it outlives the tab id everything else here is keyed by — the same split
   * `Tab.savedQueryId` draws between a runtime id and a stored one.
   */
  id: string | null;
  /** The conversation as the model sees it, minus the context rebuilt each turn. */
  messages: AiMessage[];
  tools: Record<string, ToolRecord>;
  turnId: string | null;
  /** The text of the answer being generated, before it lands as a message. */
  streaming: string;
  pending: PendingApproval | null;
  autoApproved: string[];
  error: string | null;
}

interface AssistantState {
  /** Null until the launch read lands, so the UI can tell "not yet" from "no key stored". */
  status: AiStatus | null;
  connecting: boolean;
  models: AiModel[];
  model: string | null;
  /** A failure of the *key* — connecting, a catalog read — as opposed to one thread's. */
  connectError: string | null;
  /**
   * Keyed by tab id, and **pruned when the tab closes** — the rule everything
   * keyed by a tab here follows, so the store never holds threads for tabs it
   * cannot enumerate. `tabsClosed` and `disconnect.fulfilled` are the two ways a
   * tab leaves, and both are matched below.
   */
  byTab: Record<string, Conversation>;
  /**
   * Every kept conversation, newest first, **without its body** — what the
   * history popup draws.
   *
   * Re-read each time that popup opens rather than held behind a `loaded` flag
   * the way the saved queries are: a title and a timestamp both move while a
   * conversation is being had, so a list cached once at launch is a list of
   * yesterday's names.
   */
  history: AiConversationSummary[];
}

const blankConversation = (): Conversation => ({
  id: null,
  messages: [],
  tools: {},
  turnId: null,
  streaming: '',
  pending: null,
  autoApproved: [],
  error: null,
});

/** The conversation for a tab, minted on first use — a tab that has never been asked anything has none. */
const conversationFor = (state: AssistantState, tabId: string): Conversation => (state.byTab[tabId] ??= blankConversation());

export const EMPTY_CONVERSATION: Conversation = blankConversation();

/**
 * The approval mode's settings key, and the reason it is a setting at all.
 *
 * Unlike `autoApproved` -- a grant that belongs to one conversation and dies
 * with it -- this is how the user wants to work, so it outlives a thread and a
 * restart. `manual` is the default for a key nobody has written.
 */
export const APPROVAL_MODE_KEY = 'assistant.approvalMode';

/**
 * Whether a question can actually be sent right now.
 *
 * A boolean and not the status object, because its reader is `Shell` — asking
 * for the whole slice there would re-render the composition root on every
 * streaming delta, and what it needs is one flag that moves twice a session.
 */
export const selectAssistantReady = (s: RootState): boolean => s.assistant.status?.state === 'ready';

/** Read from the settings slice rather than mirrored here, so there is one source for it. */
export const selectApprovalMode = (s: { settings: { values: Record<string, string> } }): AiApprovalMode => {
  const stored = s.settings.values[APPROVAL_MODE_KEY];
  return stored === 'auto' || stored === 'bypass' ? stored : 'manual';
};

const initialState: AssistantState = {
  status: null,
  connecting: false,
  models: [],
  model: null,
  connectError: null,
  byTab: {},
  history: [],
};

/* ------------------------------------------------------------------ *
 * Reaching a provider
 * ------------------------------------------------------------------ */

export const loadAiStatus = createAppThunk('assistant/status', async (_: void, { rejectWithValue }) => {
  try {
    return await call('ai.status', {});
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/**
 * Hand a pasted key to the extension, which proves it before keeping it.
 *
 * The key travels once, on this call, and never comes back: what resolves is a
 * status naming the provider. Nothing in the store ever holds the key, so
 * nothing that renders from the store can leak it.
 */
export const connect = createAppThunk('assistant/connect', async ({ provider, key }: { provider: AiProvider; key: string }, { rejectWithValue }) => {
  try {
    return await call('ai.connect', { provider, key });
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/** Named for what it does rather than for its command, so it cannot be read as the *connection*'s disconnect. */
export const removeKey = createAppThunk('assistant/removeKey', async (_: void, { rejectWithValue }) => {
  try {
    await call('ai.disconnect', {});
    return true;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/** The catalog for the stored key. The extension decides which row is the default; see `preferredModel`. */
export const loadModels = createAppThunk('assistant/models', async (_: void, { rejectWithValue }) => {
  try {
    const { models } = await call('ai.models', {});
    return models;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/**
 * The default model: the one the extension marked while reading the catalog.
 *
 * Expressed as a *rule over the catalog* rather than as an id, for the reason
 * the catalog is fetched at all -- which model is current moves every few months
 * and a hardcoded default is stale before anyone notices. Which rule that is,
 * per provider, is the extension's to know; this side only reads the mark.
 *
 * It is deliberately **not** chosen by price, even though the user now pays per
 * token. Cost was reported here for a while and is gone entirely; see
 * `docs/decisions.md`.
 */
export function preferredModel(models: AiModel[]): string | null {
  return (models.find((model) => model.isDefault) ?? models[0])?.id ?? null;
}

/* ------------------------------------------------------------------ *
 * Conversations that outlive the tab they were had in
 * ------------------------------------------------------------------ */

/** The picker's list. Read on every open, since a title and a date both move while a thread runs. */
export const loadConversations = createAppThunk('assistant/history', async (_: void, { rejectWithValue }) => {
  try {
    return (await call('conversations.list', {})).conversations;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/**
 * Which tab is holding a conversation, if any: the live link where the tab has
 * been looked at, the restored seed where it has not.
 *
 * The seed half is not defensive padding. A restored assistant tab does not
 * adopt its conversation until it is first drawn, so a tab sitting in the
 * background genuinely holds one while `byTab` says nothing about it — and
 * reopening that conversation elsewhere would put two tabs on it the moment the
 * background one came to front.
 */
export const tabHoldingConversation = (s: RootState, id: string): string | null =>
  s.tabs.tabs.find((tab) => {
    if (tab.kind !== 'assistant') return false;
    const held = s.assistant.byTab[tab.id];
    return (held ? held.id : tab.conversationId) === id;
  })?.id ?? null;

/**
 * Reach a conversation from the picker.
 *
 * **A conversation already open in another tab is gone *to*, not opened again.**
 * That is what keeps one thread out of two tabs without hiding it from the list:
 * two live threads would take turns saving their own messages over each other's,
 * and the loser is half a conversation rather than a keystroke. The connection
 * is activated alongside the tab, since a tab made active on a server the rail
 * is not showing is a click that appears to do nothing.
 *
 * Everything else loads, below.
 */
export const reachConversation = createAppThunk(
  'assistant/reach',
  async ({ tabId, id }: { tabId: string; id: string }, { dispatch, getState }) => {
    const holder = tabHoldingConversation(getState(), id);
    if (holder === tabId) return;

    if (holder !== null) {
      const tab = getState().tabs.tabs.find((t) => t.id === holder);
      if (tab) {
        dispatch(connectionActivated({ connectionId: tab.connectionId }));
        dispatch(tabActivated({ id: holder }));
        return;
      }
    }
    await dispatch(openConversation({ tabId, id }));
  }
);

/**
 * Put a stored conversation into a tab: the picker's *reopen*, and the way a
 * restored tab gets its thread back.
 *
 * The tab is renamed to what the conversation is called, so the strip says which
 * one is in front — and only when the two differ, since a tab restored from a
 * session snapshot already carries the name it was saved under.
 *
 * A body that no longer resolves is not a failure: an id can outlive its row
 * (deleted from the picker while a tab sat behind it), and the honest reading is
 * a tab that has come from nowhere again. It comes up empty and unlinked, so the
 * next message starts a conversation of its own.
 */
export const openConversation = createAppThunk(
  'assistant/open',
  async ({ tabId, id }: { tabId: string; id: string }, { dispatch, getState, rejectWithValue }) => {
    try {
      const { conversation } = await call('conversations.get', { id });
      if (!conversation) return null;

      const tab = getState().tabs.tabs.find((t) => t.id === tabId);
      if (tab && tab.title !== conversation.title) dispatch(tabRenamed({ id: tabId, title: conversation.title }));
      return { id: conversation.id, record: parseConversation(conversation.body) };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

/**
 * Write one thread. Dispatched by `conversationSyncListener`, which decides *when*.
 *
 * It answers with the summary rather than just the id, so `history` can be kept
 * current in place. Without that, a conversation started in one tab would be
 * missing from another tab's picker until something happened to re-read the
 * list — which is the same complaint hiding the open ones caused, arriving by a
 * slower route.
 */
export const saveConversation = createAppThunk(
  'assistant/save',
  async ({ id, title, body }: { id: string; title: string; body: string }, { rejectWithValue }) => {
    try {
      const { updatedAt } = await call('conversations.save', { id, title, body });
      return { id, title, updatedAt };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

/**
 * Forget one, from the picker.
 *
 * It may be a conversation a *different* tab is holding, now that the list shows
 * those — so the reducer below releases any tab pointing at it, the same answer
 * `deleteSavedQuery` gets from `tabsSlice`. What was deleted is the stored copy,
 * not the thread on screen.
 */
export const deleteConversation = createAppThunk('assistant/delete', async (id: string, { rejectWithValue }) => {
  try {
    await call('conversations.delete', { id });
    return id;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/* ------------------------------------------------------------------ *
 * The approval gate
 * ------------------------------------------------------------------ */

/**
 * The loop pauses here, and this is what un-pauses it.
 *
 * Module-level rather than in the state for the reason the bridge's own pending
 * map is: a promise resolver is not serialisable and nothing renders from it.
 * The state holds what the *card* needs; this holds the continuation.
 *
 * **Keyed by tab**, now that several conversations can be in flight at once: one
 * resolver would have a card answered in one tab releasing the loop parked in
 * another.
 */
const awaitingDecision = new Map<string, (decision: { approved: boolean; always: boolean }) => void>();

/** Which tabs have been asked to stop. Per tab for `awaitingDecision`'s reason. */
const cancelled = new Set<string>();

/* ------------------------------------------------------------------ *
 * One exchange
 * ------------------------------------------------------------------ */

const prettyArgs = (json: string): string => {
  try {
    return JSON.stringify(JSON.parse(json), null, 2);
  } catch {
    return json;
  }
};

export const sendMessage = createAppThunk(
  'assistant/send',
  async ({ tabId, text }: { tabId: string; text: string }, { dispatch, getState, rejectWithValue }) => {
    // Which tab failed is read off `action.meta.arg` in the reducer, so the
    // rejection stays the plain string every thunk in this app rejects with.
    const model = getState().assistant.model ?? preferredModel(getState().assistant.models);
    if (!model) return rejectWithValue('No model is available for the stored API key.');

    cancelled.delete(tabId);
    // A thread earns its stored row on its first message, not when the tab
    // opened: an assistant tab opened and closed without a word leaves nothing
    // behind. Minted here rather than in the reducer, which must stay pure, and
    // by this side rather than by the store, which would answer with an id the
    // debounced save needs before the first write has landed.
    const conversationId = getState().assistant.byTab[tabId]?.id ?? nanoid();
    dispatch(userSaid({ tabId, text, conversationId }));

    const toolContext: ToolContext = {
      getState,
      dispatch,
      // Which tab is *having* this conversation, so a tool that acts on it --
      // naming it, say -- addresses the right one when two are open.
      conversationTabId: tabId,
      // The one place the editor's global seam is read. It is the primary pane's
      // instance, which is what "the tab in front" already means everywhere else.
      selection: () => {
        const editor = window.squealEditor;
        const range = editor?.getSelection();
        const selected = range ? editor?.getModel()?.getValueInRange(range) : undefined;
        const connectionId = getState().session.activeConnectionId;
        const activeId = connectionId ? getState().tabs.activeTabId[connectionId] : null;
        return selected && activeId ? { tabId: activeId, text: selected } : null;
      },
    };

    let calls = 0;
    try {
      for (;;) {
        if (cancelled.has(tabId)) return true;

        const turnId = nanoid();
        dispatch(turnStarted({ tabId, turnId }));

        const { message } = await call(
          'ai.send',
          { turnId, model, messages: [...buildContext(getState()), ...(getState().assistant.byTab[tabId]?.messages ?? [])], tools: TOOL_DEFS },
          TURN_TIMEOUT_MS
        );
        dispatch(assistantSaid({ tabId, message }));

        if (!message.toolCalls?.length || cancelled.has(tabId)) return true;

        for (const toolCall of message.toolCalls) {
          if (cancelled.has(tabId)) return true;

          if (calls >= MAX_TOOL_CALLS) {
            dispatch(noticed({ tabId, text: `Stopped after ${MAX_TOOL_CALLS} tool calls. Ask again to continue.` }));
            return true;
          }
          calls += 1;
          await runOneCall(tabId, toolCall, toolContext, dispatch);
        }
      }
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

async function runOneCall(tabId: string, toolCall: AiToolCall, toolContext: ToolContext, dispatch: AppDispatch): Promise<void> {
  const tool = toolByName(toolCall.name);
  if (!tool) {
    dispatch(toolAnswered({ tabId, callId: toolCall.id, name: toolCall.name, target: '—', outcome: 'failed', args: toolCall.arguments, content: `No tool named ${toolCall.name}.` }));
    return;
  }

  // Malformed JSON is the model's mistake to correct, not the loop's to crash
  // on: it comes back as this call's result and the next turn usually fixes it.
  // The raw string is kept as the row's `args`, unformatted -- it is exactly
  // what could not be parsed, and prettifying it is not available anyway.
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(toolCall.arguments || '{}') as Record<string, unknown>;
  } catch {
    dispatch(toolAnswered({ tabId, callId: toolCall.id, name: tool.def.name, target: '—', outcome: 'failed', args: toolCall.arguments, content: 'Your arguments were not valid JSON. Send them again.' }));
    return;
  }

  const target = tool.target(args, toolContext);
  const pretty = prettyArgs(toolCall.arguments);
  const answer = (outcome: ToolRecord['outcome'], content: string, stored?: string) =>
    dispatch(toolAnswered({ tabId, callId: toolCall.id, name: tool.def.name, target, outcome, args: pretty, content, stored }));

  /*
   * Only a tool that *does* something asks. Reading is never gated -- not the
   * schema, not the tabs, and not the rows either: a card in front of every
   * lookup is a card nobody reads by the third one, which is worse than no card
   * because it looks like a guard. See `docs/decisions.md`.
   */
  if (tool.mutating === true) {
    const state = toolContext.getState();
    const connectionId = typeof args.connectionId === 'string' ? args.connectionId : (state.session.activeConnectionId ?? null);
    const isProduction = connectionId !== null && state.session.connections[connectionId]?.environment === 'production';
    // The grant belongs to *this* conversation, so a second assistant tab starts
    // with none of the permissions the first was given.
    const granted = connectionId !== null && (state.assistant.byTab[tabId]?.autoApproved.includes(connectionId) ?? false);
    const mode = selectApprovalMode(state);

    // `bypass` skips everything; `auto` skips everything but production, which
    // is the one distinction between the two modes. A grant from an earlier card
    // in this conversation counts the same as `auto` and is scoped the same way.
    const skip = mode === 'bypass' || ((mode === 'auto' || granted) && !isProduction);

    if (!skip) {
      const decision = await new Promise<{ approved: boolean; always: boolean }>((resolve) => {
        awaitingDecision.set(tabId, resolve);
        dispatch(
          approvalRequested({
            tabId,
            callId: toolCall.id,
            name: tool.def.name,
            target,
            args: pretty,
            connectionId,
            offerAlways: !isProduction,
          })
        );
      });

      if (!decision.approved) {
        answer('rejected', 'The user declined this. Do not retry it; ask them what to do instead.');
        return;
      }
      if (decision.always && connectionId) dispatch(autoApproved({ tabId, connectionId }));
    }
  }

  try {
    // The model gets the answer whole; `summarise` is what the *stored* copy of
    // it says instead, for the one tool whose answer carries database values.
    // Asking the tool rather than deciding here is the rule `mutating` already
    // follows: adding a tool that moves rows cannot quietly add a hole.
    const result = await tool.run(args, toolContext);
    answer('ran', JSON.stringify(result), tool.summarise?.(result, args, toolContext));
  } catch (err) {
    answer('failed', errorMessage(err));
  }
}

/**
 * Stop the turn in flight.
 *
 * Two halves, and both are needed: `ai.cancel` aborts the request the extension
 * has open, and the flag stops the loop from starting another one. Aborting
 * alone would leave the loop to take the rejection and carry on to the next tool
 * call it had already decided to make.
 */
export const cancelTurn = createAppThunk('assistant/cancel', async (tabId: string, { getState }) => {
  cancelled.add(tabId);
  const turnId = getState().assistant.byTab[tabId]?.turnId ?? null;
  // A loop parked on a card is released as a refusal, so cancelling while an
  // approval is up ends the turn rather than leaving it waiting forever.
  awaitingDecision.get(tabId)?.({ approved: false, always: false });
  awaitingDecision.delete(tabId);
  if (turnId) await call('ai.cancel', { turnId }).catch(() => undefined);
  return tabId;
});

const assistantSlice = createSlice({
  name: 'assistant',
  initialState,
  reducers: {
    userSaid(state, action: PayloadAction<{ tabId: string; text: string; conversationId: string }>) {
      const conversation = conversationFor(state, action.payload.tabId);
      // `??=`, so the id is the first message's and every message after it is
      // filed under the same one. A thread that already has a row keeps it.
      conversation.id ??= action.payload.conversationId;
      conversation.messages.push({ role: 'user', content: action.payload.text });
      conversation.error = null;
    },
    assistantSaid(state, action: PayloadAction<{ tabId: string; message: AiMessage }>) {
      const conversation = conversationFor(state, action.payload.tabId);
      conversation.messages.push(action.payload.message);
      conversation.streaming = '';
    },
    toolAnswered(state, action: PayloadAction<Omit<ToolRecord, 'result'> & { tabId: string; callId: string; content: string }>) {
      const { tabId, callId, content, ...record } = action.payload;
      const conversation = conversationFor(state, tabId);
      conversation.messages.push({ role: 'tool', toolCallId: callId, content });
      // `record.stored` rides along and is deliberately *not* written over
      // `result`: the thread on screen shows what the model was given, and the
      // shape is what reaches the disk. See `conversationRecord.ts`.
      conversation.tools[callId] = { ...record, result: content };
      conversation.pending = null;
    },
    noticed(state, action: PayloadAction<{ tabId: string; text: string }>) {
      conversationFor(state, action.payload.tabId).messages.push({ role: 'assistant', content: action.payload.text });
    },
    turnStarted(state, action: PayloadAction<{ tabId: string; turnId: string }>) {
      const conversation = conversationFor(state, action.payload.tabId);
      conversation.turnId = action.payload.turnId;
      conversation.streaming = '';
    },
    /**
     * A delta finds its conversation by the turn it names, rather than carrying a
     * tab id of its own.
     *
     * The broadcast comes from the extension, which has never heard of a tab —
     * and the turn id it echoes is unique across every conversation, so the
     * lookup is exact. It also self-corrects: a delta for a turn that has already
     * landed, or whose tab has closed, matches nothing and is dropped.
     */
    deltaReceived(state, action: PayloadAction<{ turnId: string; text: string }>) {
      const conversation = Object.values(state.byTab).find((entry) => entry.turnId === action.payload.turnId);
      if (conversation) conversation.streaming += action.payload.text;
    },
    approvalRequested(state, action: PayloadAction<PendingApproval & { tabId: string }>) {
      const { tabId, ...pending } = action.payload;
      conversationFor(state, tabId).pending = pending;
    },
    autoApproved(state, action: PayloadAction<{ tabId: string; connectionId: string }>) {
      const conversation = conversationFor(state, action.payload.tabId);
      if (!conversation.autoApproved.includes(action.payload.connectionId)) conversation.autoApproved.push(action.payload.connectionId);
    },
    modelChosen(state, action: PayloadAction<string>) {
      state.model = action.payload;
    },
    /**
     * This tab moves on to a new conversation.
     *
     * **Nothing is destroyed by it**, which is why the control is a `+` and not
     * a bin: the thread being left keeps its stored row and turns up in the
     * history picker. The `id` is dropped so the next message starts a
     * conversation of its own rather than writing over the one left behind, and
     * `autoApproved` goes with it, because the grant was for *that conversation*
     * -- carrying it into a fresh one would be a blanket permission nobody gave.
     *
     * Deleting a conversation is a different gesture, in that picker.
     */
    conversationRestarted(state, action: PayloadAction<string>) {
      state.byTab[action.payload] = blankConversation();
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadAiStatus.fulfilled, (state, action) => {
        state.status = action.payload;
      })
      .addCase(loadAiStatus.rejected, (state, action) => {
        state.status = { state: 'unavailable', reason: action.payload ?? 'Could not read the stored API key.' };
      })
      .addCase(connect.pending, (state) => {
        state.connecting = true;
        state.connectError = null;
      })
      .addCase(connect.fulfilled, (state, action) => {
        state.connecting = false;
        state.status = action.payload;
        // The catalog belongs to the key that just changed, so anything read
        // under the previous one is a picker full of ids the new key cannot send.
        state.models = [];
        state.model = null;
      })
      .addCase(connect.rejected, (state, action) => {
        state.connecting = false;
        state.connectError = action.payload ?? 'That key was not accepted.';
      })
      .addCase(removeKey.fulfilled, (state) => {
        state.status = { state: 'no-key' };
        state.models = [];
        state.model = null;
      })
      .addCase(loadModels.fulfilled, (state, action) => {
        state.models = action.payload;
        state.model ??= preferredModel(action.payload);
      })
      .addCase(loadModels.rejected, (state, action) => {
        state.connectError = action.payload ?? 'Could not read the model catalog.';
      })
      .addCase(loadConversations.fulfilled, (state, action) => {
        state.history = action.payload;
      })
      /*
       * The tab is repointed the instant the fetch starts, not when it lands,
       * and the thread is emptied with it.
       *
       * Linking early is what stops the fetch repeating: `useConversation` fires
       * this off the *absence* of a conversation for the tab, so a link written
       * only on `fulfilled` would leave that absence standing for a round trip.
       *
       * Emptying is the other half and closes a window that would otherwise
       * misfile a whole conversation: between here and `fulfilled` the tab would
       * hold the outgoing thread's messages under the incoming thread's id, and
       * a save landing in that gap writes one over the other. The outgoing one is
       * saved from the pre-action state by `conversationSyncListener`, which
       * watches this action for exactly that reason.
       */
      .addCase(openConversation.pending, (state, action) => {
        state.byTab[action.meta.arg.tabId] = { ...blankConversation(), id: action.meta.arg.id };
      })
      .addCase(openConversation.fulfilled, (state, action) => {
        // A body that no longer resolves, or one that does not parse, leaves the
        // tab empty and unlinked -- the next message is then a conversation of
        // its own rather than an overwrite of a row nobody could read.
        if (!action.payload?.record) {
          state.byTab[action.meta.arg.tabId] = blankConversation();
          return;
        }
        const conversation = conversationFor(state, action.meta.arg.tabId);
        conversation.id = action.payload.id;
        conversation.messages = action.payload.record.messages;
        conversation.tools = action.payload.record.tools;
      })
      /*
       * A failed read **unlinks** the tab rather than leaving it pointing at a
       * conversation it could not fetch. Keeping the link would leave an empty
       * thread holding a real id, and the next message would then write that
       * emptiness over the stored one -- losing the conversation to a transient
       * failure to *read* it. Unlinked, the row stays whole and the picker can
       * be asked again.
       */
      .addCase(openConversation.rejected, (state, action) => {
        state.byTab[action.meta.arg.tabId] = blankConversation();
        conversationFor(state, action.meta.arg.tabId).error = action.payload ?? 'Could not reopen that conversation.';
      })
      /*
       * The list is kept current in place rather than re-read, the same shape
       * `saveQuery.fulfilled` has: the row is replaced when it is one already
       * held and prepended otherwise, then re-sorted. Newest first, so a
       * conversation returned to moves back to the top — which is the order the
       * picker exists to give.
       */
      .addCase(saveConversation.fulfilled, (state, action) => {
        const at = state.history.findIndex((conversation) => conversation.id === action.payload.id);
        if (at === -1) state.history.push(action.payload);
        else state.history[at] = action.payload;
        state.history.sort((a, b) => b.updatedAt - a.updatedAt);
      })
      /*
       * A deleted conversation **releases the tab holding it** rather than
       * leaving it pointing at a row that is gone -- `deleteSavedQuery`'s rule,
       * and it became reachable the moment the picker stopped hiding
       * conversations open elsewhere. The messages stay on screen, because what
       * was deleted is the stored copy and not the thread being read; the next
       * message files a conversation of its own. A tab restored but not yet
       * drawn needs nothing here: its seed resolves to `null` on adoption, which
       * already unlinks it.
       */
      .addCase(deleteConversation.fulfilled, (state, action) => {
        state.history = state.history.filter((conversation) => conversation.id !== action.payload);
        for (const conversation of Object.values(state.byTab)) {
          if (conversation.id === action.payload) conversation.id = null;
        }
      })
      .addCase(sendMessage.fulfilled, (state, action) => {
        const conversation = state.byTab[action.meta.arg.tabId];
        if (!conversation) return;
        conversation.turnId = null;
        conversation.streaming = '';
        conversation.pending = null;
      })
      .addCase(sendMessage.rejected, (state, action) => {
        const tabId = action.meta.arg.tabId;
        const conversation = state.byTab[tabId];
        if (!conversation) return;
        conversation.turnId = null;
        conversation.streaming = '';
        conversation.pending = null;
        // A cancel is not a failure and must not paint one: the user asked.
        if (!cancelled.has(tabId)) conversation.error = action.payload ?? 'The assistant failed.';
      })
      /*
       * Anything keyed by tab is dropped when the tab goes -- the rule `sqlByTab`
       * already follows, and for its reason: `tabsClosed` and
       * `disconnect.fulfilled` are every way a tab leaves, and a conversation
       * left behind is a thread nothing can reach and nothing will collect.
       *
       * Matched on the action *creators* rather than on their type strings, so
       * renaming either is a compile error here rather than a leak nobody sees.
       */
      .addMatcher(isAnyOf(tabsClosed, disconnect.fulfilled), (state, action) => {
        const ids = 'ids' in action.payload ? action.payload.ids : action.payload.tabIds;
        for (const id of ids) {
          delete state.byTab[id];
          awaitingDecision.delete(id);
          cancelled.delete(id);
        }
      });
  },
});

export const {
  approvalRequested,
  assistantSaid,
  autoApproved,
  conversationRestarted,
  deltaReceived,
  modelChosen,
  noticed,
  toolAnswered,
  turnStarted,
  userSaid,
} = assistantSlice.actions;

export const assistantReducer = assistantSlice.reducer;

/** Answer one tab's card. A stray click on a tab parked on nothing finds no resolver and no-ops. */
export function answerApproval(tabId: string, approved: boolean, always = false): void {
  awaitingDecision.get(tabId)?.({ approved, always });
  awaitingDecision.delete(tabId);
}

/**
 * The picker's rows: every kept conversation except **this tab's own**.
 *
 * Only this tab's, and that is a correction. Leaving out every conversation open
 * in *any* tab was the first cut, on the reading that one you are looking at is
 * not a past one — and it made the feature look broken from the second tab: open
 * a new assistant tab and the conversation you were just having is missing from
 * the list, back only once you close the tab holding it. The thing that reading
 * was protecting against is real, but hiding was the wrong instrument for it, and
 * `reachConversation` is the right one: a conversation open elsewhere is listed,
 * and clicking it takes you to the tab that has it.
 *
 * This tab's own stays out, because reopening the thread you are already reading
 * is the one row that could do nothing at all.
 */
export const conversationHistoryFor = (tabId: string) => (s: RootState): AiConversationSummary[] => {
  const here = s.assistant.byTab[tabId]?.id;
  return here ? s.assistant.history.filter((conversation) => conversation.id !== here) : s.assistant.history;
};

/**
 * The account half: whose key is stored, what models exist, and how much it asks.
 *
 * Split from `useConversation` because these are shared by every assistant tab
 * and by the status bar, which has no tab at all.
 */
export function useAssistantAccount() {
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.assistant.status);
  const connecting = useAppSelector((s) => s.assistant.connecting);
  const models = useAppSelector((s) => s.assistant.models);
  const model = useAppSelector((s) => s.assistant.model);
  const connectError = useAppSelector((s) => s.assistant.connectError);
  const mode = useAppSelector(selectApprovalMode);
  // Any conversation running is what the status bar's dot and the titlebar's
  // mean: with several tabs open, "is the assistant working" is about the app.
  const anyRunning = useAppSelector((s) => Object.values(s.assistant.byTab).some((conversation) => conversation.turnId !== null));

  return {
    status,
    connecting,
    models,
    model,
    connectError,
    mode,
    anyRunning,
    setMode: useCallback((next: AiApprovalMode) => void dispatch(saveSetting({ key: APPROVAL_MODE_KEY, value: next })), [dispatch]),
    saveKey: useCallback((provider: AiProvider, key: string) => void dispatch(connect({ provider, key })), [dispatch]),
    forgetKey: useCallback(() => void dispatch(removeKey()), [dispatch]),
    refreshStatus: useCallback(() => void dispatch(loadAiStatus()), [dispatch]),
    chooseModel: useCallback((id: string) => void dispatch(modelChosen(id)), [dispatch]),
  };
}

/** One tab's conversation, and the five things you can do to it. */
export function useConversation(tabId: string) {
  const dispatch = useAppDispatch();
  const held = useAppSelector((s) => s.assistant.byTab[tabId]);
  const conversation = held ?? EMPTY_CONVERSATION;
  /**
   * The conversation a *restored* tab was left holding.
   *
   * A one-shot seed the first read consumes, exactly as `Tab.filter` is for a
   * restored grid tab: the tab carries it across the quit, and from the moment
   * it is adopted `assistant.byTab[tabId].id` is the live answer. Nothing writes
   * it back onto the tab, so the two cannot drift.
   */
  const restored = useAppSelector((s) => s.tabs.tabs.find((tab) => tab.id === tabId)?.conversationId);

  // Adopted on the absence of a conversation for this tab, which is true for
  // exactly one render: `openConversation.pending` writes the link, so a second
  // render finds an entry and this does not fire again.
  useEffect(() => {
    if (held || !restored) return;
    void dispatch(openConversation({ tabId, id: restored }));
  }, [dispatch, held, restored, tabId]);

  return {
    ...conversation,
    running: conversation.turnId !== null,
    send: useCallback((text: string) => void dispatch(sendMessage({ tabId, text })), [dispatch, tabId]),
    cancel: useCallback(() => void dispatch(cancelTurn(tabId)), [dispatch, tabId]),
    startNew: useCallback(() => dispatch(conversationRestarted(tabId)), [dispatch, tabId]),
    open: useCallback((id: string) => void dispatch(reachConversation({ tabId, id })), [dispatch, tabId]),
    approve: useCallback((always: boolean) => answerApproval(tabId, true, always), [tabId]),
    reject: useCallback(() => answerApproval(tabId, false), [tabId]),
  };
}

/**
 * The conversations that can be reopened, and the two things the picker does
 * to them.
 *
 * The list is fetched by `refresh` rather than on mount, because the popup that
 * draws it is what knows when it is about to be looked at -- and a title moves
 * while a thread is running, so a list read once would be stale by the time
 * anyone opened it.
 */
export function useConversationHistory(tabId: string) {
  const dispatch = useAppDispatch();
  const conversations = useAppSelector(useMemo(() => conversationHistoryFor(tabId), [tabId]));

  return {
    conversations,
    refresh: useCallback(() => void dispatch(loadConversations()), [dispatch]),
    remove: useCallback((id: string) => void dispatch(deleteConversation(id)), [dispatch]),
  };
}
