/**
 * Window-frame chrome. The one thing in this process that is not about databases.
 *
 * The window is borderless, so the UI re-adds WS_THICKFRAME at startup to keep
 * Aero Snap and edge-resize alive (see docs/decisions.md). Windows then draws a
 * ~7px frame band in its own colour above our titlebar, in the non-client area
 * that the webview physically cannot paint.
 *
 * This process can paint it, and that is the whole reason it is asked to: the
 * extension is where the native calls the webview cannot make live -- opening a
 * TCP socket is one, calling dwmapi is another. Recolouring the frame to the app
 * background collapses the band into the 1px line the design system already uses
 * for structure everywhere else. Fitting a maximised window back onto the work
 * area is the same shape of favour: window placement against monitor geometry
 * is a native fact the webview cannot read or set.
 *
 * Entirely best-effort. Older Windows has no such attribute, and every failure
 * here just leaves the band as it was. Nothing in this file can break a query.
 */

import { dlopen, FFIType, ptr, type Pointer } from 'bun:ffi';

// DWM window attributes, Windows 11 build 22000+. Earlier Windows fails the call
// and keeps its own frame colour, which is the honest fallback.
const DWMWA_BORDER_COLOR = 34;
const DWMWA_CAPTION_COLOR = 35;

// GetWindow(hwnd, GW_OWNER): a top-level app window has no owner; a dialog does.
const GW_OWNER = 4;

const S_OK = 0;

const MONITOR_DEFAULTTONEAREST = 2;
const SWP_NOZORDER = 0x0004;
const SWP_NOACTIVATE = 0x0010;

function open() {
  const user32 = dlopen('user32.dll', {
    FindWindowExW: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.ptr,
    },
    GetWindowThreadProcessId: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
    IsWindowVisible: { args: [FFIType.ptr], returns: FFIType.i32 },
    GetWindow: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
    IsZoomed: { args: [FFIType.ptr], returns: FFIType.i32 },
    GetWindowRect: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    GetClientRect: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    ClientToScreen: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    MonitorFromWindow: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
    GetMonitorInfoW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
    SetWindowPos: {
      args: [
        FFIType.ptr,
        FFIType.ptr,
        FFIType.i32,
        FFIType.i32,
        FFIType.i32,
        FFIType.i32,
        FFIType.u32,
      ],
      returns: FFIType.i32,
    },
  });
  const dwmapi = dlopen('dwmapi.dll', {
    DwmSetWindowAttribute: {
      args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32],
      returns: FFIType.i32,
    },
  });
  return { user32, dwmapi };
}

type Libs = ReturnType<typeof open>;
let libs: Libs | null = null;

/**
 * `#rrggbb` -> Win32 COLORREF, which is 0x00BBGGRR: the byte order is reversed
 * from CSS, and getting that backwards silently paints the frame the wrong hue
 * rather than failing.
 */
function toColorRef(colour: string): number | null {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour.trim())?.[1];
  if (!hex) return null;

  const rgb = Number.parseInt(hex, 16);
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return (b << 16) | (g << 8) | r;
}

/**
 * The app's top-level window, by the process that owns it.
 *
 * The pid has to be handed to us: Neutralino spawns extensions through a shell,
 * so this process's own parent is that shell and not the window -- which is why
 * the UI sends `NL_PID` rather than us looking upwards for it.
 *
 * FindWindowExW with a null parent walks the top-level windows, which gets the
 * same answer as EnumWindows without needing a callback across the FFI boundary.
 */
function findWindow(user32: Libs['user32'], pid: number): Pointer | null {
  const owner = new Uint32Array(1);
  const ownerPtr = ptr(owner);

  let hwnd = user32.symbols.FindWindowExW(null, null, null, null);
  while (hwnd) {
    user32.symbols.GetWindowThreadProcessId(hwnd, ownerPtr);
    if (
      owner[0] === pid &&
      user32.symbols.IsWindowVisible(hwnd) !== 0 &&
      !user32.symbols.GetWindow(hwnd, GW_OWNER)
    ) {
      return hwnd;
    }
    hwnd = user32.symbols.FindWindowExW(null, hwnd, null, null);
  }
  return null;
}

/**
 * Paint the window frame `colour`, so the band the OS draws above the titlebar
 * reads as the same surface as the app.
 *
 * `colour` comes from the UI rather than being written here, because `tokens.css`
 * is the source of truth for it and a second copy is how the two drift apart.
 * Returns whether Windows actually took it.
 */
export function matchWindowFrame(pid: number, colour: string): boolean {
  if (process.platform !== 'win32') return false;

  const colorRef = toColorRef(colour);
  if (colorRef === null) return false;

  try {
    libs ??= open();
    const hwnd = findWindow(libs.user32, pid);
    if (!hwnd) return false;

    // A DWM attribute is stored on the window, so this survives the frame repaint
    // that the UI's own setSize triggers -- one application holds.
    const value = ptr(new Uint32Array([colorRef]));
    const border = libs.dwmapi.symbols.DwmSetWindowAttribute(hwnd, DWMWA_BORDER_COLOR, value, 4);
    const caption = libs.dwmapi.symbols.DwmSetWindowAttribute(hwnd, DWMWA_CAPTION_COLOR, value, 4);
    return border === S_OK && caption === S_OK;
  } catch {
    return false; // No dwmapi, no FFI, no frame -- the band simply stays.
  }
}

/**
 * Clamp a maximised window onto its monitor's work area.
 *
 * Windows maximises a window that has WS_THICKFRAME but no WS_CAPTION -- which
 * is exactly this window's style -- over the *whole monitor*, inflated by the
 * resize border on every side. Measured live: work area 0,30..1920,1200, and
 * the "maximised" window at -7,-7..1927,1207. The taskbar is buried and ~7px of
 * every edge hangs offscreen, which is where the close button and the status
 * bar were going.
 *
 * The target is the work area grown by the frame insets, not the work area
 * itself. The webview is the *client* area, and WS_THICKFRAME insets it by the
 * resize border (7px a side here): a window rect equal to the work area was
 * measured leaving the content at 7,37..1913,1193, floating a frame-wide strip
 * inside every edge -- the close button no longer clipped, but no longer in the
 * screen corner either. Overshooting by exactly the insets is what the OS's own
 * maximise of a captioned window does: the invisible frame hangs offscreen and
 * the content lands on the work area to the pixel.
 *
 * SetWindowPos moves the window without clearing its maximised state (verified:
 * IsZoomed stays true and restore still returns to the old rect), so this runs
 * after each maximise and simply puts the window where a captioned one would
 * have gone. The no-op check matters: the UI calls this from a resize listener,
 * and repositioning fires a resize, so an already-fitted window must not be
 * touched again.
 */
export function fitMaximizedToWorkArea(pid: number): boolean {
  if (process.platform !== 'win32') return false;

  try {
    libs ??= open();
    const { user32 } = libs;
    const hwnd = findWindow(user32, pid);
    if (!hwnd) return false;
    if (user32.symbols.IsZoomed(hwnd) === 0) return false;

    const monitor = user32.symbols.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
    if (!monitor) return false;

    // MONITORINFO: cbSize, rcMonitor, rcWork, dwFlags -- 40 bytes, rcWork at [5..8].
    const info = new Int32Array(10);
    info[0] = info.byteLength;
    if (user32.symbols.GetMonitorInfoW(monitor, ptr(info)) === 0) return false;
    const work = { left: info[5]!, top: info[6]!, right: info[7]!, bottom: info[8]! };

    const rect = new Int32Array(4);
    if (user32.symbols.GetWindowRect(hwnd, ptr(rect)) === 0) return false;

    // The frame insets: where the client area sits inside the window rect. The
    // client origin needs ClientToScreen because GetClientRect answers in client
    // coordinates, where the origin is 0,0 by definition.
    const client = new Int32Array(4);
    if (user32.symbols.GetClientRect(hwnd, ptr(client)) === 0) return false;
    const origin = new Int32Array(2);
    if (user32.symbols.ClientToScreen(hwnd, ptr(origin)) === 0) return false;

    const inset = {
      left: origin[0]! - rect[0]!,
      top: origin[1]! - rect[1]!,
      right: rect[2]! - (origin[0]! + client[2]!),
      bottom: rect[3]! - (origin[1]! + client[3]!),
    };

    const target = {
      left: work.left - inset.left,
      top: work.top - inset.top,
      right: work.right + inset.right,
      bottom: work.bottom + inset.bottom,
    };

    if (
      rect[0] === target.left &&
      rect[1] === target.top &&
      rect[2] === target.right &&
      rect[3] === target.bottom
    ) {
      return true; // Already fitted; moving again would echo another resize.
    }

    return (
      user32.symbols.SetWindowPos(
        hwnd,
        null,
        target.left,
        target.top,
        target.right - target.left,
        target.bottom - target.top,
        SWP_NOZORDER | SWP_NOACTIVATE
      ) !== 0
    );
  } catch {
    return false; // Same category as above: a cosmetic loss, never an error.
  }
}
