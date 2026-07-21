import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { useCallback } from 'react';

import { call } from '../common/bridge/bridge.ts';
import { useAppDispatch, useAppSelector } from './hooks.ts';
import { createAppThunk, errorMessage } from './thunk.ts';

/**
 * The user's preferences, as the extension's store holds them.
 *
 * A slice by the usual test: they cross the bridge. Unlike every other slice
 * here they are about nobody's connection -- they outlive all of them, which is
 * why the store keeps them in a table of their own and why nothing here is keyed
 * by a connection id.
 *
 * The values are strings, because that is what the store keeps. Each reader
 * spells its own default for a key nobody has written yet; there is no default
 * map here, which would be a second place to state what a preference means.
 */
interface SettingsState {
  values: Record<string, string>;
  /** Until the launch read lands, nothing is known -- see `useSetting`. */
  loaded: boolean;
}

const initialState: SettingsState = { values: {}, loaded: false };

/** Read every setting. Fired once at launch, before anything renders a preference. */
export const loadSettings = createAppThunk('settings/load', async (_: void, { rejectWithValue }) => {
  try {
    const { settings } = await call('settings.list', {});
    return settings;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

/**
 * Write one setting through to the store.
 *
 * The slice is updated by the caller's own dispatch of `settingChanged` first,
 * so a toggle moves under the finger rather than after a round trip. A failed
 * write leaves the app holding a preference the store does not have, which is
 * the right way round: the setting is cosmetic and re-toggling retries it, while
 * a control that snapped back on an unreadable failure would just look broken.
 */
export const saveSetting = createAppThunk(
  'settings/save',
  async ({ key, value }: { key: string; value: string }, { dispatch, rejectWithValue }) => {
    dispatch(settingChanged({ key, value }));
    try {
      await call('settings.set', { key, value });
      return { key, value };
    } catch (err) {
      return rejectWithValue(errorMessage(err));
    }
  }
);

const settingsSlice = createSlice({
  name: 'settings',
  initialState,
  reducers: {
    settingChanged(state, action: PayloadAction<{ key: string; value: string }>) {
      state.values[action.payload.key] = action.payload.value;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loadSettings.fulfilled, (state, action) => {
        state.values = action.payload;
        state.loaded = true;
      })
      // A store that cannot be read leaves every setting at its reader's default,
      // which is what an unwritten key already means. `loaded` still flips: the
      // launch read is over, and a control that waited for an answer that is
      // never coming would sit disabled forever.
      .addCase(loadSettings.rejected, (state) => {
        state.loaded = true;
      });
  },
});

export const { settingChanged } = settingsSlice.actions;
export const settingsReducer = settingsSlice.reducer;

/**
 * One boolean preference: what it is now, and how to change it.
 *
 * Boolean because every preference so far is one, and a hook per *shape* rather
 * than per *key* is what keeps a new toggle from being a new slice. `fallback` is
 * the feature's own default for a key nobody has written -- stated by the caller,
 * since the store deliberately holds no opinion about what any key means.
 */
export function useBooleanSetting(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const dispatch = useAppDispatch();
  const stored = useAppSelector((s) => s.settings.values[key]);
  const set = useCallback((value: boolean) => void dispatch(saveSetting({ key, value: String(value) })), [dispatch, key]);
  return [stored === undefined ? fallback : stored === 'true', set];
}
