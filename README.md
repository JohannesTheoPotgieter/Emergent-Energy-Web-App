# Emergent Energy Web App

This repository contains the Emergent Energy operations platform (web client, API server, and database migrations).

For current documentation, start here:

- **Documentation index:** [`docs/README.md`](docs/README.md)

The docs set has been consolidated so each major topic has a single canonical source of truth.

## Local setup

```bash
npm ci                # install pinned deps from package-lock.json
npm run check         # full TypeScript check (server + client)
npm run db:check      # schema-drift guard
npm run test          # unit tests (no DB needed)
npm run dev           # Express + Vite on :5000
```

API / smoke / workflow tests need a live database; see `script/run-with-app.ts`.
