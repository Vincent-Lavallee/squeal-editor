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
import { useCallback } from 'react';

import { call } from '../common/bridge/bridge.ts';
import { buildContext } from '../features/assistant/context.ts';
import { TOOL_DEFS, toolByName, type ToolContext } from '../features/assistant/tools.ts';
import { useAppDispatch, useAppSelector } from './hooks.ts';
import { disconnect } from './sessionSlice.ts';
import { saveSetting } from './settingsSlice.ts';
import { tabsClosed } from './tabsSlice.ts';
import { createAppThunk, errorMessage } from './thunk.ts';
import type { AppDispatch } from './index.ts';
import type { AiApprovalMode, AiMessage, AiModel, AiProvider, AiStatus, AiToolCall } from '../../../shared/protocol/index.ts';

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

/**
 * What the thread shows about a call, beside the wire message that records it.
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
}

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
}

const blankConversation = (): Conversation => ({
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
    dispatch(userSaid({ tabId, text }));

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
  const answer = (outcome: ToolRecord['outcome'], content: string) =>
    dispatch(toolAnswered({ tabId, callId: toolCall.id, name: tool.def.name, target, outcome, args: pretty, content }));

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
    answer('ran', JSON.stringify(await tool.run(args, toolContext)));
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
    userSaid(state, action: PayloadAction<{ tabId: string; text: string }>) {
      const conversation = conversationFor(state, action.payload.tabId);
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
     * Clear one thread. `autoApproved` goes with it, because the grant was for
     * *this conversation* -- a cleared one that inherited it would be a blanket
     * permission nobody gave.
     */
    conversationCleared(state, action: PayloadAction<string>) {
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
  conversationCleared,
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

/** One tab's conversation, and the four things you can do to it. */
export function useConversation(tabId: string) {
  const dispatch = useAppDispatch();
  const conversation = useAppSelector((s) => s.assistant.byTab[tabId]) ?? EMPTY_CONVERSATION;

  return {
    ...conversation,
    running: conversation.turnId !== null,
    send: useCallback((text: string) => void dispatch(sendMessage({ tabId, text })), [dispatch, tabId]),
    cancel: useCallback(() => void dispatch(cancelTurn(tabId)), [dispatch, tabId]),
    clear: useCallback(() => dispatch(conversationCleared(tabId)), [dispatch, tabId]),
    approve: useCallback((always: boolean) => answerApproval(tabId, true, always), [tabId]),
    reject: useCallback(() => answerApproval(tabId, false), [tabId]),
  };
}
