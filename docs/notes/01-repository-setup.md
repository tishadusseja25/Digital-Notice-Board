# Notes 01: Repository setup and scaffold

## Layout and how the pieces connect
- Root `package.json` is an npm workspace (`shared`, `client`, `server`). `npm run build|test|dev` fan out to each workspace with `--if-present`. `"type": "module"` at the root keeps `eslint.config.js` ESM without a reparse warning.
- `tsconfig.base.json` holds the strict settings (`strict`, `noUncheckedIndexedAccess`). `client` extends it with DOM libs and `jsx: react-jsx`; `server` extends it with `module/moduleResolution: NodeNext`.
- Why NodeNext on the server only: `tsc` output runs directly in Node, so relative imports must carry `.js` extensions (see `server/src/app.ts`). The client is bundled by Vite, so the base `Bundler` resolution is fine.
- `shared/` exports TypeScript source (`"main": "src/index.ts"`) and has no build step. Nothing imports it yet. When M2 makes the server import it, the server build must handle it (either compile it or bundle it); decide then.

## Client (`client/`)
- Vite 5 + React 18 + Tailwind 3.4 (PostCSS plugin). Tailwind 3 was chosen over 4 because its config and PostCSS setup are stable and widely documented.
- `vite.config.ts` proxies `/api` and `/socket.io` (with `ws: true`) to `localhost:4000`. This keeps browser and API on one origin in development, so the later `SameSite=Strict` cookies work without CORS.
- Tests: Vitest in `jsdom` with `globals: true`; `src/setupTests.ts` loads jest-dom matchers. The `types` array in `client/tsconfig.json` makes `describe/test/expect` and the matchers type-check.
- `npm run build -w client` runs `tsc --noEmit` first, so type errors fail the build. Current output: about 143 kB JS (46 kB gzip), 5 kB CSS. PRD budget for the public board is 300 kB gzip.

## Server (`server/`)
- `src/app.ts` exports `createApp()` without calling `listen`. Tests call it through Supertest, so no port is opened. `src/index.ts` is the only file that reads the environment and listens.
- `config/env.ts` validates with Zod and throws one readable message listing every bad variable. It currently needs only `NODE_ENV`, `PORT`, `APP_ORIGIN`. Each later milestone must add its own variables here (database URI in M2, JWT secrets in M2, image limits in M3) so the app refuses to boot when they are missing. `loadEnv(source)` takes the source as an argument for testing.
- `middleware/errorHandler.ts` defines the one error format `{ error: { code, message } }`. `HttpError(status, code, message)` is the class services will throw. Unknown errors are logged and returned as a generic 500 with no stack trace. The `_next` argument is required by Express to recognise a 4-argument error handler, hence the single ESLint disable.
- `express.json({ limit: "100kb" })` caps JSON bodies. Image uploads will use a separate multipart parser with its own limit in M3. `x-powered-by` is disabled.
- `routes/health.ts` always returns `{ status: "ok" }`. It only proves the process is up. M2 must add a database ping and return 503 when it fails, because Docker and Render will use it to decide whether the app is healthy.
- `lib/logger.ts`: pino JSON logs, silent under `NODE_ENV=test`, with `authorization`, `cookie`, `password` and `token` redacted. Note that redaction only covers the listed paths; do not log whole request bodies.

## Database tooling
- `docker-compose.yml` runs `mongo:7`. Authentication is enabled implicitly because `MONGO_INITDB_ROOT_*` creates a root user (`nb_admin`) on first start. The port is bound to `127.0.0.1` only. Data lives in the named volume `mongo-data`.
- Passwords come from `.env` via `${VAR:?message}`, so compose refuses to start if one is unset. The health check runs `mongosh ping` as `nb_admin`; the password therefore shows up in `docker inspect` on the local machine. Acceptable for local development, do not reuse this pattern in production.
- `scripts/mongo-init.js` runs only on the first start of an empty volume (Mongo's `docker-entrypoint-initdb.d` rule). It creates `noticeboard_app` (`readWrite` on `noticeboard`) and `noticeboard_ro` (`read`). After changing a password in `.env` you must remove the volume (`docker compose down -v`) or change the user in `mongosh`. `/* global db */` is there because `db` is injected by mongosh.
- The Docker `root` role on `nb_admin` is broader than the `userAdminAnyDatabase` + `backup` roles in architecture Section 5. Chosen because the official image only offers root through its env variables. The app never uses this account.
- `MONGO_RO_PASSWORD` exists in `.env.example` but is not yet in `architecture.md` Section 10. Add it when that document is next edited.

## Not verified
- Docker is not installed on the machine used for this work, so `docker compose up`, the init script and the health check were never run. The compose file was only parsed as YAML and the init script only syntax-checked (`node --check`). First action in the next session with Docker: `docker compose up -d mongo`, wait for healthy, then connect as `noticeboard_app` with the URI from `.env.example` and confirm a connection without credentials is refused.
- Node 22 was used locally; `engines` says `>=20`.

## Gotchas
- Git on Windows warns "LF will be replaced by CRLF" on every add. Harmless; add a `.gitattributes` with `* text=auto` later if it becomes noisy.
- `docs/plans/` is git-ignored on purpose (planning drafts stay private), so `/implement` cannot commit plan files. Only `docs/notes/` is committed.
- Prettier does not format `.env.example`; it is ignored by `npx prettier --write` runs on explicit paths and fails with "no parser", so do not pass it.
