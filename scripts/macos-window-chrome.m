#import <AppKit/AppKit.h>

/*
 * Injected into the Neutralino shell via DYLD_INSERT_LIBRARIES (the launcher
 * shim in package-macos.sh exports it). Nothing outside the process can touch
 * an NSWindow, and Neutralino exposes none of the flags below, so in-process
 * native code is the only place this can happen.
 *
 * Why it exists: Neutralino's borderless mode strips NSWindowStyleMaskTitled,
 * and AppKit answers NO from canBecomeKeyWindow for a window styled that way —
 * it can never become the key window, so no keystroke is ever delivered to the
 * webview, no matter how often window.focus() runs. The native resize border
 * goes with the titlebar. Upstream: neutralinojs/neutralinojs#1197, open as of
 * v6.8.0.
 *
 * The macOS shape of a custom titlebar is not a borderless window. It is a
 * *titled* window whose titlebar is transparent and whose content extends
 * underneath it (Electron's `hiddenInset`): keyboard focus, native edge
 * resize and native zoom all survive, and the webview paints the bar.
 */

static void restyle(NSWindow *window) {
  window.styleMask |= NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
                      NSWindowStyleMaskMiniaturizable |
                      NSWindowStyleMaskResizable |
                      NSWindowStyleMaskFullSizeContentView;
  window.titlebarAppearsTransparent = YES;
  window.titleVisibility = NSWindowTitleVisibilityHidden;

  /* The webview draws its own traffic lights (TitlebarMacos.tsx). */
  [window standardWindowButton:NSWindowCloseButton].hidden = YES;
  [window standardWindowButton:NSWindowMiniaturizeButton].hidden = YES;
  [window standardWindowButton:NSWindowZoomButton].hidden = YES;

  /* The window may have failed to become key while it was borderless. */
  [window makeKeyAndOrderFront:nil];
}

__attribute__((constructor)) static void squealWindowChromeInit(void) {
  /*
   * dyld runs this before main, so the window does not exist yet, and
   * Neutralino applies its borderless mask partway through startup — hence a
   * notification observer rather than a one-shot. Guards:
   *
   * - FullSizeContentView is the already-restyled marker; nothing else in the
   *   process ever sets it, so each window is restyled exactly once.
   * - Closable + normal level excludes the borderless child windows WKWebView
   *   creates for dropdowns and autocomplete, which must stay borderless.
   */
  [[NSNotificationCenter defaultCenter]
      addObserverForName:NSWindowDidUpdateNotification
                  object:nil
                   queue:[NSOperationQueue mainQueue]
              usingBlock:^(NSNotification *note) {
                NSWindow *window = note.object;
                BOOL restyled =
                    (window.styleMask & NSWindowStyleMaskFullSizeContentView) != 0;
                BOOL isAppWindow =
                    (window.styleMask & NSWindowStyleMaskClosable) != 0 &&
                    window.level == NSNormalWindowLevel;
                if (isAppWindow && !restyled) restyle(window);
              }];
}
