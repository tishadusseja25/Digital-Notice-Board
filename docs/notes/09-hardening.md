# Notes 09: Security headers, cleanup script, access matrix

## Headers (`server/src/app.ts`)
- `helmet` is the first middleware, so static files, API answers, errors and 404s all carry the headers. Tests: `server/tests/headers.test.ts`.
- CSP directives set explicitly: `default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `font-src 'self'`, `img-src 'self' data:`, `connect-src 'self'` plus `ws://` or `wss://` of `APP_ORIGIN` (derived from its protocol and host; some browsers do not count `'self'` as covering WebSocket), `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`. Helmet's defaults would also allow `'unsafe-inline'` styles and any `https:` font; `style-src` and `font-src` are overridden because `client/dist/index.html` has no inline script or style (one module script, one stylesheet link).
- `upgrade-insecure-requests` is set to `null` (removed). With it, the compose demo on plain `http://localhost:3000` makes the browser fetch scripts over https and the page fails. On Render, HSTS provides the same protection.
- HSTS only when `NODE_ENV=production` (`hsts: false` otherwise). Browsers ignore HSTS sent over http, so the compose demo is unaffected.
- `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy: same-origin` come from helmet's defaults. Image responses set their own stricter `Content-Security-Policy: default-src 'none'; sandbox` after helmet; route headers win because they are set later.
- Gotcha: the CSP is verified as text only. Anything the client later loads from another origin (a font service, an analytics script, an external image) will be blocked in the browser. Check the browser console for "blocked by Content Security Policy" after client changes.
- Development: Vite serves the pages on 5173 and does not use these headers; they apply to Express answers (API, and the website in production).

## Cleanup (`scripts/cleanup.ts`, `npm run cleanup`)
- Run from a machine that can reach the database, same as the seed script (it is not in the Docker image): `npm run cleanup` or `npm run cleanup -- --dry-run`. It reads `MONGODB_URI` from `.env`.
- Rule 1: notices with `expiresAt` earlier than now minus 365 days (`EXPIRED_KEEP_DAYS`) are deleted with their image files (`deleteFiles` from `imageService`). A notice is processed through a Mongoose cursor, one at a time, so memory is flat. `trusted()` wraps the `$lt` because `sanitizeFilter` is on globally.
- Rule 2: GridFS files in `images.files` with `metadata.noticeId` null (or missing) and `uploadDate` older than 24 hours (`UNATTACHED_KEEP_HOURS`) are deleted. This is the only place abandoned uploads are removed. The 24-hour grace protects someone filling in the editor.
- Order: notices first, then unattached images. Files of a deleted notice are removed with it, so rule 2 never double counts them.
- Idempotent; a second run reports zeros. `cleanup({ now, dryRun })` takes the clock as a parameter for tests (`server/tests/cleanup.test.ts`). The script file is outside `server/src`, so `npm run build` does not type check it; the tests run it through Vitest.
- No audit entries are written (there is no actor). The output line is the record; redirect it to a log if you schedule the command.
- Cost: reads only expired notices (an unindexed scan of `expiresAt`, fine for a college board; add an index on `expiresAt` if the collection grows to many thousands) and the `images.files` collection. Deletes are sequential and small.
- Not covered: documents with `noticeId` set to a notice that no longer exists. Normal paths delete both together, so this should not occur.

## Access matrix (`server/tests/matrix.test.ts`)
- One row per (route, scenario) with the expected status for `[anon, author, other, admin]`. For each cell the test builds fresh data owned by the author, then calls the route as that caller with a new app instance, so the 30-writes-per-minute limiter never interferes.
- Expectations come from PRD Section 5, not from observed output. They all passed on the first run, so no access bug was found.
- The guard test walks `app._router.stack`, rebuilds `METHOD /mount/path` for every registered route (mount path is recovered from Express's internal regexp for the mount), and fails in both directions: a route missing from the table, or a row naming a route that no longer exists. If Express changes its internals, this test breaks loudly rather than silently passing.
- Socket rows live in `server/tests/realtime.test.ts`: drafts, archived notices and edits to them reach only the author and admin rooms; the public only ever learns of a removal as an id.
- The page-level half of the matrix (anonymous to `/login`, committee to the 403 page on `/admin`) is covered by the client tests in `App.routes.test.tsx`.

## Known gaps
- The temporary-password rule is still enforced on screen only (`mustChangePassword`); the API accepts a user's other requests before they change it.
- `npm audit` runs by hand, not in the pipeline.
- No real browser has checked the CSP yet.
