# Digital Notice Board: Architecture

## 1. System overview

A React single-page app (built with Vite, styled with Tailwind) talks to one Node.js Express server over REST and Socket.IO. The server stores everything in one MongoDB database; images live in the same database (GridFS). In production the Express server also serves the built frontend, so the browser sees one origin, one port and one container. A GitHub Actions pipeline builds the Docker image, which runs on Render against MongoDB Atlas.

```text
flowchart LR
  V[Viewer browser: React + Tailwind] -->|HTTPS REST + WebSocket| X[Express server in Docker]
  C[Committee / Admin browser] -->|HTTPS REST + WebSocket, HttpOnly JWT cookies| X
  X --> MW[Middleware: rate limit, origin, JWT, role]
  MW --> RT[Routes: validate, authorise]
  RT --> SV[Services]
  SV --> DB[(MongoDB noticeboard)]
  DB --- GF[(GridFS bucket images)]
  SV --> IO[Socket.IO rooms]
  IO --> V
  IO --> C
  GH[GitHub Actions] -->|build, test, image| REG[Container registry]
  REG --> R[Render] --> X
```

## 2. Tech stack

| Layer | Choice | Why | Rejected |
|-------|--------|-----|----------|
| Database | MongoDB 7 (owner's decision) | Notices are self-contained documents; GridFS stores images. | SQL databases: owner chose MongoDB. |
| ODM | Mongoose | Schemas, validation, `sanitizeFilter` and `strictQuery` guards. | Raw driver: more hand-written validation. |
| Backend | Node 20 + Express + TypeScript | Plain REST API; Socket.IO attaches to the same HTTP server; matches the checklist. | Next.js route handlers: cannot host a long-running Socket.IO server cleanly. NestJS: heavier than needed. |
| Frontend | React 18 + Vite + TypeScript | The checklist asks for React; Vite builds fast. | Next.js: server rendering is not needed; extra complexity. |
| Styling | Tailwind CSS | Checklist item; utility classes keep the design consistent and responsive. | CSS Modules/Bootstrap: not on the checklist. |
| Routing | React Router 6 | Standard SPA routing with lazy-loaded areas. | Hand-rolled routing. |
| State | Zustand | Three small stores; far less code than Redux. | Redux Toolkit: more boilerplate; Context alone: re-render problems with live updates. |
| Real-time | Socket.IO 4 | Checklist item; rooms, auto-reconnect, fallback transport. | Raw WebSocket: no rooms or reconnect logic; polling: not real time. |
| Auth | JWT via `jsonwebtoken` (owner's decision) | Signed short-lived access tokens. | Server sessions: owner chose JWT. |
| Password hash | bcrypt (cost 12) | Standard, slow by design. | Plain SHA: too fast to brute-force. |
| Validation | Zod (shared by client and server) | One schema per input; rejects unknown keys. | Joi/hand-written checks. |
| Upload parsing | multer (memory, size-limited) + `file-type` | Streams to GridFS; detects the real type from bytes. | Trusting file extension or `Content-Type`: spoofable. |
| Security headers | helmet | One line for CSP, nosniff, frame protection, HSTS. | Setting headers by hand. |
| Rate limiting | `rate-limiter-flexible` (memory) | Works for REST and sockets. | Redis: unneeded extra service for one instance. |
| Logging | pino | Structured JSON logs. | console.log. |
| Tests | Vitest, Supertest, `mongodb-memory-server`, `socket.io-client`, React Testing Library, Playwright | Fast unit/integration, real socket tests, one browser flow. | Jest: slower TypeScript/ESM setup. |
| Containers | Docker multi-stage image + Docker Compose | Checklist item; the same image runs locally and in production. | Running Node directly on the host. |
| CI/CD | GitHub Actions | Free, lives next to the code. | Jenkins: needs its own server. |
| Hosting | Render (Docker) + MongoDB Atlas | Free tiers, supports WebSockets, TLS included. | AWS/Kubernetes: too heavy for a college project. |

## 3. Concepts used and why

- **Layered structure** (route, service, model): routes parse and authorise; services hold the rules and emit events; models touch the database. Keeps logic testable.
- **Role-based access control (RBAC):** roles `committee` and `admin` decide which routes and actions are allowed. Anonymous is "no token".
- **Object-level authorisation:** a committee member may only change notices where `authorId` equals their user id. Checked in the service on every edit/delete.
- **Password hashing:** bcrypt, so a database leak does not reveal passwords.
- **JWT strategy:** short access token (15 min) plus long refresh token (7 days). The access token is stateless (cheap to check). The refresh token is stored hashed so it can be revoked and rotated. Both are `HttpOnly`, `Secure` (production), `SameSite=Strict` cookies, so page scripts cannot read them.
- **CSRF protection:** `SameSite=Strict` plus an `Origin` header check on non-GET requests.
- **Input validation:** Zod schemas on every body, query, param and socket payload. Strings only where strings are expected, so `{"$ne": null}` can never arrive as an object.
- **NoSQL (operator) injection defence:** (1) schema validation rejects objects where strings belong, (2) a sanitiser rejects keys starting with `$` or containing `.`, (3) Mongoose `sanitizeFilter: true` and `strictQuery: true`, (4) search text goes only into `$text: { $search: <string> }`, never into an object built from user input. No query is built by string concatenation and `$where` is never used.
- **XSS defence:** notice bodies are plain text, rendered by React (auto-escaped); strict CSP blocks inline scripts.
- **Safe uploads:** size cap, content-based allow-list, random server-generated ids (never the user's filename), `nosniff`.
- **Original-quality images:** the upload buffer is written to GridFS unchanged and streamed back unchanged. No image library touches the bytes.
- **Client route guard:** a React Router wrapper reads the session store and redirects. This is convenience only; the API is the real gate.
- **Client state (Zustand):** `sessionStore` (user, loading), `noticesStore` (items, filters, page, total, `applyEvent()`), `uiStore` (toasts, connection status). Filters are mirrored in the URL.
- **Socket.IO rooms:** `public` (everyone), `user:<id>` (author's own drafts), `admin` (all). Events are emitted only after the database write succeeds.
- **Socket authentication:** the handshake reads the access cookie; a valid token adds the private rooms, none/invalid keeps the socket public-only. A timer disconnects the socket at token expiry so the client reconnects with a fresh token.
- **Rate limiting:** limits brute force on login, abuse of writes and public reads, and socket connection floods.
- **Secure headers and CORS:** helmet headers; no CORS in production (same origin); in development only `http://localhost:5173` is allowed.
- **Pagination:** `page` and `limit` (max 50) with `skip/limit`, sorted on an indexed field.
- **Indexing:** indexes support the board listing, search and uniqueness.
- **TTL and expiry:** refresh tokens and audit logs delete themselves; expired notices are hidden by query and removed by a cleanup script.
- **Audit logging:** an append-only collection of who did what.
- **Error handling:** one error format, no stack traces to clients, generic login errors.
- **Containerisation:** a multi-stage Docker build produces a small non-root image; compose adds MongoDB with authentication.
- **Pipeline (CI/CD):** every push to `main` runs lint, type check, tests and builds the image; passing builds publish the image for Render.
- **Health check:** `GET /api/health` pings the database; Docker and Render use it to decide if the app is alive.

## 4. Project structure

```text
digital_notice_board/
  PRD.md, architecture.md, README.md
  .env.example                placeholders only
  .gitignore, .dockerignore
  Dockerfile                  multi-stage: build client, build server, slim runtime
  docker-compose.yml          app + MongoDB with auth and health checks
  .github/workflows/ci.yml    lint, typecheck, test, build image, push on main
  scripts/
    mongo-init.js             creates database users (see section 5)
    seed-admin.ts             first admin and default categories from env
    cleanup.ts                removes notices expired > 1 year, orphan images
  shared/
    schemas.ts                Zod schemas and types used by client and server
  server/
    src/
      index.ts                creates HTTP server, Express app, Socket.IO
      app.ts                  middleware order, route mounting, static files
      config/env.ts           reads and checks env variables
      db.ts                   Mongoose connection (sanitizeFilter on)
      middleware/             rateLimit, origin, auth, requireRole, errorHandler, validate
      routes/                 auth, notices, images, categories, users, audit, health
      services/               authService, noticeService, imageService, userService, categoryService, auditService
      models/                 User, RefreshToken, Category, Notice, AuditLog
      realtime/               socket.ts (auth, rooms), events.ts (emit helpers)
      lib/                    jwt, password, sanitize, errors, logger
    tests/                    unit and integration (REST and socket)
  client/
    src/
      main.tsx, App.tsx       entry and router
      pages/                  Board, NoticeDetail, Login, committee/*, admin/*, Forbidden
      components/             NoticeCard, NoticeForm, Filters, Pagination, Toast, RouteGuard
      store/                  sessionStore, noticesStore, uiStore
      lib/                    api.ts (fetch + silent refresh), socket.ts, format.ts
      styles/                 tailwind entry
    tailwind.config.js
    tests/                    component tests
  e2e/                        Playwright specs
```

## 5. Database design

Database `noticeboard`. Mongoose is configured with `strictQuery: true` and `sanitizeFilter: true`.

### Collection `users`
| Field | Type | Rules |
|-------|------|-------|
| `_id` | ObjectId | |
| `name` | string | required, 1-80 |
| `email` | string | required, unique index, lowercased |
| `passwordHash` | string | required, never returned |
| `role` | `"committee"` or `"admin"` | required |
| `active` | boolean | required, default true |
| `mustChangePassword` | boolean | default true for new users |
| `createdAt`, `updatedAt` | Date | automatic |

### Collection `refreshTokens`
| Field | Type | Rules |
|-------|------|-------|
| `userId` | ObjectId ref users | required, indexed |
| `tokenHash` | string | required, unique (SHA-256 of the token plus pepper) |
| `family` | string | groups rotated tokens for reuse detection |
| `revoked` | boolean | default false |
| `expiresAt` | Date | TTL index, expireAfterSeconds 0 |

### Collection `categories`
| Field | Type | Rules |
|-------|------|-------|
| `name` | string | required, 1-40, unique with case-insensitive collation |

### Collection `notices`
| Field | Type | Rules |
|-------|------|-------|
| `title` | string | required, 1-120 |
| `body` | string | required, 1-5000, plain text |
| `categoryId` | ObjectId ref categories | required |
| `authorId` | ObjectId ref users | required, used for ownership checks |
| `status` | `"draft"`, `"published"`, `"archived"` | required |
| `pinned` | boolean | default false |
| `images` | array (max 5) of `{ fileId: ObjectId, alt: string(1-120) }` | embedded: images belong to exactly one notice |
| `publishedAt` | Date | set on first publish |
| `expiresAt` | Date or null | optional |
| `createdAt`, `updatedAt` | Date | automatic |

Embedding vs referencing: images are embedded as references to GridFS files (the bytes are large so they live in GridFS, while the small `alt` text stays with the notice). Author and category are referenced because they are shared and change independently.

Indexes:
- `{ status: 1, pinned: -1, publishedAt: -1 }` for the board.
- `{ categoryId: 1, publishedAt: -1 }` for category filtering.
- `{ authorId: 1, createdAt: -1 }` for "my notices".
- Text index on `title` (weight 3) and `body` for search.

Public visibility rule (one shared query builder used by all public endpoints and by the socket emitter): `status = "published"` AND (`expiresAt` is null OR `expiresAt` > now).

### GridFS bucket `images`
`fs.files` / `fs.chunks` with `metadata: { noticeId, uploaderId, contentType, sha256 }`. Files not referenced by a notice after 24 h are deleted by the cleanup script.

### Collection `auditLogs`
| Field | Type | Rules |
|-------|------|-------|
| `actorId` | ObjectId or null | null for failed logins |
| `action` | string | e.g. `login.success`, `notice.delete` |
| `targetType`, `targetId` | string, ObjectId | |
| `ip` | string | |
| `at` | Date | TTL index 365 days |

### Database users and roles

Enable authentication (`--auth` or `security.authorization: enabled`), bind to localhost or a private network, and use TLS in production (Atlas does this by default). Never use the administrator account in the app.

```js
// run in mongosh as the administrator (setup only)
use admin
db.createUser({ user: "nb_admin", pwd: "CHANGE_ME_ADMIN",
  roles: [{ role: "userAdminAnyDatabase", db: "admin" }, { role: "backup", db: "admin" }] })

use noticeboard
db.createUser({ user: "noticeboard_app", pwd: "CHANGE_ME_APP",
  roles: [{ role: "readWrite", db: "noticeboard" }] })

db.createUser({ user: "noticeboard_ro", pwd: "CHANGE_ME_RO",
  roles: [{ role: "read", db: "noticeboard" }] })
```

Connection string template (`.env.example`):
`MONGODB_URI=mongodb://noticeboard_app:CHANGE_ME_APP@mongo:27017/noticeboard?authSource=noticeboard`
(use `localhost` instead of `mongo` when running the server outside Docker; Atlas uses a `mongodb+srv://` string with the same app user).

### Seed data
`scripts/seed-admin.ts` reads `SEED_ADMIN_EMAIL`, `SEED_ADMIN_NAME`, `SEED_ADMIN_PASSWORD` from the environment, creates the first admin (with `mustChangePassword: true`) only if none exists, and adds a few default categories. Nothing is hard-coded.

## 6. Access control design

**Sign-in:** `POST /api/auth/login` verifies email and bcrypt hash, rejects inactive users, creates an access JWT (`sub`, `role`, 15 min) and a random refresh token (stored as hash, 7 days), and sets both as cookies.

**Session bootstrap:** the client calls `GET /api/auth/me` on load; 401 means "no session".

**Refresh:** `POST /api/auth/refresh` checks the refresh token hash, marks it used and issues a new pair in the same family. A used token presented again revokes the whole family. The client API wrapper calls refresh once on a 401 and retries the request.

**Revocation:** logout, password change, disabling a user and password reset revoke refresh tokens. Access tokens expire within 15 minutes; `active` is re-checked on refresh and on admin actions. Sockets are disconnected at access token expiry.

**Roles:** `committee`, `admin`. Anonymous has no token.

**Permission table:** identical to PRD Section 5.

**Request order (every REST request):**
1. helmet headers.
2. Rate limiter.
3. Origin check (non-GET).
4. Body parsing with a size limit.
5. Auth middleware (JWT cookie, optional on public routes).
6. `requireRole()` on protected routes.
7. Zod validation of params, query and body.
8. Service: object-level check (`authorId === user.id` unless admin).
9. Query with sanitised filters.
10. Audit entry for writes, socket emit after a successful write.

**Socket request order:** origin check, connection rate limit, cookie JWT verify (optional), join rooms, payload validation on any client-sent message (the server accepts none beyond the connection itself, so clients cannot send data).

**Client guards:** `RouteGuard` redirects to `/login` when the session store has no user and shows `Forbidden` for the wrong role. Admin and committee page bundles are lazy-loaded.

**Public routes:** `/`, `/notices/:id`, `/login` (pages); `GET /api/notices`, `GET /api/notices/:id`, `GET /api/images/:id` (only if its notice is public), `GET /api/categories`, `GET /api/health`, `POST /api/auth/login`, `POST /api/auth/refresh`, `GET /api/auth/me` (returns 401 without a session); socket connection (public room only).

## 7. API design

Common error format: `{ "error": { "code": "FORBIDDEN", "message": "...", "fields": { "title": "Required" } } }` with status 400, 401, 403, 404, 409, 413, 429 or 500. Lists return `{ "items": [], "page": 1, "limit": 20, "total": 0 }`. Query params: `page` (default 1), `limit` (default 20, max 50), `q`, `category`, `from`, `to`, `status` (staff only).

| Method | Path | Who | Purpose | Request | Success |
|--------|------|-----|---------|---------|---------|
| POST | `/api/auth/login` | anyone | FR-01 | `{ email, password }` | 200 `{ user }` + cookies |
| POST | `/api/auth/logout` | signed in | FR-02 | none | 204 |
| POST | `/api/auth/refresh` | refresh cookie | FR-03 | none | 204 + new cookies |
| GET | `/api/auth/me` | signed in | FR-24 | none | 200 `{ user }` or 401 |
| POST | `/api/auth/password` | signed in | FR-04 | `{ current, next }` | 204 |
| GET | `/api/notices` | anyone | FR-15, FR-16 | query params | 200 list (public only) |
| GET | `/api/notices/:id` | anyone | FR-17 | none | 200 notice |
| GET | `/api/me/notices` | committee, admin | FR-13 | `status`, paging | 200 list (own; admin: all) |
| POST | `/api/notices` | committee, admin | FR-09 | `{ title, body, categoryId, status, expiresAt?, images[] }` | 201 notice |
| PATCH | `/api/notices/:id` | author, admin | FR-10 | partial fields | 200 notice |
| DELETE | `/api/notices/:id` | author, admin | FR-11 | `?mode=archive` or delete | 204 |
| POST | `/api/notices/:id/pin` | admin | FR-12 | `{ pinned }` | 200 notice |
| POST | `/api/images` | committee, admin | FR-18 upload | multipart `file`, `alt` | 201 `{ fileId, alt }` |
| GET | `/api/images/:id` | anyone for public notice; author/admin otherwise | FR-18 | none | 200 original bytes |
| DELETE | `/api/images/:id` | author, admin | FR-11 | none | 204 |
| GET | `/api/categories` | anyone | FR-07 read | none | 200 list |
| POST | `/api/categories` | admin | FR-07 | `{ name }` | 201 |
| PATCH | `/api/categories/:id` | admin | FR-07 | `{ name }` | 200 |
| DELETE | `/api/categories/:id` | admin | FR-07 | none | 204 or 409 |
| GET | `/api/users` | admin | FR-05, FR-06 | paging | 200 list (no hashes) |
| POST | `/api/users` | admin | FR-05 | `{ name, email, role, password }` | 201 |
| PATCH | `/api/users/:id` | admin | FR-06 | `{ active?, role?, password? }` | 200 |
| GET | `/api/audit` | admin | FR-08 | paging | 200 list |
| GET | `/api/health` | anyone | Docker and host health | none | 200 `{ status: "ok" }` or 503 |

### Socket.IO events (server to client only)

| Event | Room | Payload | When |
|-------|------|---------|------|
| `notice:created` | `public` | card summary (id, title, category, publishedAt, pinned, firstImageId, expiresAt) | a notice becomes public |
| `notice:updated` | `public` | same summary | a public notice is edited or pinned/unpinned |
| `notice:removed` | `public` | `{ id }` | a public notice is archived, deleted or unpublished |
| `notice:changed` | `user:<authorId>` and `admin` | summary plus `status` | any change, including drafts and archived |

Rules: payloads never contain hashes or private fields; clients cannot emit events (the server ignores incoming events). FR-14 (auto-expiry) uses the shared visibility query on the server and a 30 s client timer comparing `expiresAt`. FR-19 to FR-21 are implemented by middleware, the validation layer and the rate limiter rather than by endpoints.

## 8. Frontend architecture

| Route | Access | Content |
|-------|--------|---------|
| `/` | public | Board: search box, category and date filters, paged cards, pinned first, live updates |
| `/notices/:id` | public | Full notice and images |
| `/login` | public | Login form |
| `/committee` | committee, admin | My notices with status filter |
| `/committee/new`, `/committee/:id/edit` | committee, admin (own for committee) | Notice form with image upload and alt text |
| `/admin/users` | admin | Create, disable, reset users |
| `/admin/categories` | admin | Category CRUD |
| `/admin/audit` | admin | Audit log |
| `/forbidden`, `*` | public | 403 and 404 pages |

- **Tailwind:** mobile-first utility classes; a small set of reusable components (card, button, input) so styles stay consistent; breakpoints at 640 / 1024 px; focus rings never removed.
- **Route guards:** `RouteGuard` wraps `/committee/*` and `/admin/*`; it waits for `GET /api/auth/me`, then redirects or renders. API errors 401/403 also clear the session or show the forbidden page.
- **State:** `sessionStore`, `noticesStore`, `uiStore` (Section 3). `noticesStore.applyEvent()` inserts, replaces or removes a card according to the socket event and the active filters (a new notice that does not match the current filter is ignored).
- **Socket module:** connects after the session check, reconnects automatically, and on reconnect refetches the current page to cover missed events; shows a small "live" indicator (`aria-live`).
- **Forms:** same Zod schemas from `shared/` on client (fast feedback) and server (authoritative).
- **Loading and error states:** every list and form has loading, empty and error views.
- **Accessibility:** semantic HTML, labelled inputs, required `alt` text for images, keyboard focus order, 4.5:1 contrast, live region for new notices.
- **Image display:** the original file is shown with `max-width: 100%`; no server-side scaling.

## 9. Security architecture

| Threat | Risk to this app | Control |
|--------|------------------|---------|
| NoSQL/operator injection | `{"$ne":null}` in login or search bypasses checks | Zod type checks, `$`/`.` key rejection, `sanitizeFilter`, no `$where`, search text only as a string |
| SQL injection | Owner's concern; no SQL exists | Not applicable; text in notices is stored as data only |
| Broken access control | Viewer opens `/admin` or edits another's notice | Route guard (UX) + middleware role check + ownership check in services + tests per role |
| URL guessing | Direct URL or API call | 401/403 on API; guard redirect on pages; drafts return 404 publicly |
| Socket data leak | Anonymous socket receives drafts | Private data only to `user:<id>` and `admin` rooms after JWT verify; tests with anonymous clients |
| XSS | Script in a notice body | Plain text, React escaping, strict CSP |
| CSRF | Cross-site post as a logged-in member | `SameSite=Strict`, `Origin` check |
| Cross-site WebSocket hijack | Another site opens a socket with the user's cookie | Socket origin allow-list |
| Brute force | Password guessing | 5 tries / 15 min per IP+email, bcrypt cost 12 |
| Token theft | JWT read by scripts | HttpOnly cookies, short expiry, refresh rotation and reuse detection |
| Data exposure | Hash or draft leaks | Explicit response shapes, never return `passwordHash` or token hashes |
| Insecure upload | Disguised executable, huge file | Content-based type check, 10 MB limit, random ids, `nosniff` |
| Privacy leak via EXIF | Original bytes include GPS data | Accepted trade-off (original quality is a decision); upload form warning |
| Leaked secrets | Credentials in git or in the image | `.env` ignored, `.dockerignore`, `.env.example` placeholders, env check at startup, host-side secrets |
| DB compromise | App with admin rights | Least-privilege `noticeboard_app` user, auth enabled, TLS on Atlas |
| Vulnerable dependency or image | Known CVEs | `npm audit` in CI, small `node:20-alpine` base, non-root user |
| Denial of service | Request or connection flooding | Rate limits, body and upload size limits, socket connection limit |

## 10. Configuration

```text
NODE_ENV=development
PORT=4000                                    # server port (3000 in Docker)
APP_ORIGIN=http://localhost:5173             # allowed Origin for writes and sockets
MONGODB_URI=mongodb://noticeboard_app:CHANGE_ME_APP@localhost:27017/noticeboard?authSource=noticeboard
JWT_ACCESS_SECRET=CHANGE_ME_32_BYTES_MIN     # signs access tokens
JWT_REFRESH_PEPPER=CHANGE_ME_32_BYTES_MIN    # mixed into refresh token hashes
ACCESS_TOKEN_MINUTES=15
REFRESH_TOKEN_DAYS=7
BCRYPT_COST=12
MAX_IMAGE_MB=10
MAX_IMAGES_PER_NOTICE=5
SEED_ADMIN_NAME=CHANGE_ME
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=CHANGE_ME_STRONG
MONGO_ADMIN_PASSWORD=CHANGE_ME_ADMIN         # used only by docker-compose
MONGO_APP_PASSWORD=CHANGE_ME_APP
VITE_API_BASE=/api                           # client API path (proxied in dev)
```

## 11. Testing strategy

- **Unit:** Zod schemas (including `$ne`, `$where`, dotted keys), JWT sign/verify, bcrypt helpers, visibility query builder, image type check, `noticesStore.applyEvent()`.
- **Integration (in-memory MongoDB, Supertest):** every endpoint in Section 7; refresh rotation and reuse detection; SHA-256 of downloaded image equals upload; expiry hides a notice; search with injection strings returns normal results; `/api/health` returns 503 when the database is down.
- **Socket tests (`socket.io-client`):** an anonymous client gets `notice:created` within 2 s of a publish; an anonymous client never gets a draft event; the author gets `notice:changed` for their draft and another committee member does not; admin gets all; a socket with an expired token is disconnected; a disallowed Origin is refused.
- **Access-control tests (explicit):** for each protected route and action, call as anonymous, committee A, committee B, and admin, and assert the PRD Section 5 result. Specific cases: committee B edits/deletes committee A's notice (403), committee B reads A's draft or draft image (404/403), committee opens `/admin` (403 page), anonymous opens `/committee` (redirect), disabled user refresh (401), committee pins (403), committee creates user (403).
- **Component tests:** `RouteGuard` redirect and forbidden cases, `NoticeForm` validation messages, board renders a live-inserted card.
- **End to end (Playwright):** viewer reads and searches; committee logs in, posts with an image, and a second open viewer tab shows it without refresh; viewer typing `/admin` is sent to `/login`.
- **Pipeline:** the CI workflow runs lint, type check, all tests and the Docker build; a red step blocks publishing the image.

## 12. Deployment and operations

- **Local development:** `docker compose up -d mongo` (MongoDB with authentication and `scripts/mongo-init.js`), `npm run seed`, then `npm run dev` (server on 4000, Vite on 5173 proxying `/api` and `/socket.io`).
- **Local containers:** `docker compose up --build` runs the app image and MongoDB; the app is at `http://localhost:3000`. The compose file defines health checks (`/api/health` for the app, a ping for MongoDB), a named volume for MongoDB data and reads passwords from `.env`.
- **Dockerfile:** stage 1 builds the client (`vite build`), stage 2 builds the server (TypeScript to JS), stage 3 is `node:20-alpine` with only production dependencies, the compiled server, the built client, `USER node`, `EXPOSE 3000`, and a `HEALTHCHECK`.
- **CI (`.github/workflows/ci.yml`):** on push and pull request: checkout, Node 20, `npm ci`, lint, type check, tests (MongoDB memory server), client and server build, `docker build`. On `main` only: log in to the container registry and push the image tagged with the commit SHA and `latest`.
- **Deploy:** create a MongoDB Atlas cluster and an `noticeboard_app` user with `readWrite` on `noticeboard`, allow the host's IPs; create a Render web service from the image; set all environment variables there (`MONGODB_URI` with the Atlas string, `APP_ORIGIN` with the public URL, secrets created by running `openssl rand -base64 32`); set the health check path to `/api/health`; run the seed script once. Render provides HTTPS and WebSocket support.
- **Logging:** structured JSON to stdout, never containing passwords, tokens or full request bodies.
- **Backups:** nightly `mongodump --uri <backup user> --gzip --out <dir>` (Atlas snapshots if used), keep 14 days.
- **Restore:** `mongorestore --gzip --drop <dir>` into an empty database; verify by loading the board.
- **Cleanup:** monthly `npm run cleanup`.

## 13. Decision log

| Decision | Reason | Trade-off |
|----------|--------|-----------|
| React (Vite) + Express instead of Next.js | Socket.IO needs a long-running server; maps directly to the faculty checklist | Two packages (client and server) instead of one app |
| Express serves the built frontend in production | One origin: simple cookies, no CORS, one container | Frontend and backend deploy together |
| JWT in HttpOnly cookies, short access + rotating refresh | Scripts cannot steal it; revocable | More code than a single long token |
| Zustand for state | Small, fast to learn, enough for three stores | Less tooling than Redux DevTools ecosystem |
| Socket.IO rooms with server-only emits | Easy live updates; clients cannot inject data | Extra rooms to test; one instance only without Redis |
| Images in GridFS, no processing | One store, one backup, original bytes | Slower than a CDN at scale; EXIF kept |
| Admin-created accounts only | No one can self-grant posting rights | Admin must reset passwords |
| Plain-text notice bodies | Removes most XSS risk | No formatting |
| Mongoose + Zod double defence | Operator injection stopped at input and at query | Slightly more code |
| Docker + GitHub Actions + Render/Atlas | Meets Docker and DevOps checklist items with free tiers | Free tiers sleep when idle |

## 14. Build order

| Milestone | Creates |
|-----------|---------|
| M1 | Repo, hook, `.gitignore`, `client/` and `server/` scaffolds, `docker-compose.yml` (MongoDB), `.env.example`, `mongo-init.js` |
| M2 | `db.ts`, models (users, refreshTokens, categories, auditLogs), `jwt`, `password`, auth/rateLimit/role/validate middleware, `/api/auth/*`, seed script (FR-01 to FR-04, FR-21, FR-20 helpers) |
| M3 | `Notice` model, GridFS `imageService`, `/api/notices*`, `/api/images`, `/api/me/notices`, `/api/categories` read, audit writes (FR-09 to FR-11, FR-13 to FR-18, FR-20) |
| M4 | Router, Tailwind layout, `api.ts`, `sessionStore`, `noticesStore`, board, detail and login pages, `RouteGuard` (FR-15 to FR-17, FR-19, FR-24) |
| M5 | Committee pages, `/api/users`, category CRUD, pin endpoint, `/api/audit`, admin pages (FR-05 to FR-08, FR-12) |
| M6 | `realtime/socket.ts`, `realtime/events.ts`, emit hooks in `noticeService`, client `socket.ts`, store event handling, expiry timer (FR-22, FR-23, FR-14 client) |
| M7 | `Dockerfile`, `.dockerignore`, full compose stack, `.github/workflows/ci.yml`, deployment guide |
| M8 | helmet/CSP, cleanup script, full access-control and socket test matrix, Playwright flow, README with demo script |

Requirement coverage: FR-01 to FR-04 and FR-24 use `users`, `refreshTokens`, `auditLogs`; FR-05, FR-06 use `users`, `refreshTokens`, `auditLogs`; FR-07 uses `categories`, `notices`; FR-08 uses `auditLogs`; FR-09 to FR-18 use `notices`, GridFS, `categories`; FR-19 to FR-21 are cross-cutting (middleware, guards, validation, limiter); FR-22 and FR-23 use `notices` and the Socket.IO rooms. Every collection is used by at least one requirement.

Faculty checklist mapping: Tailwind (M4, M5), React and state (M4 to M6), REST API (M2, M3, M5), Mongoose (M2, M3), validation (M2, M3), authentication and authorisation (M2, M4), Socket.IO (M6), Docker (M7), DevOps and deployment (M7, M8).
