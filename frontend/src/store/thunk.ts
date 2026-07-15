import { createAsyncThunk } from '@reduxjs/toolkit';

import type { AppDispatch, RootState } from './index.ts';

/**
 * Every bridge call goes through a thunk built here, so `getState` is typed and
 * a failure always carries a plain string the UI can render.
 *
 * The type-only import of the store keeps this file out of the runtime cycle
 * store -> slices -> thunk: the import is erased, so nothing loops back.
 */
export const createAppThunk = createAsyncThunk.withTypes<{
  state: RootState;
  dispatch: AppDispatch;
  rejectValue: string;
}>();

/** The bridge rejects with an Error; everything else is a programmer mistake. */
export const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
