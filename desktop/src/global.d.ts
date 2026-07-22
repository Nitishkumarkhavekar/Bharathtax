export {};

declare global {
  interface Window {
    bharat: {
      config: {
        get: () => Promise<{
          serverUrl: string;
          jwt: string | null;
          jwtExpiresAt: string | null;
        }>;
        set: (patch: {
          serverUrl?: string;
          jwt?: string | null;
          jwtExpiresAt?: string | null;
        }) => Promise<{
          serverUrl: string;
          jwt: string | null;
          jwtExpiresAt: string | null;
        }>;
        clearSession: () => Promise<void>;
      };
      files: {
        pick: () => Promise<Array<{ name: string; path: string; size: number }>>;
        read: (absPath: string) => Promise<ArrayBuffer>;
        saveDocx: (
          defaultName: string,
          bytes: ArrayBuffer,
        ) => Promise<{ saved: boolean; path?: string }>;
        saveFile: (
          defaultName: string,
          bytes: ArrayBuffer,
        ) => Promise<{ saved: boolean; path?: string }>;
      };
      app: {
        openLog: () => Promise<void>;
        version: () => Promise<string>;
      };
      preview: {
        writePdf: (bytes: ArrayBuffer, slug: string) => Promise<{ url: string }>;
      };
      updater: {
        on: (cb: (ev: UpdaterEvent) => void) => () => void;
        check: () => Promise<void>;
        install: () => Promise<void>;
      };
      manualEdit: {
        start: (args: { bytes: ArrayBuffer; suggestedName: string; sessionId: string }) =>
          Promise<{ sessionId: string; path: string }>;
        stop: (sessionId: string) => Promise<void>;
        openContainingFolder: (sessionId: string) => Promise<void>;
        onChanged: (cb: (ev: { sessionId: string; bytes: ArrayBuffer; size: number }) => void) => () => void;
        onError: (cb: (ev: { sessionId: string; message: string }) => void) => () => void;
      };
    };
  }

  // Electron <webview> tag — Chromium's hosted-content element.  We use it
  // for the PDF preview because Chromium's PDF viewer runs reliably inside
  // a webview but is flaky inside a blob-URL iframe under Electron's CSP.
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          src?: string;
          plugins?: string;
          nodeintegration?: string;
          disablewebsecurity?: string;
        },
        HTMLElement
      >;
    }
  }

  type UpdaterEvent =
    | { kind: "checking" }
    | { kind: "available"; version: string; notes?: string | null }
    | { kind: "not-available"; version: string }
    | { kind: "download-progress"; percent: number; bytesPerSecond: number; transferred: number; total: number }
    | { kind: "downloaded"; version: string }
    | { kind: "error"; message: string };
}
