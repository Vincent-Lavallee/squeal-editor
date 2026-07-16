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
 * for structure everywhere else.
 *
 * Entirely best-effort. Older Windows has no such attribute, and every failure
 * here just leaves the band as it was. Nothing in this file can break a query.
 */

import { dlopen, FFIType, ptr } from 'bun:ffi';

// DWM window attributes, Windows 11 build 22000+. Earlier Windows fails the call
// and keeps its own frame colour, which is the honest fallback.
const DWMWA_BORDER_COLOR = 34;
const DWMWA_CAPTION_COLOR = 35;

// GetWindow(hwnd, GW_OWNER): a top-level app window has no owner; a dialog does.
const GW_OWNER = 4;

const S_OK = 0;

function open() {
  const user32 = dlopen('user32.dll', {
    FindWindowExW: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr],
      returns: FFIType.ptr,
    },
    GetWindowThreadProcessId: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
    IsWindowVisible: { args: [FFIType.ptr], returns: FFIType.i32 },
    GetWindow: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.ptr },
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
function findWindow(user32: Libs['user32'], pid: number): number | null {
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
      return hwnd as number;
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
