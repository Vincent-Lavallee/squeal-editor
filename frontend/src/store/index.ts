import { configureStore } from '@reduxjs/toolkit';

import { explorerReducer } from './explorerSlice.ts';
import { resultsReducer } from './resultsSlice.ts';
import { savedReducer } from './savedSlice.ts';
import { sessionReducer } from './sessionSlice.ts';
import { tabsReducer } from './tabsSlice.ts';
import { updaterReducer } from './updaterSlice.ts';
import { workspacesReducer } from './workspacesSlice.ts';

/**
 * State that crossed the bridge lives here -- and the keys that crossed values
 * are held under.
 *
 * There is no `editor` slice, and that is deliberate rather than an omission:
 * the editor's text has never been sent to or received from the extension, so it
 * belongs to the editor's own context, keyed by tab.
 *
 * `tabs` is the one entry the bridge test does not decide on its own. A tab's
 * `database` and `table` crossed, and `results` is keyed by tab id -- so the id
 * has to live where the values it keys live, or the store holds entries for tabs
 * it cannot enumerate or collect. See `docs/decisions.md`.
 */
export const store = configureStore({
  reducer: {
    session: sessionReducer,
    workspaces: workspacesReducer,
    saved: savedReducer,
    explorer: explorerReducer,
    results: resultsReducer,
    tabs: tabsReducer,
    updater: updaterReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
