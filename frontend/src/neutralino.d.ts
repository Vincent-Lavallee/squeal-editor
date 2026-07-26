/**
 * Ambient types for the Neutralino client, which is loaded via a plain <script>
 * tag in index.html and therefore exists only as a global.
 *
 * `neu update` does download a full neutralino.d.ts, but it lands in
 * public/js/ (gitignored, fetched at install) and is shaped as a module. Rather
 * than import types across that boundary, this declares the small surface the
 * app actually uses. Verified against the client's own d.ts for v6.8.
 */

/**
 * The app process's own id, injected as a global alongside the client.
 *
 * Typed as a number because that is what it is at runtime -- the client's own
 * d.ts calls it a string, and it is not.
 */
declare const NL_PID: number;
/**
 * The OS Neutralino is running on.
 * `Darwin` on macOS, `Windows` on Windows, `Linux` on Linux.
 */
declare const NL_OS: string;

declare namespace Neutralino {
  function init(): void;

  namespace events {
    function on(event: string, handler: (ev: CustomEvent) => void): Promise<unknown>;
    function off(event: string, handler: (ev: CustomEvent) => void): Promise<unknown>;
  }

  namespace extensions {
    interface ExtensionStats {
      loaded: string[];
      connected: string[];
    }
    function dispatch(extensionId: string, event: string, data?: unknown): Promise<void>;
    function getStats(): Promise<ExtensionStats>;
  }

  namespace app {
    function exit(code?: number): Promise<void>;
    /** Forceful fallback for when exit()'s native shutdown path hangs. */
    function killProcess(): Promise<void>;
  }

  namespace debug {
    function log(message: string, type?: 'INFO' | 'WARNING' | 'ERROR'): Promise<void>;
  }

  namespace clipboard {
    /** Copy a table's name from the context menu. A webview API, not the bridge. */
    function writeText(text: string): Promise<void>;
  }

  namespace os {
    /**
     * Hand a path or URL to the OS's default handler. A directory opens in the
     * file manager, which is what "Open app data" means -- the extension only
     * says where the folder is.
     */
    function open(url: string): Promise<void>;

    interface Filter {
      name: string;
      extensions: string[];
    }
    interface OpenDialogOptions {
      multiSelections?: boolean;
      filters?: Filter[];
      defaultPath?: string;
    }
    /**
     * The OS's own file picker, for choosing a SQLite database to connect to.
     *
     * A webview API rather than a bridge command, by the extension's own test:
     * the webview can do this itself, so it does not belong in the extension.
     * Resolves to an **empty array** when the user cancels -- not a rejection --
     * which is why the caller checks the length rather than catching.
     */
    function showOpenDialog(title?: string, options?: OpenDialogOptions): Promise<string[]>;
  }

  namespace window {
    interface SizeOptions {
      width?: number;
      height?: number;
      minWidth?: number;
      minHeight?: number;
      resizable?: boolean;
    }
    function setSize(options: SizeOptions): Promise<void>;
    function getSize(): Promise<{ width: number; height: number }>;
    function minimize(): Promise<void>;
    function maximize(): Promise<void>;
    function unmaximize(): Promise<void>;
    function isMaximized(): Promise<boolean>;
    /** Hands the window to the OS move loop; that is what keeps Aero Snap native. */
    function beginDrag(screenX?: number, screenY?: number): Promise<void>;
    /** Brings the window to the foreground and gives it keyboard focus. */
    function focus(): Promise<void>;
  }
}
