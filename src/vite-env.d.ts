/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional override for the browser WebSocket URL (dev or prod). */
  readonly VITE_WS_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
