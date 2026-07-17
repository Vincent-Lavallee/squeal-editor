import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { UpdateProgress, UpdateStatus } from '../../../shared/protocol.ts';
import { call } from '../bridge.ts';
import { createAppThunk, errorMessage } from './thunk.ts';

/**
 * The updater is a slice because it crossed the bridge: the release check and
 * the download progress both come from the extension. It is one global concern,
 * not keyed by anything, and its only feature-local scrap -- whether the banner
 * was dismissed -- lives here beside the status it hides rather than in a second
 * place that would have to be kept in step.
 *
 * The whole flow is user-initiated: a check may find an update, but nothing
 * downloads or applies until the user says so. See `docs/decisions.md`.
 */
type Phase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';

interface UpdaterState {
  phase: Phase;
  status: UpdateStatus | null;
  progress: UpdateProgress | null;
  /** The user waved the banner away; a fresh manual check brings it back. */
  dismissed: boolean;
  /**
   * A manual "Check for updates" just found nothing. Only set for a manual check,
   * so the silent launch check stays silent -- this is the one bit of feedback
   * the menu action owes the user who asked.
   */
  upToDate: boolean;
  error: string | null;
}

const initialState: UpdaterState = {
  phase: 'idle',
  status: null,
  progress: null,
  dismissed: false,
  upToDate: false,
  error: null,
};

/** `manual` is the user asking from the menu; absent is the quiet launch check. */
export const checkForUpdate = createAppThunk(
  'updater/check',
  async ({ manual = false }: { manual?: boolean } = {}, { rejectWithValue }) => {
    void manual; // read off action.meta.arg in the reducer, not needed here
    try {
      // The version is fixed at build time, so it is a constant, not a lookup.
      return await call('update.check', { currentVersion: __APP_VERSION__ });
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

export const downloadUpdate = createAppThunk('updater/download', async (_: void, { rejectWithValue }) => {
  try {
    // A download outlasts the default bridge timeout; give it room. Progress
    // arrives on the broadcast in the meantime.
    await call('update.download', {}, 5 * 60_000);
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

export const applyUpdate = createAppThunk('updater/apply', async (_: void, { rejectWithValue }) => {
  try {
    await call('update.apply', {});
    // Step aside so the installer can swap the files it is about to replace; it
    // relaunches us on the far side.
    await Neutralino.app.exit();
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

const updaterSlice = createSlice({
  name: 'updater',
  initialState,
  reducers: {
    dismissed(state) {
      state.dismissed = true;
      state.upToDate = false;
    },
    progressReceived(state, action: PayloadAction<UpdateProgress>) {
      state.progress = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(checkForUpdate.pending, (state) => {
        state.phase = 'checking';
        state.error = null;
      })
      .addCase(checkForUpdate.fulfilled, (state, action) => {
        state.status = action.payload;
        state.phase = action.payload.hasUpdate ? 'available' : 'idle';
        if (action.payload.hasUpdate) {
          // A check that found something un-dismisses the banner, so asking again
          // from the menu surfaces it even after an earlier "Later".
          state.dismissed = false;
          state.upToDate = false;
        } else {
          // Only a manual check earns the "you're up to date" note; the launch
          // check that finds nothing says nothing.
          state.upToDate = action.meta.arg?.manual ?? false;
        }
      })
      .addCase(checkForUpdate.rejected, (state) => {
        // A check never nags: a failed one is silent, not an error on screen.
        state.phase = 'idle';
      })

      .addCase(downloadUpdate.pending, (state) => {
        state.phase = 'downloading';
        state.progress = null;
        state.upToDate = false;
        state.error = null;
      })
      .addCase(downloadUpdate.fulfilled, (state) => {
        state.phase = 'ready';
      })
      .addCase(downloadUpdate.rejected, (state, action) => {
        state.phase = 'error';
        state.error = action.payload ?? 'The update could not be downloaded.';
      })

      // Apply only rejects if the launch itself failed; the happy path exits the
      // app before any of this could run.
      .addCase(applyUpdate.rejected, (state, action) => {
        state.phase = 'error';
        state.error = action.payload ?? 'The update could not be started.';
      });
  },
});

export const { dismissed, progressReceived } = updaterSlice.actions;
export const updaterReducer = updaterSlice.reducer;
