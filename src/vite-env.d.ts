/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  /** Só em .env.emulator: botões de acesso rápido com as contas de demonstração. */
  readonly VITE_DEMO_LOGIN?: string;
  readonly VITE_DEMO_PASSWORD?: string;
}
