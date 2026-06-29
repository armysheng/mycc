/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEV_LOGIN_CREDENTIAL?: string;
  readonly VITE_DEV_LOGIN_PASSWORD?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "file-icons-js" {
  export function getClass(name: string): string | null;
  export function getClassWithColor(name: string): string | null;
}
