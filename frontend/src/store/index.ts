import { configureStore } from '@reduxjs/toolkit';

import { explorerReducer } from './explorerSlice.ts';
import { resultsReducer } from './resultsSlice.ts';
import { savedReducer } from './savedSlice.ts';
import { sessionReducer } from './sessionSlice.ts';

/**
 * Only state that crossed the bridge lives here.
 *
 * There is no `editor` slice, and that is deliberate rather than an omission:
 * the editor's text has never been sent to or received from the extension, so it
 * belongs to the editor's own context. The same test explains why `expanded` is
 * absent while `explorer.tables` is present.
 */
export const store = configureStore({
  reducer: {
    session: sessionReducer,
    saved: savedReducer,
    explorer: explorerReducer,
    results: resultsReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
