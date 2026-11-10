# Notes 02: Database layer and authentication

## Request pipeline (server/src/app.ts)
Order matters; each step can end the request:
1. `limiters.publicReads` - GET/HEAD only, 120/min per IP (`LIMITS.publicReadsPerMinute`).
2. `express.json({ limit: "100kb" })`, `cookieParser()`.
3. `rejectOperatorKeys` - 400 if body, query or params contain a key starting with `$` or containing `.` at any depth (depth > 10 also rejected). Catches `?q[$ne]=1` because Express's query parser turns brackets into nested objects.
4. `authenticate(env)` - reads cookie `nb_access`, sets `req.auth = { id, role }` when the JWT is valid; never rejects.
5. `requireSameOrigin(env)` - non-GET/HEAD/OPTIONS must carry `Origin` equal to `APP_ORIGIN`; a missing header is refused (403 `BAD_ORIGIN`). curl and tests must send it.
6. `limiters.writes` - non-GET only, 30/min per user id (IP when anonymous).
7. Routes, then `notFound` for `/api/*`, then `errorHandler`.
`trust proxy` is set to 1 only when `NODE_ENV=production` (Render has one proxy hop). Without it every visitor would share the proxy's IP bucket; setting it outside a proxy would let clients spoof `X-Forwarded-For` and evade limits.

## Data model (server/src/models)
- `User`: unique lowercase `email`; `passwordHash` never leaves the service (`publicUser()` is the only serializer); `active`, `mustChangePassword` (stored and returned by `/me`, not enforced by the server yet).
- `RefreshToken`: only an HMAC-SHA256 hash of the token is stored (`tokenHash`, unique), plus `family` and `revoked`. `expiresAt` has a TTL index (`expireAfterSeconds: 0`); MongoDB's TTL monitor runs about every 60 s, so expired rows can linger up to a minute, which is why queries also test `expiresAt > now`.
- `Category`: unique index with collation `{locale:"en", strength:2}` (case-insensitive). Lookups that must honour it need `.collation(...)` (see `scripts/seed-admin.ts`).
- `AuditLog`: `at` has a 365-day TTL index. Written by `auditService.audit()`, which logs and swallows write errors so an audit failure cannot block a login.
- `db.ts` sets `strictQuery` and `sanitizeFilter` globally.

## sanitizeFilter and `trusted()`
With `sanitizeFilter: true`, Mongoose wraps any `$operator` inside a filter in `$eq`, so user input like `{ $ne: null }` cannot widen a query. This also neutralises operators the server writes itself: the first test run returned 500s because `{ $gt: new Date() }` and `{ $ne: keep }` were cast as literal values. Server-built operators must be wrapped in `mongoose.trusted(...)` (see `authService.refresh` and `changePassword`). Never wrap anything derived from a request in `trusted()`.
Defence layers for operator injection, outermost first: `rejectOperatorKeys` -> Zod `.strict()` schemas with string types (`routes/auth.ts`) -> `sanitizeFilter`.

## Tokens and cookies
- Access token: HS256 JWT, claims `sub` (user id) and `role`, lifetime `ACCESS_TOKEN_MINUTES` (15). `verifyAccessToken` pins `algorithms: ["HS256"]` (blocks `alg: none`), and also rejects unknown role values. It does not hit the database, so a disabled user keeps a working access token until it expires (at most 15 min); refresh and `/me` re-check `active`.
- Refresh token: 32 random bytes, base64url. Stored as `HMAC-SHA256(token, JWT_REFRESH_PEPPER)`. HMAC rather than bcrypt because the token is already high-entropy; a fast hash is correct and cheap.
- Cookies (`lib/cookies.ts`): `HttpOnly`, `SameSite=Strict`, `Secure` in production. `nb_access` path `/`; `nb_refresh` path `/api/auth` so it is not sent with ordinary API calls. Changing the cookie path or name requires clearing with identical options (`clearAuthCookies`), otherwise the browser keeps the old cookie.
- Rotation (`authService.refresh`): an atomic `findOneAndUpdate({tokenHash, revoked:false, expiresAt>now}, {revoked:true})` makes concurrent refreshes with the same token safe (one wins). If it matches nothing but the hash exists and is `revoked`, that is replay: every refresh token of that user is revoked. Consequence: a client that fires two refreshes at once will log itself out; the client in M4 must serialise refreshes.
- `changePassword` revokes all of the user's refresh tokens except the one in the request cookie (`tokenHash: trusted({$ne: keep})`). If the cookie is missing, all are revoked.

## Login (authService.login)
- Unknown email, wrong password and disabled account return the same 401 body (`INVALID_CREDENTIALS`).
- When the email is unknown, the password is still compared against a lazily created dummy hash (`dummyHash`), so timing does not reveal which emails exist.
- Throttling lives in the route (`routes/auth.ts`), key `ip|email`: `check` before the attempt (429 plus `Retry-After` once 5 failures are used), `fail` on a 401 only, `reset` on success. A successful login after 4 failures clears the counter.

## Performance and limits
- bcrypt cost `BCRYPT_COST` (default 12) with `bcryptjs` (pure JavaScript, no native build). Roughly 250-400 ms of single-threaded CPU per hash and it blocks the event loop in short slices; the login limiter bounds how much an attacker can cost. If login volume grows, switch to native `bcrypt` or move hashing to worker threads. Tests use cost 4.
- Access-token checks are a signature verify (microseconds, no I/O). Database hits: login (1 read, 1-2 writes plus audit), refresh (2-3 reads/writes), `/me` (1 read).
- Rate-limit counters (`rate-limiter-flexible` memory store) are per process: reset on restart, not shared across instances. Memory is bounded by key count; keys expire with their window.
- Mongo connection: `serverSelectionTimeoutMS: 5000` so a dead database fails requests in 5 s, not 30 s. `/api/health` pings the database and returns 503 when it is down; monitor this endpoint.
- Index list to watch: `users.email`, `refreshtokens.tokenHash`, `refreshtokens.userId`, TTL on `refreshtokens.expiresAt` and `auditlogs.at`, collated `categories.name`.

## Seed script (scripts/seed-admin.ts)
`npm run seed` (root) runs `tsx --env-file=.env scripts/seed-admin.ts`. `seed()` is exported and idempotent: creates the first admin only if no user with role `admin` exists (so changing `SEED_ADMIN_EMAIL` later does not add a second admin), plus the categories General, Exams, Events, Placements. Requires `SEED_ADMIN_PASSWORD` of at least 10 characters. It imports server models by relative path and is not covered by `tsc` (not in any tsconfig `include`), only by tsx at run time and by `server/tests/seed.test.ts`.
`npm run dev -w server` now uses `tsx watch --env-file=../.env`, so `.env` must exist at the repo root.

## Tests (server/tests)
- `globalSetup.ts` starts one `mongodb-memory-server` for the whole run and exposes `TEST_MONGO_URI`; every file connects to its own random database name (`helpers.ts`). The first run downloads a MongoDB 7.0.x binary of about 600 MB into the user cache; later runs reuse it. `hookTimeout` is 120 s for that reason. CI will need the cache or the download time.
- Supertest agents keep cookies; the refresh cookie has path `/api/auth`, so tests that need exactly one cookie use plain `request(app)` with an explicit `Cookie` header.
- `LOG_LEVEL=error npm test -w server` re-enables pino output (silent by default in tests) to see the real cause behind a 500.
- Replaying a revoked refresh token deliberately revokes the user's other sessions, so tests must check the still-valid session before the replay (see the password-change test).

## Gotchas and known gaps
- Origin strictness: a missing `Origin` on POST is rejected. Non-browser clients (curl, health scripts) must set it.
- `mustChangePassword` is not enforced server-side; a user with a temporary password can use the API. Decide in M4/M5.
- Express 4 does not forward rejected promises from async handlers; every async handler must be wrapped with `wrap()` (`lib/asyncHandler.ts`) or errors become unhandled rejections. Upgrading to Express 5 removes the need but changes `req.query` to read-only, which would break `validate(..., "query")`.
- Real MongoDB with authentication (the compose file and `mongo-init.js` users) is still unverified because Docker is not installed on the development machine; all tests ran against the in-memory server without authentication.
- `ACCESS_TOKEN_MINUTES`, `REFRESH_TOKEN_DAYS`, `BCRYPT_COST` are bounded by the env schema (1-60, 1-30, 4-15).
