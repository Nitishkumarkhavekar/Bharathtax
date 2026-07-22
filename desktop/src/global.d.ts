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
      };
      app: {
        openLog: () => Promise<void>;
      };
    };
  }
}
