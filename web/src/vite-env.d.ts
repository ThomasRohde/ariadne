/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  readonly VITE_MAX_TRACES?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
