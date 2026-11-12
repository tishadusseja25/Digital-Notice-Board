# Digital Notice Board: Architecture

## 1. System overview

A React single-page app (built with Vite, styled with Tailwind) talks to one Node.js Express server over REST and Socket.IO. The server stores everything in one MongoDB database; images live in the same database (GridFS). In production the Express server also serves the built frontend, so the browser sees one origin, one port and one container. A GitHub Actions pipeline builds the Docker image, which runs on Render against MongoDB Atlas. The diagrams below follow the code as it is built; section numbers elsewhere in this file and in `PRD.md` are unchanged.

### 1.1 Runtime view

```mermaid
flowchart TD
  subgraph Browser["Browser: React 18, Tailwind, React Router"]
    PAGES["Pages: board, notice, sign in, committee, admin"]
    STORES["Zustand stores: session, notices, live status"]
    API["lib/api.ts: fetch with ONE shared silent refresh"]
    SOCK["lib/socket.ts: Socket.IO client"]
    PAGES --> STORES
    STORES --> API
    PAGES --> SOCK
  end
  subgraph App["One Node 20 process: Express 4 and Socket.IO on one port"]
    STATIC["Built website: /assets cached one year, index.html never cached"]
    MW["Middleware pipeline, see 1.2"]
    ROUTES["Routes: auth, notices, images, me, categories, users, audit, health"]
    SVC["Services: rules, object-level checks, audit, announce"]
    RT["Realtime: rooms public, user id, admin"]
    MW --> ROUTES --> SVC
    SVC --> RT
  end
  DB[("MongoDB noticeboard: users, refreshTokens, categories, notices, auditLogs")]
  GFS[("GridFS bucket images: images.files and images.chunks")]
  Browser -->|"GET page and assets"| STATIC
  API -->|"REST /api with HttpOnly cookies"| MW
  SOCK <-->|"WebSocket /socket.io, cookie read at connect"| RT
  SVC --> DB
  SVC --> GFS
```

In development the same code runs as two processes: the Express server on port 4000 and the Vite dev server on port 5173, which forwards `/api` and `/socket.io` to the server so cookies stay same-origin.

### 1.2 What happens to every HTTP request

Order is exactly the order of `server/src/app.ts`.

```mermaid
flowchart TD
  R["Incoming HTTP request"] --> H["helmet: security headers and content security policy"]
  H --> S{"Production and the path is a file of the built site?"}
  S -->|yes| F["Serve it: /assets cached one year, index.html never cached"]
  S -->|no| L1["Read limiter: GET and HEAD, 120 per minute per IP"]
  L1 --> J["JSON body, 100 KB at most, then cookie parser"]
  J --> O{"Key with a dollar sign or a dot in body, query or params?"}
  O -->|yes| E400["400 VALIDATION"]
  O -->|no| A["authenticate: read the nb_access cookie, set the caller, or stay anonymous"]
  A --> CS{"Not GET, HEAD, OPTIONS: Origin equals APP_ORIGIN?"}
  CS -->|no| E403["403 BAD_ORIGIN"]
  CS -->|yes| L2["Write limiter: 30 per minute per user, per IP when anonymous"]
  L2 --> P{"Path starts with /api?"}
  P -->|"no, GET in production"| IDX["Send index.html so React Router handles the address"]
  P -->|"yes, unknown route"| N404["404 NOT_FOUND as JSON"]
  P -->|"yes, known route"| RR["requireRole: 401 when not signed in, 403 for the wrong role"]
  RR --> V["Zod validation of params, query and body, unknown keys rejected"]
  V --> SV["Service: object-level check author or admin, database write with sanitised filters"]
  SV --> AU["Audit entry, then announce to Socket.IO rooms after the write succeeded"]
  AU --> OK["JSON response"]
```

Every failure leaves through one error handler with one format: `{ "error": { "code", "message", "fields?" } }`. Stack traces are never sent.

### 1.3 Sign-in, silent refresh and sign-out

```mermaid
sequenceDiagram
  participant B as Browser
  participant S as Server
  participant D as MongoDB
  B->>S: GET /api/auth/me on page load
  S-->>B: 401 because there is no cookie
  B->>S: POST /api/auth/refresh as the one retry
  S-->>B: 401 so the visitor is anonymous
  B->>S: POST /api/auth/login with email and password
  S->>D: find user, compare bcrypt hash, check active
  alt wrong email, wrong password or disabled account
    S->>D: audit login.failure
    S-->>B: 401 with one generic message, 5 failures per 15 minutes per IP and email, then 429
  else correct
    S->>D: audit login.success, store the refresh token as an HMAC hash
    S-->>B: 200 user and cookies nb_access 15 minutes, nb_refresh 7 days on path /api/auth
  end
  Note over B,S: later, the access cookie has expired
  B->>S: any API call
  S-->>B: 401
  B->>S: POST /api/auth/refresh, one call shared by every waiting request
  S->>D: mark the presented refresh token used, atomically
  alt token unknown, expired, or already used, or the user is disabled
    S->>D: revoke every refresh token of that user when a used token was replayed
    S-->>B: 401 and the client clears the session, the guard shows sign in
  else valid
    S-->>B: 204 with a new cookie pair
    B->>S: the original request is repeated once
  end
  B->>S: POST /api/auth/logout
  S->>D: revoke this refresh token
  S-->>B: 204 and cookies cleared
```

Changing the password revokes every refresh token except the one making the request. Disabling a user or resetting their password revokes all of that user's tokens at once.

### 1.4 Protecting pages and areas

The screen guard is a convenience. The real gate is section 1.2 on every API call.

```mermaid
flowchart TD
  A["Open /committee, /account or /admin"] --> B{"Session check finished?"}
  B -->|no| C["Show Loading"]
  B -->|yes| D{"Signed in?"}
  D -->|no| E["Redirect to /login and remember the page"]
  D -->|yes| F{"Role allowed for this area?"}
  F -->|no| G["403 page: Forbidden"]
  F -->|yes| H{"Temporary password still set?"}
  H -->|yes, not on /account/password| I["Redirect to /account/password"]
  H -->|no| J["Render the lazy-loaded page"]
  E --> K["After sign in: go back to the saved page, or the area of the role"]
  J --> L["Sign out: go to the board with a message, then end the session"]
```

Areas: `/committee/*` and `/account/password` allow committee and admin, `/admin/*` allows admin only, everything else is public.

### 1.5 Publishing a notice and the live update

```mermaid
sequenceDiagram
  participant V as Viewer browser with the board open
  participant C as Committee browser
  participant S as Server routes and noticeService
  participant D as MongoDB
  participant IO as Socket.IO rooms
  V->>IO: connect, origin check, 20 connections per minute per IP, cookie read
  IO-->>V: joined room public
  C->>IO: connect with the login cookie
  IO-->>C: joined public and user id, an admin also joins admin
  C->>S: POST /api/notices with status published
  S->>S: pipeline 1.2, then check the images belong to the author
  S->>D: save notice, attach images, write audit entry
  S->>IO: announce, only after the write succeeded
  IO-->>V: notice:created with public fields only
  IO-->>C: notice:changed with status and authorId, to the author and admin rooms
  V->>S: GET /api/notices as a silent reload, bursts merged within 300 ms
  S-->>V: the current page including the new notice
  Note over V: the new row slides in with a highlight for 8 seconds
```

Which event goes where is decided by comparing "publicly visible before" with "publicly visible after" (published and not past its expiry):

```mermaid
flowchart TD
  W["A notice was created, edited, archived, deleted or pinned"] --> BA{"Public before?"}
  BA -->|no| NA{"Public now?"}
  BA -->|yes| NB{"Public now?"}
  NA -->|yes| CR["public room: notice:created"]
  NA -->|no| NONE["nothing for the public"]
  NB -->|yes| UP["public room: notice:updated"]
  NB -->|no| RM["public room: notice:removed with only the id"]
  W --> CH["always: notice:changed to the author room and the admin room"]
```

Sockets only listen. The server registers no handler for client messages, so a client cannot send events or join rooms. A socket is disconnected when its access token expires: the client then refreshes quietly and reconnects. An expired notice is not announced by the server: each open board drops it on a 30 second sweep, and the public API already stops returning it.

### 1.6 Images: upload, attach, serve, clean up

```mermaid
flowchart TD
  U["POST /api/images: multipart file and alt text"] --> UR{"Signed in as committee or admin?"}
  UR -->|no| U401["401 or 403 before any byte is read"]
  UR -->|yes| UM["multer in memory, one file, MAX_IMAGE_MB 10"]
  UM --> UT{"Real type from the bytes: JPEG, PNG or WebP?"}
  UT -->|no| U400["400 with a message on the file field"]
  UT -->|yes| UG["Store the exact bytes in GridFS, random name, noticeId empty"]
  UG --> UF["Return fileId and alt"]
  UF --> AT["Notice create or edit lists images: each must exist, belong to the uploader or an admin, be unattached, at most 5 per notice"]
  AT --> AM["Attach: set noticeId on the file"]
  G["GET /api/images/id"] --> GP{"Attached notice publicly visible?"}
  GP -->|yes| GS["Stream the original bytes, public cache one year, immutable, ETag is the SHA-256"]
  GP -->|no| GA{"Caller is the author or an admin? Unattached: the uploader or an admin"}
  GA -->|yes| GV["Stream the bytes, private no-cache"]
  GA -->|no| G404["404"]
  CL["npm run cleanup, run by hand about monthly"] --> CD["Delete images never attached after 24 hours and notices expired over a year, with their images"]
```

### 1.7 Inside the browser

```mermaid
flowchart LR
  URL["Address bar: search, category, dates, page"] --> BOARD["Board page"]
  BOARD -->|"load"| NS["noticesStore: items, total, fresh ids"]
  NS --> AP["lib/api.ts"] -->|"GET /api/notices"| SRV["Server"]
  SRV -->|"another 401"| RF["one shared refresh, then retry"]
  SK["lib/socket.ts, started after the session check and restarted on sign in or out"] -->|"public events and reconnects"| RL["noticesStore.reload, merged within 300 ms"]
  RL --> NS
  SK -->|"private events and reconnects"| MY["My notices reloads"]
  SK -->|"notice:removed for the open notice"| DET["Notice page shows no longer available"]
  SK -->|"disconnect, token expired"| RS["GET /api/auth/me refreshes the login, then reconnect"]
  TM["Every 30 seconds"] --> DE["noticesStore.dropExpired"]
  DE --> NS
  SK --> LV["useLiveStore: Live or Reconnecting in the header"]
  SS["sessionStore: user, status, login, logout"] --> GRD["Route guards and header"]
```

### 1.8 From a commit to a running site

```mermaid
flowchart TD
  DEV["npm run dev: Vite 5173 forwards /api and /socket.io to the server on 4000"] --> GIT["git commit, the commit-msg hook checks the message"]
  GIT --> CI
  subgraph CI["GitHub Actions: .github/workflows/ci.yml"]
    CHK["check: lint, npm audit for high findings, type check, tests, build"]
    E2E["e2e: Playwright and Chromium on the production build, accessibility and CSP scan"]
    IMG["image: docker build on every run, push to ghcr.io only from main"]
    CHK --> E2E
    CHK --> IMG
    E2E --> IMG
  end
  IMG --> REG[("ghcr.io image tagged with the commit and latest")]
  REG --> RND["Render web service, or Render builds the Dockerfile itself"]
  RND --> ATL[("MongoDB Atlas: user noticeboard_app, readWrite on noticeboard")]
  LOC["docker compose up: app image on port 3000 and MongoDB 7 with authentication"] --> VOL[("mongo-data volume")]
```

The image has two stages: one builds the client and the server, the other is a slim `node:20-alpine` runtime with production dependencies only, running as the `node` user with a health check on `/api/health`.

## 2. Tech stack

| Layer | Choice | Why | Rejected |
|-------|--------|-----|----------|
| Database | MongoDB 7 (owner's decision) | Notices are self-contained documents; GridFS stores images. | SQL databases: owner chose MongoDB. |
| ODM | Mongoose | Schemas, validation, `sanitizeFilter` and `strictQuery` guards. | Raw driver: more hand-written validation. |
| Backend | Node 20 + Express + TypeScript | Plain REST API; Socket.IO attaches to the same HTTP server; matches the checklist. | Next.js route handlers: cannot host a long-running Socket.IO server cleanly. NestJS: heavier than needed. |
| Frontend | React 18 + Vite + TypeScript | The checklist asks for React; Vite builds fast. | Next.js: server rendering is not needed; extra complexity. |
| Styling | Tailwind CSS | Checklist item; utility classes keep the design consistent and responsive. | CSS Modules/Bootstrap: not on the checklist. |
| Routing | React Router 6 | Standard SPA routing with lazy-loaded areas. | Hand-rolled routing. |
| State | Zustand | Two small stores (session, notices) plus a live-status store; far less code than Redux. | Redux Toolkit: more boilerplate; Context alone: re-render problems with live updates. |
| Real-time | Socket.IO 4 | Checklist item; rooms, auto-reconnect, fallback transport. | Raw WebSocket: no rooms or reconnect logic; polling: not real time. |
| Auth | JWT via `jsonwebtoken` (owner's decision) | Signed short-lived access tokens. | Server sessions: owner chose JWT. |
| Password hash | bcrypt (cost 12) | Standard, slow by design. | Plain SHA: too fast to brute-force. |
| Validation | Zod on the server; the client uses HTML constraints and shows the server's field messages | One schema per input; rejects unknown keys. The server is the authority. | Joi/hand-written checks; a shared schema package (not needed at this size). |
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
- **JWT strategy:** short access token (15 min) plus long refresh token (7 days). The access token is stateless (cheap to check). The refresh token is stored as an HMAC-SHA256 hash (keyed with `JWT_REFRESH_PEPPER`) so it can be revoked and rotated; a token that is presented twice ends every session of that user. Both are `HttpOnly`, `Secure` (production), `SameSite=Strict` cookies, so page scripts cannot read them.
- **CSRF protection:** `SameSite=Strict` plus an `Origin` header check on non-GET requests.
- **Input validation:** Zod schemas on every body, query and param (the socket accepts no client payloads at all). Strings only where strings are expected, so `{"$ne": null}` can never arrive as an object.
- **NoSQL (operator) injection defence:** (1) schema validation rejects objects where strings belong, (2) a sanitiser rejects keys starting with `$` or containing `.`, (3) Mongoose `sanitizeFilter: true` and `strictQuery: true`, (4) search text goes only into `$text: { $search: <string> }`, never into an object built from user input. No query is built by string concatenation and `$where` is never used.
- **XSS defence:** notice bodies are plain text, rendered by React (auto-escaped); strict CSP blocks inline scripts.
- **Safe uploads:** size cap, content-based allow-list, random server-generated ids (never the user's filename), `nosniff`.
- **Original-quality images:** the upload buffer is written to GridFS unchanged and streamed back unchanged. No image library touches the bytes.
- **Client route guard:** a React Router wrapper reads the session store and redirects. This is convenience only; the API is the real gate.
- **Client state (Zustand):** `sessionStore` (user, status, login, logout, change password), `noticesStore` (items, total, categories, ids that just arrived live, `reload()` and `dropExpired()`), and `useLiveStore` in `lib/socket.ts` (Live or Reconnecting). Filters and the page number live in the URL, not in a store.
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
  Dockerfile                  two stages: build client and server, slim non-root runtime
  docker-compose.yml          app + MongoDB with auth and health checks
  playwright.config.ts        browser test setup (Chromium, throwaway server)
  .github/workflows/ci.yml    check, e2e, image
  scripts/
    mongo-init.js             creates database users (see section 5)
    seed-admin.ts             first admin and default categories from env
    seed-demo.ts              demo committee members, categories, about 180 notices with images
    cleanup.ts                removes notices expired > 1 year, unattached images
  shared/
    src/index.ts              APP_NAME only (no shared schemas)
  server/
    src/
      index.ts                creates HTTP server, Express app, Socket.IO
      app.ts                  middleware order, route mounting, static files, SPA fallback
      config/env.ts           reads and checks env variables
      db.ts                   Mongoose connection (sanitizeFilter on)
      middleware/             rateLimit, security (operator keys, origin), auth, errorHandler, validate
      routes/                 auth, notices, images, me, categories, users, audit, health
      services/               authService, noticeService, imageService, userService, categoryService, auditService
      models/                 User, RefreshToken, Category, Notice, AuditLog
      realtime/               socket.ts (origin, limit, rooms, expiry), events.ts (announce)
      lib/                    jwt, password, sanitize, errors, logger, access, visibility, cookies, objectId
    tests/                    unit and integration (REST, sockets, access matrix, headers, cleanup, seed)
  client/
    public/favicon.svg
    src/
      main.tsx, App.tsx       entry, fonts, router, scroll to top
      pages/                  Board, NoticeDetail, Login, Forbidden, NotFound, account/, committee/, admin/
      components/             Layout, NoticeCard, NoticeForm, Filters, Pagination, RouteGuard, AdminNav
      store/                  sessionStore, noticesStore
      lib/                    api.ts, socket.ts, format.ts, category.ts, useTitle.ts
      index.css               shared button, field, badge classes (tokens are in tailwind.config.js)
    tailwind.config.js
    (tests sit next to the code as *.test.tsx; live.test.tsx covers the socket)
  e2e/                        Playwright specs, test server, helpers
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
| `tokenHash` | string | required, unique (HMAC-SHA256 of the token with the pepper) |
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
`images.files` / `images.chunks` with `metadata: { noticeId, uploaderId, contentType, sha256, alt }`. `noticeId` is empty until a notice that lists the image is saved. Files not referenced by a notice after 24 h are deleted by the cleanup script.

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
`scripts/seed-admin.ts` reads `SEED_ADMIN_EMAIL`, `SEED_ADMIN_NAME`, `SEED_ADMIN_PASSWORD` from the environment, creates the first admin (with `mustChangePassword: true`) only if none exists, and adds a few default categories. Nothing is hard-coded. `scripts/seed-demo.ts` (`npm run seed:demo`) is separate and optional: 14 demo committee members (email domain `demo.college.test`, no admin), 10 categories and about 180 notices in every state with generated poster images; `--reset` removes only that demo data.

## 6. Access control design

**Sign-in:** `POST /api/auth/login` verifies email and bcrypt hash, rejects inactive users, creates an access JWT (`sub`, `role`, 15 min) and a random refresh token (stored as hash, 7 days), and sets both as cookies.

**Session bootstrap:** the client calls `GET /api/auth/me` on load; 401 means "no session".

**Refresh:** `POST /api/auth/refresh` checks the refresh token hash, marks it used and issues a new pair in the same family. A used token presented again revokes every refresh token of that user. The client API wrapper calls refresh once on a 401 and retries the request.

**Revocation:** logout, password change, disabling a user and password reset revoke refresh tokens. Access tokens expire within 15 minutes; `active` is re-checked on refresh and on admin actions. Sockets are disconnected at access token expiry.

**Roles:** `committee`, `admin`. Anonymous has no token.

**Permission table:** identical to PRD Section 5.

**Request order (every REST request, see the flowchart in section 1.2):**
1. helmet headers (CSP, nosniff, frame protection, HSTS in production).
2. Built website files in production (before the limiter, so loading a page does not use up the read allowance).
3. Read limiter: GET and HEAD, 120 per minute per IP.
4. JSON body parsing, 100 KB limit, then cookie parsing.
5. Operator-key rejection: any key starting with `$` or containing `.` in the body, query or params gives 400.
6. Auth middleware (JWT cookie, optional on public routes).
7. Origin check on every method except GET, HEAD and OPTIONS (a missing Origin is refused).
8. Write limiter: 30 per minute per user (per IP when anonymous).
9. `requireRole()` on protected routes.
10. Zod validation of params, query and body.
11. Service: object-level check (`authorId === user.id` unless admin), query with sanitised filters.
12. Audit entry for writes, socket announce after a successful write.

**Socket request order:** origin check (a request with an Origin other than `APP_ORIGIN` is refused), connection rate limit (20 per minute per IP), cookie JWT verify (optional), join rooms, and a timer that disconnects the socket when its access token expires. The server registers no handler for client messages, so clients cannot send data.

**Client guards (flowchart in section 1.4):** `RouteGuard` redirects to `/login` when the session store has no user, shows `Forbidden` for the wrong role and sends a user with a temporary password to `/account/password`. Admin and committee page bundles are lazy-loaded.

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
| `notice:created` | `public` | the public notice (id, title, body, category, images, pinned, publishedAt, expiresAt, createdAt, updatedAt) | a notice becomes public |
| `notice:updated` | `public` | same shape | a public notice is edited or pinned or unpinned |
| `notice:removed` | `public` | `{ id }` | a public notice is archived, deleted or unpublished |
| `notice:changed` | `user:<authorId>` and `admin` | the same plus `status` and `authorId` | any change, including drafts and archived (decision chart in section 1.5) |

Rules: payloads never contain hashes or private fields; clients cannot emit events (the server ignores incoming events). FR-14 (auto-expiry) uses the shared visibility query on the server and a 30 s client timer comparing `expiresAt`. The client does not patch cards from the payload: any public event reloads the current view, so the server's own filters decide what appears. FR-19 to FR-21 are implemented by middleware, the validation layer and the rate limiter rather than by endpoints.

## 8. Frontend architecture

| Route | Access | Content |
|-------|--------|---------|
| `/` | public | Board: search box, category and date filters, paged cards, pinned first, live updates |
| `/notices/:id` | public | Full notice and images |
| `/login` | public | Login form |
| `/committee` | committee, admin | My notices with status filter (admins see everyone's and can pin) |
| `/committee/new`, `/committee/:id/edit` | committee, admin (own for committee) | Notice form with image upload and alt text |
| `/account/password` | committee, admin | Change own password (forced first for temporary passwords) |
| `/admin` | admin | Overview cards linking to the admin pages |
| `/admin/users` | admin | Create, disable, reset users |
| `/admin/categories` | admin | Category CRUD |
| `/admin/audit` | admin | Audit log |
| `*` | public | 404 page (the 403 page is shown by the route guard in place of a forbidden area) |

- **Tailwind and the design system:** mobile-first utility classes. Tokens live in `client/tailwind.config.js`: paper, ink, signal blue, marigold (only for Pinned and the live dot), line, edge, muted, and a colour pair per category. The old grey scale is mapped onto the same palette. Shared classes (`btn`, `btn-primary`, `btn-quiet`, `field`, `panel`, `badge`, `page-title`) are defined once in `index.css`. Fonts (Bricolage Grotesque for headings, Public Sans for text) are bundled with the site, because the CSP allows fonts only from the app's own address. A category's colour comes from its name (`lib/category.ts`), so no database field is needed. One focus style everywhere, and animation is off under `prefers-reduced-motion`.
- **Route guards:** `GuardedOutlet` (a `RouteGuard` plus lazy loading) wraps `/committee/*`, `/account/*` and `/admin/*`; it waits for `GET /api/auth/me`, then redirects or renders. A failed silent refresh clears the session.
- **State:** `sessionStore`, `noticesStore` and `useLiveStore` (Section 3). Notices that arrive through a live reload are marked "fresh" for 8 seconds for a highlight. `noticesStore.reload()` re-fetches the current view (debounced 300 ms) when a public socket event arrives, so the server's own filters decide what appears; `dropExpired()` runs every 30 s.
- **Socket module:** connects after the session check and again whenever the signed-in user changes (so the server assigns the right rooms), reconnects automatically, signs in again quietly when the server drops it for an expired token, refetches the current page after any gap, and shows a "Live" or "Reconnecting" indicator (`aria-live`).
- **Forms:** HTML constraints and light checks in the client for fast feedback; the server's Zod schemas are authoritative and their field messages are shown next to the fields.
- **Loading and error states:** every list and form has loading, empty and error views.
- **Accessibility:** semantic HTML, labelled inputs, required `alt` text for images, keyboard focus order, 4.5:1 contrast (checked by an automated scan of every main page), live region for the connection status, per-page tab titles. Filters fold behind a button on phones.
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
MONGO_RO_PASSWORD=CHANGE_ME_RO               # read-only user for backups and reporting
CLIENT_DIST=/app/client/dist                 # set inside the Docker image only: the built website the server serves
VITE_API_BASE=/api                           # client API path (proxied in dev)
```

## 11. Testing strategy

- **Unit:** Zod schemas (including `$ne`, `$where`, dotted keys), JWT sign/verify, bcrypt helpers, visibility query builder, image type check, category colour rule, `noticesStore` live reload and fresh marks.
- **Integration (in-memory MongoDB, Supertest):** every endpoint in Section 7; refresh rotation and reuse detection; SHA-256 of downloaded image equals upload; expiry hides a notice; search with injection strings returns normal results; `/api/health` returns 503 when the database is down.
- **Socket tests (`socket.io-client`):** an anonymous client gets `notice:created` within 2 s of a publish; an anonymous client never gets a draft event; the author gets `notice:changed` for their draft and another committee member does not; admin gets all; a socket with an expired token is disconnected; a disallowed Origin is refused.
- **Access-control tests (explicit):** for each protected route and action, call as anonymous, committee A, committee B, and admin, and assert the PRD Section 5 result. Specific cases: committee B edits/deletes committee A's notice (403), committee B reads A's draft or draft image (404/403), committee opens `/admin` (403 page), anonymous opens `/committee` (redirect), disabled user refresh (401), committee pins (403), committee creates user (403).
- **Component tests (React Testing Library with a fake socket):** route guards, sign-in, board filters and paging, live reload, fresh highlight, committee and admin screens, `NoticeForm` messages.
- **End to end (Playwright, `npm run e2e`):** a throwaway server on the production build; viewer reads and searches; committee logs in, posts with an image, and a second open viewer window follows the edit and archive without refresh; viewer typing `/admin` is sent to `/login`; admin pins and finds the audit entries. An axe scan (WCAG 2.1 A and AA) and a content-security-policy console check run on every main page.
- **Pipeline:** the CI workflow runs lint, `npm audit`, type check, all tests and build (`check`), the browser test (`e2e`) and the Docker build (`image`); a red step blocks publishing the image. Flowchart in section 1.8.

## 12. Deployment and operations

- **Local development:** `docker compose up -d mongo` (MongoDB with authentication and `scripts/mongo-init.js`), `npm run seed`, then `npm run dev` (server on 4000, Vite on 5173 proxying `/api` and `/socket.io`).
- **Local containers:** `docker compose up --build` runs the app image and MongoDB; the app is at `http://localhost:3000`. The compose file defines health checks (`/api/health` for the app, a ping for MongoDB), a named volume for MongoDB data and reads passwords from `.env`.
- **Dockerfile:** stage 1 builds the client (`vite build`) and the server (TypeScript to JS); stage 2 is `node:20-alpine` with only production dependencies, the compiled server, the built client (`CLIENT_DIST`), `USER node`, `EXPOSE 3000`, and a `HEALTHCHECK` on `/api/health`.
- **CI (`.github/workflows/ci.yml`):** on push and pull request. Job `check`: Node 20, `npm ci`, lint, `npm audit` (high findings fail), type check, tests (MongoDB memory server), build. Job `e2e` (after `check`): Playwright and Chromium against the production build. Job `image` (after both): `docker build` every run; on `main` only it logs in to GitHub Container Registry and pushes the image tagged with the commit SHA and `latest`. Third-party actions are pinned to commit IDs.
- **Deploy:** create a MongoDB Atlas cluster and an `noticeboard_app` user with `readWrite` on `noticeboard`, allow the host's IPs; create a Render web service from the image; set all environment variables there (`MONGODB_URI` with the Atlas string, `APP_ORIGIN` with the public URL, secrets created by running `openssl rand -base64 32`); set the health check path to `/api/health`; run the seed script once. Render provides HTTPS and WebSocket support.
- **Logging:** structured JSON to stdout, never containing passwords, tokens or full request bodies.
- **Backups:** `mongodump --archive --gzip` with the read-only `noticeboard_ro` user (exact commands in the README), kept 14 days; Atlas snapshots if used.
- **Restore:** `mongorestore --gzip --archive --drop` with the administrator user (README); verify by loading the board.
- **Cleanup:** about monthly `npm run cleanup` (`--dry-run` previews): deletes notices expired over a year ago with their images, and uploads never attached after 24 hours. Take a backup first.

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

| After M8 | `seed-demo.ts`, the interface redesign (design tokens, board rows, pinned cards, fresh highlight), filters on phones, per-page titles, favicon |

Requirement coverage: FR-01 to FR-04 and FR-24 use `users`, `refreshTokens`, `auditLogs`; FR-05, FR-06 use `users`, `refreshTokens`, `auditLogs`; FR-07 uses `categories`, `notices`; FR-08 uses `auditLogs`; FR-09 to FR-18 use `notices`, GridFS, `categories`; FR-19 to FR-21 are cross-cutting (middleware, guards, validation, limiter); FR-22 and FR-23 use `notices` and the Socket.IO rooms. Every collection is used by at least one requirement.

Faculty checklist mapping: Tailwind (M4, M5), React and state (M4 to M6), REST API (M2, M3, M5), Mongoose (M2, M3), validation (M2, M3), authentication and authorisation (M2, M4), Socket.IO (M6), Docker (M7), DevOps and deployment (M7, M8).
