import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

import type { UpdateProgress, UpdateStatus } from '../../../shared/protocol/index.ts';
import { call } from '../common/bridge/bridge.ts';
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
  /**
   * A manual check could not reach the releases at all. Kept apart from
   * `upToDate` because "you are current" and "I could not check" are different
   * answers, and reporting the second as the first is a quiet lie. Manual only,
   * for the same reason `upToDate` is.
   */
  checkFailed: boolean;
  /**
   * This platform has no update path at all, so the extension returned without
   * asking GitHub anything. Kept apart from `checkFailed` because that one offers
   * a retry, and retrying here could never succeed -- the answer will not change.
   * Manual only, for the same reason the other two are.
   */
  unsupported: boolean;
  error: string | null;
}

const initialState: UpdaterState = {
  phase: 'idle',
  status: null,
  progress: null,
  dismissed: false,
  upToDate: false,
  checkFailed: false,
  unsupported: false,
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
      state.checkFailed = false;
      state.unsupported = false;
    },
    progressReceived(state, action: PayloadAction<UpdateProgress>) {
      state.progress = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(checkForUpdate.pending, (state) => {
        state.phase = 'checking';
        state.upToDate = false;
        state.checkFailed = false;
        state.unsupported = false;
        state.error = null;
      })
      .addCase(checkForUpdate.fulfilled, (state, action) => {
        state.status = action.payload;
        state.phase = action.payload.hasUpdate ? 'available' : 'idle';
        const manual = action.meta.arg?.manual ?? false;
        if (!action.payload.supported) {
          // The extension answered without reaching GitHub: the whole apply path
          // is the Windows installer, so there is nothing to offer here. Said
          // outright rather than as a failed check, which would be a retry loop
          // that cannot end.
          state.unsupported = manual;
          state.upToDate = false;
          state.checkFailed = false;
        } else if (action.payload.hasUpdate) {
          // A check that found something un-dismisses the banner, so asking again
          // from the menu surfaces it even after an earlier "Later".
          state.dismissed = false;
          state.upToDate = false;
          state.checkFailed = false;
        } else if (!action.payload.checked) {
          // Reached nobody. Only a manual check says so; the launch check that
          // cannot reach GitHub still stays silent.
          state.checkFailed = manual;
          state.upToDate = false;
        } else {
          // Genuinely nothing newer. Only a manual check earns the acknowledgement.
          state.upToDate = manual;
          state.checkFailed = false;
        }
      })
      .addCase(checkForUpdate.rejected, (state, action) => {
        // The bridge itself failed (timeout, extension down). Same rule as a
        // failed check: silent on launch, "couldn't check" when asked.
        state.phase = 'idle';
        state.checkFailed = action.meta.arg?.manual ?? false;
        state.unsupported = false;
      })

      .addCase(downloadUpdate.pending, (state) => {
        state.phase = 'downloading';
        state.progress = null;
        state.upToDate = false;
        state.checkFailed = false;
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
