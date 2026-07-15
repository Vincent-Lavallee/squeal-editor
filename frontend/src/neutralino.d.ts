/**
 * Ambient types for the Neutralino client, which is loaded via a plain <script>
 * tag in index.html and therefore exists only as a global.
 *
 * `neu update` does download a full neutralino.d.ts, but it lands in
 * public/js/ (gitignored, fetched at install) and is shaped as a module. Rather
 * than import types across that boundary, this declares the small surface the
 * app actually uses. Verified against the client's own d.ts for v6.8.
 */

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
  }
}
