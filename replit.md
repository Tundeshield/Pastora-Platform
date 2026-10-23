# Pastora

Pastoral care and church operations SaaS. See README.md for architecture, setup and
deployment, docs/SECURITY.md for the security model and docs/FIREBASE_SETUP.md for
Firebase configuration.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API on port 8080
- `pnpm --filter @workspace/pastora run dev` — web app (proxies /api to the API)
- `pnpm run typecheck`, `pnpm test`, `pnpm test:emulator`
- `pnpm --filter @workspace/api-spec run codegen` — regenerate client and validators
- Required server secret: `FIREBASE_SERVICE_ACCOUNT_JSON`; web vars: `VITE_FIREBASE_*`
