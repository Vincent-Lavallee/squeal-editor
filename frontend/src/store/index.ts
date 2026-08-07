import { configureStore } from '@reduxjs/toolkit';

import { assistantReducer } from './assistantSlice.ts';
import { awsSignInReducer } from './awsSignInSlice.ts';
import { connectionTestReducer } from './connectionTestSlice.ts';
import { environmentsReducer } from './environmentsSlice.ts';
import { explorerReducer } from './explorerSlice.ts';
import { resultsReducer } from './resultsSlice.ts';
import { savedQueriesReducer } from './savedQueriesSlice.ts';
import { savedReducer } from './savedSlice.ts';
import { sessionReducer } from './sessionSlice.ts';
import { sessionSyncMiddleware } from './sessionSyncListener.ts';
import { settingsReducer } from './settingsSlice.ts';
import { tabsReducer } from './tabsSlice.ts';
import { transferReducer } from './transferSlice.ts';
import { updaterReducer } from './updaterSlice.ts';
import { workspacesReducer } from './workspacesSlice.ts';

/**
 * State that crossed the bridge lives here -- and the keys that crossed values
 * are held under.
 *
 * The editor's text lives in `tabs` now, not a context of its own. It moved the
 * day session restore made a query survive a quit: the extension stores it, so it
 * crosses the bridge, so it is a slice -- the one rule, applied to the case the
 * old `editor` context was the standing exception to.
 *
 * `tabs` is the one entry the bridge test does not decide on its own. A tab's
 * `database` and `table` crossed, and `results` is keyed by tab id -- so the id
 * has to live where the values it keys live, or the store holds entries for tabs
 * it cannot enumerate or collect. See `docs/decisions.md`.
 *
 * `sessionSyncMiddleware` is the write half of session restore: it watches the
 * tabs as they change and persists each connection's shape. It is prepended per
 * the listener-middleware convention, so it sees actions before the reducers run.
 *
 * `assistant` is here by the same test and is the one slice that also *drives*
 * something: the agent loop runs in its thunk, because six of its tools answer
 * from the tabs and the results rather than from anything the extension knows.
 * See `docs/decisions.md`.
 */
export const store = configureStore({
  reducer: {
    session: sessionReducer,
    workspaces: workspacesReducer,
    environments: environmentsReducer,
    saved: savedReducer,
    savedQueries: savedQueriesReducer,
    transfer: transferReducer,
    connectionTest: connectionTestReducer,
    awsSignIn: awsSignInReducer,
    explorer: explorerReducer,
    results: resultsReducer,
    tabs: tabsReducer,
    updater: updaterReducer,
    settings: settingsReducer,
    assistant: assistantReducer,
  },
  middleware: (getDefaultMiddleware) => getDefaultMiddleware().prepend(sessionSyncMiddleware.middleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
