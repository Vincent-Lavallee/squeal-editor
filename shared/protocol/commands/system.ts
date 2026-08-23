/**
 * Everything that is not a database: AWS credentials behind an IAM
 * connection, the native window frame, the app's own data directory, the
 * auto-updater, and the assistant provider.
 */

import type { AwsCredentialStatus } from '../config.ts';
import type { UpdateStatus } from '../updater.ts';
import type { AiMessage, AiModel, AiProvider, AiStatus, AiToolDef } from '../ai.ts';

/**
 * Which top edge a grab strip is asking to resize from.
 *
 * Only the top three, because they are the only ones the window loses: see
 * `window.beginResize`. It is declared here rather than in a domain file
 * because the window is not one of the six nouns that travel -- and one union
 * is not worth a seventh file to keep it company.
 */
export type ResizeEdge = 'top' | 'top-left' | 'top-right';

export interface SystemCommands {
    /**
     * Can this profile mint credentials right now?
     *
     * Asked before an IAM connection is opened, so that a lapsed SSO session is a
     * step the UI can put in front of the user rather than a failure it has to
     * explain afterwards. It is the same resolution the connect would do first,
     * stopped before any database socket is opened.
     *
     * **It never rejects.** "Not signed in" is an answer, and one the caller acts
     * on differently from an error — the same shape as `window.matchFrame`'s
     * `applied: false`. `signInHelps` says whether *Sign in to AWS* would fix this
     * one: a missing profile or a malformed config is not something a login
     * repairs, and offering a button that cannot work is worse than none.
     */
    'aws.credentialStatus': {
        req: { profile: string };
        res: AwsCredentialStatus;
    };

    /**
     * Refresh the AWS SSO session a `profile` mints its RDS tokens from, by
     * running the user's own `aws sso login --profile <profile>`.
     *
     * It shells out rather than implementing the OIDC device flow here, and that
     * is the point: the CLI already owns the token cache this app reads through
     * `fromIni`, including where it lives, how it is named and what a refresh
     * writes into it. A second implementation would have to agree with all of
     * that forever, and would be wrong the first time AWS changed any of it.
     *
     * The browser leg is the user's own browser, opened by the CLI. Nothing about
     * the login is rendered inside the app: an identity provider's page framed by
     * the app that wants the credentials is indistinguishable from a phishing
     * page, and most IdPs refuse to be framed at all.
     *
     * This resolves only once the CLI has exited cleanly, which is *after* the
     * browser round trip -- so it is slow by nature, not by fault. A non-zero exit
     * rejects with the CLI's own stderr, and a missing CLI rejects saying so
     * rather than as a generic spawn failure.
     */
    'aws.ssoLogin': {
        req: { profile: string };
        res: { ok: true };
    };

    /**
     * Paint the OS-drawn window frame to match the app, which the webview cannot
     * do for itself -- the frame is outside its client area. The extension is the
     * process that makes the native calls the webview cannot, which is the same
     * reason the connections live here.
     *
     * `pid` is the app's own (`NL_PID`): Neutralino spawns extensions through a
     * shell, so the extension's parent is that shell rather than the window, and
     * it cannot find the window without being told. `colour` is `--bg`, read from
     * the stylesheet so that tokens.css stays the one place the colour is written.
     *
     * `applied` is false wherever the platform will not do it -- older Windows,
     * anything not Windows -- which is not an error. The band just stays.
     */
    'window.matchFrame': {
        req: { pid: number; colour: string };
        res: { applied: boolean };
    };

    /**
     * Clamp the maximised window onto its monitor's work area. Windows maximises
     * a caption-less window -- which ours is, see the titlebar decision -- over
     * the whole monitor with the resize borders hanging offscreen: the taskbar is
     * covered and the outermost ~7px of the app (the close button, the status
     * bar) are clipped. Where the work area is and where the window sits are
     * native facts the webview cannot read or set, so the extension repositions
     * it -- the `window.matchFrame` rule again.
     *
     * `pid` is `NL_PID`, for the same reason as `window.matchFrame`. The UI calls
     * this whenever it observes the window maximised, whichever gesture did it.
     * `applied` is false off Windows, when the window is not maximised, or when
     * it cannot be found -- none of which is an error.
     */
    'window.fitMaximized': {
        req: { pid: number };
        res: { applied: boolean };
    };

    /**
     * Get the window chrome DLL into the app process, which is the only place the
     * window's own `WM_NCCALCSIZE` can be answered from.
     *
     * This is not a third instance of the `window.matchFrame` rule but the end of
     * it: the paint and the clamp both work *around* a caption-less window, and
     * this one gives the caption back. With it applied the OS animates minimise
     * and maximise again, and the ~7px band above the titlebar is reclaimed
     * rather than merely recoloured.
     *
     * `pid` is `NL_PID`, for `window.matchFrame`'s reason. `applied` is false off
     * Windows, on a build made without a C compiler (there is then no DLL to
     * inject), and any time the injection does not take -- none of which is an
     * error, and all of which leave the window exactly as previous versions drew
     * it. The UI reads it to decide whether to draw the top grab strips, which
     * exist only because applying this costs the top resize border.
     */
    'window.installChrome': {
        req: { pid: number };
        res: { applied: boolean };
    };

    /**
     * Start an OS resize from the top edge or a top corner, on behalf of a grab
     * strip in the UI.
     *
     * Only meaningful once `window.installChrome` has applied: reclaiming the top
     * of the non-client area is what removes the band, and it hands those pixels
     * to the webview, so Windows stops hit-testing a resize border there. The
     * other three edges keep theirs and need nothing.
     *
     * `applied` is false when the chrome was never installed, which is the same
     * condition under which the UI does not draw the strips in the first place.
     */
    'window.beginResize': {
        req: { pid: number; edge: ResizeEdge };
        res: { applied: boolean };
    };

    /**
     * Where the store lives on disk, for the About menu's "Open app data".
     *
     * This is the mirror image of `window.matchFrame`, not another instance of it.
     * There the extension makes a call the webview cannot; here the webview opens
     * the folder perfectly well (`Neutralino.os.open`) and the only thing it lacks
     * is the path -- which is per-platform and computed beside the database it
     * names, so answering it here is what keeps one place deciding where the store
     * lives. Hand back the path and let the caller open it; an extension that
     * shelled out to a file manager would be a second answer to a question the
     * webview already has an API for.
     */
    'app.dataDir': {
        req: Record<string, never>;
        res: { path: string };
    };

    /**
     * Is there a newer release, and what is it? The extension checks -- not the
     * webview -- because the whole flow that follows is native work the webview
     * cannot do: streaming a download to disk, verifying it, and launching an
     * installer. This is the first step of that flow, kept on the same side so
     * the later steps have somewhere to stand.
     *
     * `currentVersion` is the running app's, injected at build time and passed in
     * rather than read here: the compiled binary carries no `neutralino.config.json`
     * to read a version from, and the UI already knows it.
     *
     * A check never nags or throws: offline, rate-limited or unsupported all come
     * back as `hasUpdate: false`, not an error. `supported` is false off Windows
     * (the only platform the swap-on-restart flow is built for) -- the same shape
     * as `window.matchFrame`'s `applied: false`.
     */
    'update.check': {
        req: { currentVersion: string };
        res: UpdateStatus;
    };
    /**
     * Download the update the last `update.check` found, stage it, and verify it
     * two ways before resolving: a checksum for corruption and a detached ed25519
     * signature for authenticity. Both must pass or this rejects and the staged
     * file is discarded -- an unverified download is never offered for apply.
     *
     * Progress arrives out-of-band on the `update.progress` broadcast; this
     * resolves only once the bytes are on disk *and* verified.
     */
    'update.download': {
        req: Record<string, never>;
        res: { ok: true };
    };
    /**
     * Hand the staged update to the swap and step back. Neither platform can
     * overwrite its own running files, so a script that outlives the app does it:
     * it waits for the app to exit, installs, and launches the app again itself.
     *
     * Resolves only once that script has confirmed it is running, because the UI
     * calls `app.exit()` on the resolution -- an apply that never got off the
     * ground must reject rather than close the app onto nothing. It is the one
     * failure the user hears about: a check and a download can fail quietly, but
     * this one was asked for and answered with a restart.
     */
    'update.apply': {
        req: Record<string, never>;
        res: { ok: true };
    };

    /**
     * Where the user stands with the assistant, without asking it to do anything.
     *
     * `aws.credentialStatus`'s job in this domain, and it resolves rather than
     * rejecting for that command's exact reason: holding no key is an answer. It
     * costs no request either — see `AiStatus` for why a stored key is not
     * re-proved at launch.
     */
    'ai.status': {
        req: Record<string, never>;
        res: AiStatus;
    };
    /**
     * Keep a key for a provider, once it has been proved to work.
     *
     * **The key is verified before it is written**, by asking that provider for
     * its catalog: this is the one moment the user is watching, so it is the one
     * moment a bad key can be reported as a bad key rather than as an assistant
     * that silently answers nothing. A rejection stores nothing.
     *
     * The key goes to the OS keychain here and never travels back to the UI. What
     * comes back is the same status `ai.status` answers, so a panel that just
     * connected and a panel that was already connected render from one shape.
     */
    'ai.connect': {
        req: { provider: AiProvider; key: string };
        res: AiStatus;
    };
    /** Forget the stored key. The keychain entry goes; nothing else is kept to clear. */
    'ai.disconnect': {
        req: Record<string, never>;
        res: { ok: true };
    };
    /**
     * The models the stored key may use, filtered to those that can hold a
     * tool-using conversation -- see `AiModel`. The UI picks its default out of
     * this rather than naming an id, because which Claude exists moves.
     */
    'ai.models': {
        req: Record<string, never>;
        res: { models: AiModel[] };
    };
    /**
     * One turn: hand the model the conversation and the tools, get its answer.
     *
     * **One model call, not one conversation.** The agent loop lives in the
     * webview -- it holds the tabs, the editor selection and the results the tools
     * answer from, none of which this side has ever heard of -- so a turn that
     * calls three tools is three of these. What is here instead is the part the
     * webview cannot do: the key is in the OS keychain, and a key must never reach
     * a page that renders anything.
     *
     * Text arrives on the `ai.delta` broadcast as it is generated; this resolves
     * with the finished message, `update.download`'s split. `turnId` is the UI's
     * own so `ai.cancel` can name this call while it is still in flight.
     */
    'ai.send': {
        req: { turnId: string; model: string; messages: AiMessage[]; tools: AiToolDef[] };
        res: { message: AiMessage };
    };
    /**
     * Abort a turn in flight. The pending `ai.send` rejects with a cancellation,
     * which the loop reads as "stop", not as "retry".
     *
     * It is a command rather than an `AbortSignal` on the call because the signal
     * would only abandon the *reply*: the bridge is fire-and-forget, so nothing
     * about a caller giving up reaches this side, and the request to the provider
     * would go on streaming to nobody -- billed by the token. Cancelling has to be
     * something the UI says.
     */
    'ai.cancel': {
        req: { turnId: string };
        res: { ok: true };
    };
}
