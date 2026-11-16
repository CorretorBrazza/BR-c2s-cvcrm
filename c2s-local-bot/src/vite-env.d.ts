/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LICENSE_PUBLIC_KEY?: string;
  readonly VITE_LICENSE_API_BASE?: string;
  readonly VITE_TELEMETRY_ENDPOINT?: string;
  readonly VITE_APP_ENV?: 'development' | 'production';
  /** "true" liga a automação no bundle. Qualquer outro valor (ou ausente) = desligada. */
  readonly VITE_AUTOMATION_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
