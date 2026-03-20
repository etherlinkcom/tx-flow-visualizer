/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_TEZOS_WS_URL?: string;
  readonly VITE_WS_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
