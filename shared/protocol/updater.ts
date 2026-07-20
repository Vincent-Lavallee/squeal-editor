/**
 * What a release check found, and how far a download has got.
 *
 * The updater is not a database and is on this side of the bridge for the same
 * reason the window calls are: the flow is native work the webview cannot do.
 */

/**
 * What a release check found. Deliberately not an error channel: a check that
 * cannot reach GitHub, is rate-limited, or runs on a platform the swap flow does
 * not cover reports `hasUpdate: false`, never a thrown error -- an update the
 * user did not ask for must not surface as a failure they did not cause.
 */
export interface UpdateStatus {
  /** False off Windows, the only platform the swap-on-restart flow is built for. */
  supported: boolean;
  /**
   * Whether the check actually reached the releases and got an answer. False
   * when the request failed -- offline, rate-limited, or a shape we did not
   * expect. It is what lets the UI tell "you are up to date" from "I could not
   * check": a failed check reports `hasUpdate: false` like a successful empty
   * one, and only this distinguishes them.
   */
  checked: boolean;
  currentVersion: string;
  /** Null when nothing newer was found, or the check could not be made. */
  latestVersion: string | null;
  hasUpdate: boolean;
  /** The release's notes, shown in the prompt so "download?" has a "what". */
  notes?: string;
}

/** Download progress, broadcast on `UPDATE_PROGRESS_EVENT` as bytes arrive. */
export interface UpdateProgress {
  receivedBytes: number;
  /** 0 when the server sent no Content-Length, so the bar shows indeterminate. */
  totalBytes: number;
}
