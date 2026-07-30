import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { useCallback } from 'react';

import type { AwsCredentialStatus, AwsSsoPrompt } from '../../../shared/protocol/index.ts';
import { call } from '../common/bridge/bridge.ts';
import { useAppDispatch, useAppSelector } from './hooks.ts';
import { createAppThunk, errorMessage } from './thunk.ts';

/**
 * Whether the AWS SSO session behind an IAM connection has been refreshed from
 * inside the app.
 *
 * A slice for the same reason `connectionTest` is one: the answer came back over
 * the bridge. It is the sibling of that slice rather than a field on it because
 * the two describe different things -- a test describes the whole form and is
 * withdrawn by any edit, while this describes one profile's credentials and
 * survives everything except changing which profile is named.
 *
 * `signedIn` holds the profile rather than a boolean: the message says which one
 * was signed in, and a `true` beside a profile field that has since been retyped
 * would be vouching for the wrong one.
 */
interface AwsSignInState {
  signingIn: boolean;
  signedIn: string | null;
  error: string | null;
  /**
   * The verification URL and code the CLI is waiting on, while it waits. This is
   * the sign-in, not a status line about it: the CLI tries to open a browser and
   * cannot always manage it, and without these the user has nothing to act on.
   */
  prompt: AwsSsoPrompt | null;
  /**
   * What each AWS profile the screen has seen can currently do, keyed by profile
   * name.
   *
   * Keyed rather than singular because the answer belongs to the *profile*, not
   * to whatever was last clicked: a workspace can hold several IAM connections
   * and they commonly share one profile, so one check serves every row that
   * names it. An absent entry means "not asked yet", which is what makes the
   * `condition` on `checkAwsCredentials` able to dedupe.
   */
  profiles: Record<string, ProfileStatus>;
}

export interface ProfileStatus {
  checking: boolean;
  /** Null until the first answer lands — "unknown", which never gates a row. */
  valid: boolean | null;
  problem: string | null;
  signInHelps: boolean;
}

const initialState: AwsSignInState = {
  signingIn: false,
  signedIn: null,
  error: null,
  prompt: null,
  profiles: {},
};

/**
 * The browser leg of `aws sso login` is the user's, and it is unhurried -- a
 * fresh device authorisation means opening a page, reading a code and approving
 * it. The ceiling is the CLI's own patience rather than a bridge default that
 * would abandon a login still going fine.
 */
const SSO_LOGIN_TIMEOUT_MS = 300_000;

/**
 * Ask whether a profile can mint credentials, before anything tries to.
 *
 * It resolves even for "no" — the command never rejects, because not being
 * signed in is an answer. The only rejection here is the bridge itself failing,
 * which is treated as *valid* on purpose: a check the app could not perform must
 * not stand between the user and a connection that might work perfectly well.
 * The connect's own failure is still there to catch it.
 *
 * **The `condition` is what lets the caller fire this freely.** The saved list
 * asks for every IAM profile it draws, on every render pass that could have
 * changed the set, and this is what makes that free — the same arrangement
 * `loadColumns` has with the completion provider, and for the same reason:
 * the component should say *what it needs*, not keep a record of what it has
 * already asked for.
 */
export const checkAwsCredentials = createAppThunk(
  'awsSignIn/check',
  async (profile: string): Promise<{ profile: string } & AwsCredentialStatus> => {
    try {
      return { profile, ...(await call('aws.credentialStatus', { profile }, 30_000)) };
    } catch {
      return { profile, valid: true, problem: null, signInHelps: false };
    }
  },
  {
    // Asked-and-answered, or asked-and-still-waiting, both skip. `pending` marks
    // it before the first await, so two callers in one render cannot both pass.
    condition: (profile, { getState }) => getState().awsSignIn.profiles[profile] === undefined,
  }
);

export const awsSsoLogin = createAppThunk('awsSignIn/login', async (profile: string, { rejectWithValue }) => {
  try {
    await call('aws.ssoLogin', { profile }, SSO_LOGIN_TIMEOUT_MS);
    return profile;
  } catch (err) {
    return rejectWithValue(errorMessage(err));
  }
});

const awsSignInSlice = createSlice({
  name: 'awsSignIn',
  initialState,
  reducers: {
    cleared() {
      return initialState;
    },
    /**
     * Arrives twice for one login -- the CLI prints the URL a line or two before
     * the code -- so this overwrites rather than refusing a second one. A prompt
     * landing when nothing is signing in is a stale broadcast from an attempt
     * already abandoned, and is dropped rather than shown under a button at rest.
     */
    promptReceived(state, action: PayloadAction<AwsSsoPrompt>) {
      if (!state.signingIn) return;
      state.prompt = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(checkAwsCredentials.pending, (state, action) => {
        state.profiles[action.meta.arg] = { checking: true, valid: null, problem: null, signInHelps: false };
      })
      .addCase(checkAwsCredentials.fulfilled, (state, action) => {
        const { profile, valid, problem, signInHelps } = action.payload;
        state.profiles[profile] = { checking: false, valid, problem, signInHelps };
      })
      .addCase(awsSsoLogin.pending, (state) => {
        state.signingIn = true;
        state.signedIn = null;
        state.error = null;
        state.prompt = null;
      })
      .addCase(awsSsoLogin.fulfilled, (state, action) => {
        state.signingIn = false;
        state.signedIn = action.payload;
        state.prompt = null;
        // Forgotten rather than assumed good. The CLI exiting zero means it
        // wrote the token cache, not that `fromIni` will now resolve against it
        // -- so the entry goes and the list's effect asks again, which is the
        // same question that gated the row in the first place.
        delete state.profiles[action.payload];
      })
      .addCase(awsSsoLogin.rejected, (state, action) => {
        state.signingIn = false;
        state.error = action.payload ?? 'The AWS sign-in did not complete.';
        state.prompt = null;
      });
  },
});

export const { cleared, promptReceived } = awsSignInSlice.actions;
export const awsSignInReducer = awsSignInSlice.reducer;

export function useAwsSignIn() {
  const dispatch = useAppDispatch();
  const { signingIn, signedIn, error, prompt, profiles } = useAppSelector((s) => s.awsSignIn);

  return {
    signingIn,
    signedIn,
    error,
    prompt,
    profiles,
    /** Ask about a profile, if nobody has. Safe to call on every render — see the thunk. */
    check: useCallback((profile: string) => void dispatch(checkAwsCredentials(profile)), [dispatch]),
    /** Resolves to whether the login actually completed, so a caller can act on it. */
    start: useCallback(
      async (profile: string) => awsSsoLogin.fulfilled.match(await dispatch(awsSsoLogin(profile))),
      [dispatch]
    ),
    clear: useCallback(() => dispatch(cleared()), [dispatch]),
  };
}
