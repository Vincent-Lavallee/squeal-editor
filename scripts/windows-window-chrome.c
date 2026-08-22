#include <windows.h>

/*
 * Injected into the Neutralino shell (extensions/db/chrome.ts does the
 * injecting) to do the one thing no other process can: answer this window's own
 * messages.
 *
 * Why it exists: the window is WS_THICKFRAME without WS_CAPTION. Neutralino's
 * borderless mode strips both, and the UI puts THICKFRAME back at startup so
 * Aero Snap and edge-resize survive. Two things follow from the caption still
 * being missing, and they were filed as separate bugs: Windows hangs the
 * minimise and maximise animations off WS_CAPTION, so the window teleports; and
 * with no WM_NCCALCSIZE to reclaim it, Windows keeps ~7px of resize frame above
 * a client area that starts too low, which reads as the titlebar sitting wrong.
 * Both are the same missing pair -- the caption bit, and an answer to
 * WM_NCCALCSIZE saying where the client area really starts.
 *
 * That answer is why this is a DLL and not more FFI in the extension.
 * SetWindowLongPtr crosses a process boundary happily; a window procedure
 * cannot, because the pointer would name an address the app has never mapped.
 * WM_NCCALCSIZE is delivered to the window's own thread and nowhere else.
 *
 * The shape is Electron's frameless window: keep the caption bit so the OS
 * animates, then take the non-client space back so none of it is ever drawn.
 *
 * Everything here is best-effort. Every failure path returns having changed
 * nothing, which leaves the app exactly as it runs today with no DLL at all --
 * that is also what a dev run on a machine without a C compiler gets.
 */

/*
 * Registered rather than WM_USER-relative: the extension has to name the same
 * two messages from another process, and RegisterWindowMessage is the only
 * thing that guarantees both sides compute the same number. DefWindowProc
 * ignores what it does not recognise, so an uninjected app is unharmed by
 * either of them arriving.
 */
static const wchar_t INSTALL_MESSAGE[] = L"SquealEditorInstallWindowChrome";
static const wchar_t RESIZE_MESSAGE[] = L"SquealEditorBeginWindowResize";

static UINT installMessage;
static UINT resizeMessage;
static WNDPROC baseProc;
static HWND chromed;

static LRESULT CALLBACK chromeProc(HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
  if (message == WM_NCCALCSIZE && wparam == TRUE) {
    NCCALCSIZE_PARAMS *params = (NCCALCSIZE_PARAMS *)lparam;
    const RECT window_rect = params->rgrc[0];

    /*
     * The default answer measures the frame for us, which is the only way to be
     * right at every DPI and on every monitor without carrying a metrics table.
     * Its top is the one part rejected: with WS_CAPTION on, that inset holds the
     * caption height as well as the frame, and the caption is precisely what
     * this window will never draw.
     */
    const LRESULT result = CallWindowProcW(baseProc, window, message, wparam, lparam);
    const LONG frame = params->rgrc[0].left - window_rect.left;

    /*
     * Maximised, the window rect is the work area grown by the frame on every
     * side (that is what the OS maximise of a captioned window does), so the
     * frame has to come back off the top or the titlebar would start above the
     * screen. Restored, the frame at the top is the dead band this file exists
     * to remove, and the client starts flush with the window's own edge.
     *
     * The other three sides keep their inset deliberately. That is the border
     * Windows hit-tests for edge resize, and the webview -- sized to the client
     * area -- would cover it the moment we claimed it. The top edge is the one
     * that is given up, and the UI draws its own grab strips there.
     */
    params->rgrc[0].top = window_rect.top + (IsZoomed(window) ? frame : 0);
    return result;
  }

  /*
   * Neutralino rewrites the whole style word whenever the UI calls setSize --
   * which it does at startup, twice, to keep Aero Snap and to make the webview
   * refit its frame (see docs/decisions.md). It knows nothing about the caption
   * bit, so without this the animations would come back off at the first resize.
   */
  if (message == WM_STYLECHANGING && wparam == GWL_STYLE) {
    ((STYLESTRUCT *)lparam)->styleNew |= WS_CAPTION;
  }

  /*
   * The top border went with the band, so the UI draws grab strips there and
   * asks for the resize by name. It has to be started from this thread:
   * WM_NCLBUTTONDOWN enters the OS sizing loop, and a loop entered from the
   * extension's thread would be pumping the wrong message queue. Posting the
   * request and sending the button here is what moves it across.
   */
  if (resizeMessage != 0 && message == resizeMessage) {
    POINT cursor;
    if (!GetCursorPos(&cursor)) return 0;
    ReleaseCapture();
    SendMessageW(window, WM_NCLBUTTONDOWN, wparam, MAKELPARAM(cursor.x, cursor.y));
    return 0;
  }

  return CallWindowProcW(baseProc, window, message, wparam, lparam);
}

static void install(HWND window) {
  HMODULE self;

  /*
   * Pinned, because the extension unhooks the moment the chrome is in: an
   * unloaded DLL would leave GWLP_WNDPROC pointing into freed memory, which is
   * a crash on the next message rather than a missing feature.
   */
  if (!GetModuleHandleExW(
          GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN,
          (LPCWSTR)(void *)&install, &self)) {
    return;
  }

  resizeMessage = RegisterWindowMessageW(RESIZE_MESSAGE);

  /* Subclass first, so the frame change the style triggers below is already
   * being answered by chromeProc rather than by the caption Windows would
   * otherwise draw for a frame it thinks is now captioned. */
  baseProc = (WNDPROC)SetWindowLongPtrW(window, GWLP_WNDPROC, (LONG_PTR)chromeProc);
  if (!baseProc) return;
  chromed = window;

  SetWindowLongPtrW(window, GWL_STYLE, GetWindowLongPtrW(window, GWL_STYLE) | WS_CAPTION);
  SetWindowPos(window, NULL, 0, 0, 0, 0,
               SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
}

/*
 * The hook the extension installs on the app's UI thread, which is what maps
 * this DLL into the app process at all. It is a WH_CALLWNDPROC hook because
 * that one fires on a *sent* message, so the extension can send the install
 * message and know the work has happened by the time the send returns.
 *
 * The window is taken from the message rather than searched for. Every other
 * way of choosing (visible, unowned, on this thread) has to guess about the
 * windows WebView2 builds for its own popups; the extension already knows which
 * HWND it means, so it says so by sending to it.
 */
__declspec(dllexport) LRESULT CALLBACK SquealChromeHook(int code, WPARAM wparam, LPARAM lparam) {
  if (code == HC_ACTION && chromed == NULL) {
    const CWPSTRUCT *sent = (const CWPSTRUCT *)lparam;
    if (installMessage == 0) installMessage = RegisterWindowMessageW(INSTALL_MESSAGE);
    /* A failed registration answers 0, which is WM_NULL -- a message the app
     * really does receive, and one that would otherwise be read as the install
     * request and hand the chrome to whatever window happened to get it. */
    if (installMessage != 0 && sent->message == installMessage) install(sent->hwnd);
  }
  return CallNextHookEx(NULL, code, wparam, lparam);
}
