// Ambient typing for Vite's `import.meta.env` under the SERVER tsconfig
// (tsconfig.check.json — loads only @types/node, no `vite/client`).
//
// shared/config/enabled-modules.ts must read `import.meta.env.PROD` as a DIRECT
// member expression so Vite statically replaces it in the browser build (true
// in a production `vite build`, false in dev). An indirect read via a local or
// cast — e.g. `const m = import.meta; m.env.PROD` — is NOT replaced and
// resolves to `undefined` in the browser, silently disabling finance-only
// enforcement in production. This declaration lets that shared file type-check
// under the server config. The CLIENT config uses `vite/client`'s own (richer)
// ImportMetaEnv and never includes this file (server/types is server-only).
interface ImportMetaEnv {
  readonly PROD: boolean;
  readonly DEV: boolean;
  readonly MODE: string;
  readonly VITE_FINANCE_ONLY_DEV?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
