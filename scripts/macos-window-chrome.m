#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>

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
  window.titleVisibility = NSWindowTitleHidden;

  /* The webview draws its own traffic lights (TitlebarMacos.tsx). */
  [window standardWindowButton:NSWindowCloseButton].hidden = YES;
  [window standardWindowButton:NSWindowMiniaturizeButton].hidden = YES;
  [window standardWindowButton:NSWindowZoomButton].hidden = YES;

  /* The window may have failed to become key while it was borderless. */
  [window makeKeyAndOrderFront:nil];
}

/*
 * Neutralino never populates NSApp.mainMenu, so the macOS menu bar is blank —
 * unlike Windows, where File/About live in our own custom titlebar HTML
 * (Titlebar.tsx). This rebuilds the same two menus, with the same items, as
 * literal top-level NSMenus so macOS users get the same functionality in the
 * place macOS convention puts it.
 *
 * A native menu item cannot call a React handler directly, so each one
 * evaluates a small JS snippet in the webview that dispatches a `squeal:menu`
 * CustomEvent; TitlebarMacos.tsx listens for it and calls the exact same
 * handlers Titlebar.tsx's dropdowns already use. Exit is routed the same way
 * rather than calling -[NSApplication terminate:] directly, so the native
 * menu item shuts down exactly like the traffic-light close button does.
 */

@interface SquealMenuHandler : NSObject
+ (WKWebView *)findWebViewIn:(NSView *)view;
@end

@implementation SquealMenuHandler

+ (WKWebView *)findWebViewIn:(NSView *)view {
  if ([view isKindOfClass:[WKWebView class]]) return (WKWebView *)view;
  for (NSView *sub in view.subviews) {
    WKWebView *found = [self findWebViewIn:sub];
    if (found) return found;
  }
  return nil;
}

+ (void)dispatchEvent:(NSString *)name {
  NSWindow *window = NSApp.keyWindow ?: NSApp.mainWindow ?: NSApp.windows.firstObject;
  WKWebView *webView = window ? [self findWebViewIn:window.contentView] : nil;
  if (!webView) return;
  NSString *js = [NSString stringWithFormat:
      @"window.dispatchEvent(new CustomEvent('squeal:menu', { detail: '%@' }))", name];
  [webView evaluateJavaScript:js completionHandler:nil];
}

- (void)exit:(id)sender { [SquealMenuHandler dispatchEvent:@"exit"]; }
- (void)environments:(id)sender { [SquealMenuHandler dispatchEvent:@"environments"]; }
- (void)checkForUpdates:(id)sender { [SquealMenuHandler dispatchEvent:@"checkForUpdates"]; }
- (void)about:(id)sender { [SquealMenuHandler dispatchEvent:@"about"]; }
- (void)openDataDir:(id)sender { [SquealMenuHandler dispatchEvent:@"openDataDir"]; }

@end

static void installMenuBar(void) {
  /* Retained for the process's lifetime: NSMenuItem.target is weak-ish (not
   * retained by the menu the way the docs imply on older AppKit), so a local
   * would be collected the moment this function returns. */
  static SquealMenuHandler *handler;
  handler = [SquealMenuHandler new];

  NSMenu *mainMenu = [NSMenu new];

  /* AppKit always renames the first top-level item's title to the running
   * process's name, no matter what is set here — so this stays an empty
   * submenu rather than duplicating "File" into a slot it can't occupy. */
  NSMenuItem *appMenuItem = [NSMenuItem new];
  [mainMenu addItem:appMenuItem];
  appMenuItem.submenu = [NSMenu new];

  NSMenuItem *fileMenuItem = [NSMenuItem new];
  [mainMenu addItem:fileMenuItem];
  NSMenu *fileMenu = [[NSMenu alloc] initWithTitle:@"File"];
  fileMenuItem.submenu = fileMenu;
  NSMenuItem *environmentsItem = [[NSMenuItem alloc] initWithTitle:@"Environments…" action:@selector(environments:) keyEquivalent:@""];
  environmentsItem.target = handler;
  [fileMenu addItem:environmentsItem];

  NSMenuItem *exitItem = [[NSMenuItem alloc] initWithTitle:@"Exit" action:@selector(exit:) keyEquivalent:@""];
  exitItem.target = handler;
  [fileMenu addItem:exitItem];

  NSMenuItem *aboutMenuItem = [NSMenuItem new];
  [mainMenu addItem:aboutMenuItem];
  NSMenu *aboutMenu = [[NSMenu alloc] initWithTitle:@"About"];
  aboutMenuItem.submenu = aboutMenu;

  NSMenuItem *checkItem = [[NSMenuItem alloc] initWithTitle:@"Check for updates…" action:@selector(checkForUpdates:) keyEquivalent:@""];
  checkItem.target = handler;
  [aboutMenu addItem:checkItem];

  NSMenuItem *versionItem = [[NSMenuItem alloc] initWithTitle:@"Version" action:@selector(about:) keyEquivalent:@""];
  versionItem.target = handler;
  [aboutMenu addItem:versionItem];

  NSMenuItem *dataDirItem = [[NSMenuItem alloc] initWithTitle:@"Open app data" action:@selector(openDataDir:) keyEquivalent:@""];
  dataDirItem.target = handler;
  [aboutMenu addItem:dataDirItem];

  NSApplication.sharedApplication.mainMenu = mainMenu;
}

/*
 * Once mainMenu is non-nil (installMenuBar above), AppKit routes Cmd+<key>
 * through the menu bar's key-equivalent matching before it reaches the
 * responder chain. With no Edit menu claiming c/v/x/a/z, those keystrokes have
 * nowhere to resolve to copy:/paste:/cut:/selectAll:/undo:/redo: and silently
 * no-op in every native text field the WKWebView hosts (e.g. the connection
 * form's plain <input>s) — this is the regression an Edit menu would normally
 * fix, but a visible Edit menu next to File/About isn't wanted here. A local
 * event monitor gets the same effect invisibly: it sends the standard edit
 * action straight to the first responder itself, exactly what a menu item's
 * keyEquivalent would have dispatched.
 *
 * The event is always swallowed (return nil): letting it also reach WKWebView
 * natively is what caused the audible error beep — WKWebView's own fallback
 * handling re-checks for a validated menu item, finds none (there is still no
 * real Edit menu), and beeps as if the shortcut were entirely unhandled, even
 * though -sendAction: already performed it correctly.
 *
 * copy:/paste:/cut: only need -sendAction:, since WKWebView forwards those
 * straight to the system pasteboard regardless of what's focused. selectAll:/
 * undo:/redo: are different: Monaco keeps its own model-level selection and
 * undo stack via a JS keydown listener, which -sendAction:'s AppKit-level
 * selectAll:/undo:/redo: knows nothing about. Swallowing the real event would
 * silently break Monaco's shortcuts, so those three are additionally
 * replayed as a synthetic DOM keydown at the focused element — Monaco's own
 * listener reacts to that exactly as it would to the real one, while native
 * <input>s simply ignore it (browsers only apply built-in editing behavior to
 * trusted, physically-originated key events, never to script-dispatched
 * ones), leaving -sendAction:'s result as their only effect.
 */
static void replayKeydownAtFocusedElement(NSString *key, NSString *code, int keyCode, BOOL shift) {
  NSWindow *window = NSApp.keyWindow ?: NSApp.mainWindow ?: NSApp.windows.firstObject;
  WKWebView *webView = window ? [SquealMenuHandler findWebViewIn:window.contentView] : nil;
  if (!webView) return;
  NSString *js = [NSString stringWithFormat:
      @"document.activeElement && document.activeElement.dispatchEvent(new KeyboardEvent('keydown', "
       "{ key: '%@', code: '%@', keyCode: %d, which: %d, metaKey: true, shiftKey: %@, "
       "bubbles: true, cancelable: true }))",
      key, code, keyCode, keyCode, shift ? @"true" : @"false"];
  [webView evaluateJavaScript:js completionHandler:nil];
}

static void installEditShortcuts(void) {
  [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown
                                         handler:^NSEvent *(NSEvent *event) {
    NSEventModifierFlags flags = event.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
    BOOL cmd = (flags & NSEventModifierFlagCommand) != 0;
    BOOL shift = (flags & NSEventModifierFlagShift) != 0;
    BOOL onlyCmdOrCmdShift = cmd && (flags & ~(NSEventModifierFlagCommand | NSEventModifierFlagShift)) == 0;
    if (!onlyCmdOrCmdShift) return event;

    NSString *key = event.charactersIgnoringModifiers;

    if (!shift && [key isEqualToString:@"c"]) return [NSApp sendAction:@selector(copy:) to:nil from:nil] ? nil : event;
    if (!shift && [key isEqualToString:@"v"]) return [NSApp sendAction:@selector(paste:) to:nil from:nil] ? nil : event;
    if (!shift && [key isEqualToString:@"x"]) return [NSApp sendAction:@selector(cut:) to:nil from:nil] ? nil : event;

    if (!shift && [key isEqualToString:@"a"]) {
      [NSApp sendAction:@selector(selectAll:) to:nil from:nil];
      replayKeydownAtFocusedElement(@"a", @"KeyA", 65, NO);
      return nil;
    }
    if (!shift && [key isEqualToString:@"z"]) {
      [NSApp sendAction:@selector(undo:) to:nil from:nil];
      replayKeydownAtFocusedElement(@"z", @"KeyZ", 90, NO);
      return nil;
    }
    if (shift && [key isEqualToString:@"z"]) {
      [NSApp sendAction:@selector(redo:) to:nil from:nil];
      replayKeydownAtFocusedElement(@"z", @"KeyZ", 90, YES);
      return nil;
    }

    return event;
  }];
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

  /*
   * Installed on did-finish-launching, not here: NSApp itself may not exist
   * yet this early (dyld runs constructors before main), and setting the menu
   * before Neutralino's own startup finishes risks Neutralino's init clobbering
   * it right back to empty.
   */
  [[NSNotificationCenter defaultCenter]
      addObserverForName:NSApplicationDidFinishLaunchingNotification
                  object:nil
                   queue:[NSOperationQueue mainQueue]
              usingBlock:^(NSNotification *note) {
                installMenuBar();
                installEditShortcuts();
              }];
}
