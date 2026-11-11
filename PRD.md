# Digital Notice Board: Product Requirements Document

Owner: Tisha Dusseja. Purpose: college mini project, evaluated against the faculty checklist in Section 2.1.

## 0. Non-negotiable build rules (read first, follow always)

### 0.1 Git and commit rules
1. Run `git init` (default branch `main`) at the very start, before writing any code. If the repository already exists, confirm the branch is `main` and continue.
2. Commits use the developer's own configured git identity (`git config user.name`, `git config user.email`). Never change that identity, never use `--author` or `--reset-author`, and never add anyone else as author or committer.
3. Commit messages contain ONLY what the developer would write. Strictly forbidden in the subject or the body: `Co-Authored-By:` trailers of any kind, "Generated with", the names of any AI tool or vendor, "AI-generated", "AI assistant", robot emojis, or any line that credits a tool or assistant. No attribution anywhere.
4. Group commits professionally: one commit per cohesive chunk of 3 to 4 closely related features or steps, not one per small change. A milestone usually produces 2 to 4 commits. Every commit must leave the project building with its tests passing, and tests ship in the same commit as the code they cover. Never create "wip", "fix typo" or "update" commits; fold small fixes into the chunk they belong to before moving on.
5. Use Conventional Commits: `type(scope): summary`, imperative mood, lowercase, 72 characters or fewer, no trailing full stop, then a blank line and 2 to 4 short bullets saying what the commit contains. Types: feat, fix, refactor, test, docs, chore, perf.
6. Before every commit run `git status` and `git diff --staged` and confirm only the intended files are staged. Never commit `.env`, secrets, uploads, `node_modules`, build output, or database dumps.
7. Do not push, add remotes, open pull requests or force anything. Only local commits. The owner pushes.
8. Install this local safety hook in the first step. It lives in `.git/hooks`, is not committed, and blocks any commit message that carries attribution. Save it as `.git/hooks/commit-msg` and make it executable with `chmod +x .git/hooks/commit-msg`:

```sh
#!/bin/sh
if grep -qiE "co-authored-by|claude|anthropic|generated with|ai-generated" "$1"; then
  echo "Commit rejected: remove attribution or tool mentions from the message." >&2
  exit 1
fi
```

### 0.2 Files you must NOT create
- Do NOT create `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursorrules` or any similar assistant-instruction file.
- Do NOT create a `.claude/` directory inside the project.
- Add these lines to the project `.gitignore` as a safeguard:
```
CLAUDE.md
AGENTS.md
.claude/
```
- Do not mention or credit any AI tool anywhere: not in the README, code comments, UI footer, package metadata, docs, images or badges.
- The only markdown files allowed in the repository are `README.md`, `PRD.md`, `architecture.md` and, if truly needed, `docs/*.md`.

### 0.3 General working rules
- Build in the milestone order of Section 10. Finish and verify each milestone before starting the next.
- All secrets come from environment variables. Ship `.env.example` with placeholder values only.
- Prefer simple, readable code. No unused abstractions.
- Validate all input on the server. Never trust the client for access control.

## 1. Overview

The Digital Notice Board is a web app where a college committee publishes notices and everyone else reads them. Two kinds of people use it: **committee members**, who sign in and post, and **viewers** (the owner calls them "nav users"), who open the site and read the latest notices with no account. New notices appear on open boards instantly, without a page refresh. Access is strictly controlled: viewers can never enter the committee or admin areas.

Core value:
- One trusted place for college news, newest first, each notice time-stamped.
- Only authenticated committee members can post; viewers need no sign-in.
- Live updates: a published notice shows on every open board within 2 seconds.
- Images in notices are shown exactly as uploaded (no recompression).
- Content typed into notices can never run as a database query or as a script.
- Admin-created committee accounts, so no one can self-register into posting rights.

## 2. Owner's reasoning and decisions

All items below are DECISIONS and are authoritative.

| # | DECISION | Owner's reason |
|---|----------|----------------|
| D1 | Two user types: committee ("community people", special access) and viewers ("nav users", read only). | Committee posts college news; everyone else just consumes it. |
| D2 | Committee posts from the frontend; data goes to the backend and is stored in **MongoDB**. Viewers see it on the frontend. | Clear one-way flow: committee writes, viewers read. |
| D3 | Every post is stored with a timestamp and related metadata. | Viewers need "latest news" ordering and a trustworthy time. |
| D4 | Access is controlled with **JWT**. The committee gets a special authentication. | Only the committee may post. |
| D5 | URL protection: nobody without access may enter the admin or committee sections by typing a URL. Viewers must never get there. | Prevent URL guessing. |
| D6 | Injection must be prevented when reading/storing posts; query-like text in a post title or body must be neutralised. | Owner wrote "SQL injection". MongoDB is not SQL, so the real attack is NoSQL/operator injection; the same protection intent is applied (see Section 12). |
| D7 | An image area where the committee can attach images; image quality must be kept exactly as uploaded. | Posters expect their images unchanged. |
| D8 | The project must demonstrate the faculty's Mini Project Evaluation checklist (Section 2.1): Tailwind frontend, React with state management, REST API, MongoDB/Mongoose, validation, authentication/authorisation, Socket.IO real-time, Docker, DevOps and deployment. Complete as much as possible, preferably all. | College evaluation; compulsory for all students. |

### 2.1 Faculty checklist coverage (all nine items)

| # | Checklist item | How this project covers it | Requirements | Milestone |
|---|----------------|----------------------------|--------------|-----------|
| 1 | Frontend with Tailwind | All UI styled with Tailwind CSS utility classes, responsive, dark-mode-free, accessible. | NFR (accessibility, responsive), FR-15 to FR-17 | M4, M5 |
| 2 | React and state management | React 18 SPA with React Router; Zustand stores for session, notices/filters and toasts. | FR-24, FR-15, FR-22 | M4, M5, M6 |
| 3 | Backend REST API | Express REST API, about 24 endpoints, one error format, pagination. | FR-01 to FR-21 | M2, M3, M5 |
| 4 | MongoDB and Mongoose | Mongoose models, indexes, GridFS, least-privilege database users. | Section 8 | M2, M3 |
| 5 | Data validation | Zod schemas on every input, operator-key rejection, upload content checks. | FR-20 | M2, M3 |
| 6 | Authentication and authorisation | JWT cookies, refresh rotation, roles, ownership checks, route guards. | FR-01 to FR-04, FR-19 | M2, M4 |
| 7 | Real-time features (Socket.IO) | Live `notice:created/updated/removed` events to open boards; private draft events to authors. | FR-22, FR-23 | M6 |
| 8 | Docker | Multi-stage Dockerfile for the app; compose runs app and MongoDB with authentication. | NFR (deployment) | M7 |
| 9 | DevOps and deployment | GitHub Actions pipeline (lint, test, build, image), deployed to Render with MongoDB Atlas, health check and backups. | NFR (deployment) | M7, M8 |

## 3. Goals and non-goals

Goals:
- G1: A viewer sees the 20 newest notices on the home page without signing in.
- G2: 100% of committee/admin API routes reject callers without a valid token of the right role (tested for every role); committee/admin pages redirect or show 403.
- G3: Uploaded images are served byte-identical to the upload (SHA-256 match verified in a test).
- G4: No request body, query string or socket message can alter a database query's structure (operator-injection tests pass).
- G5: Home page loads in under 2 s on a 10 Mbps connection with 100 notices stored.
- G6: A published notice appears on every open board within 2 s, with no refresh.
- G7: All nine faculty checklist items demonstrably working in the final build.

Non-goals (this version):
- No viewer accounts, comments, likes or notifications by email/SMS/push.
- No scheduled publishing, no rich-text/HTML bodies (plain text with line breaks only).
- No image editing, resizing, thumbnails or video/PDF attachments.
- No self-registration, no multiple colleges or tenants.
- No password-reset email (the admin resets passwords).
- No horizontal scaling of Socket.IO (single app instance; Redis adapter is a later step).
- No Kubernetes or infrastructure-as-code.

## 4. Users and areas

| Area | Who | Goal | Sign-in | Entry point |
|------|-----|------|---------|-------------|
| Public board | Viewer (students, staff, visitors) | Read latest notices live, search, filter | None | `/` and `/notices/:id` |
| Committee area | Committee member | Create, edit, delete own notices and images | Email + password, JWT, account created by admin | `/committee` (login at `/login`) |
| Admin area | Admin | Manage committee accounts, categories, any notice, view audit log | Email + password, JWT | `/admin` (login at `/login`) |

## 5. Access control matrix

Default rule: everything is denied unless this table allows it. "Own" means the notice's `authorId` equals the caller's user id. The server enforces this table on every REST call and every Socket.IO connection; the client route guard only improves the user experience.

| Action / data | Anonymous (viewer) | Committee | Admin |
|---------------|--------------------|-----------|-------|
| Read published, unexpired notices | Allowed | Allowed | Allowed |
| Read drafts, archived or expired notices | Denied | Own only | Allowed |
| Create notice | Denied | Allowed | Allowed |
| Edit notice | Denied | Own only | Allowed |
| Delete/archive notice | Denied | Own only | Allowed |
| Pin notice | Denied | Denied | Allowed |
| Upload image | Denied | Allowed | Allowed |
| Read image of a public notice | Allowed | Allowed | Allowed |
| Read image of a draft/archived notice | Denied | Own only | Allowed |
| Delete image | Denied | Own only | Allowed |
| List categories | Allowed | Allowed | Allowed |
| Create/edit/delete categories | Denied | Denied | Allowed |
| Create, disable, reset users | Denied | Denied | Allowed |
| Change own password | Denied | Allowed | Allowed |
| View audit log | Denied | Denied | Allowed |
| Receive live events for public notices | Allowed | Allowed | Allowed |
| Receive live events for draft/archived notices | Denied | Own only | Allowed |
| Open `/committee/*` pages | Denied (redirect to `/login`) | Allowed | Allowed |
| Open `/admin/*` pages | Denied (redirect to `/login`) | Denied (403 page) | Allowed |

An anonymous visitor can only: read the public board, search/filter it, open a public notice and its images, view categories, receive live events for public notices, and reach the login page.

## 6. Functional requirements

### Account and session
**FR-01 Login.** Committee/admin sign in with email and password. Who: anyone with an account.
- Valid credentials set an access cookie (15 min) and a refresh cookie (7 days).
- Wrong credentials return the same generic error whether the email exists or not.
- After 5 failed attempts in 15 min from one IP+email, further attempts are rejected with 429 for 15 min.

**FR-02 Logout.** Who: signed-in users.
- Cookies are cleared and the refresh token is revoked in the database.
- A copied old refresh token no longer works afterward.

**FR-03 Session refresh.** Who: signed-in users.
- An expired access token with a valid refresh token silently yields a new pair (refresh token rotated).
- Reusing an already-rotated refresh token revokes all that user's refresh tokens.
- A disabled user's refresh fails.

**FR-04 Change own password.** Who: committee, admin.
- Requires current password; new password is at least 10 characters.
- All other sessions of that user are revoked.

### Admin management
**FR-05 Create committee account.** Who: admin.
- Admin supplies name, email, role (`committee` or `admin`), temporary password.
- Duplicate email is rejected with 409.
- The action appears in the audit log.

**FR-06 Disable/enable/reset user.** Who: admin.
- Disabled users cannot log in and their refresh tokens are revoked.
- Admin cannot disable or demote themselves.
- Password reset sets a new temporary password and revokes sessions.

**FR-07 Manage categories.** Who: admin.
- Create, rename, delete categories (e.g. Exams, Events, Placements).
- A category in use by notices cannot be deleted (409).
- Names are unique, case-insensitive.

**FR-08 Audit log.** Who: admin.
- Login success/failure, user changes, category changes and notice create/edit/delete are logged with actor, time, and target.
- The list is paginated, newest first, read-only.

### Notices
**FR-09 Create notice.** Who: committee, admin.
- Fields: title (1 to 120 chars), body (1 to 5000 chars), category, optional expiry date, up to 5 images, status `draft` or `published`.
- Server stores `createdAt`, `updatedAt`, `publishedAt` (set when first published) and `authorId`.
- Invalid input returns 400 with field errors.

**FR-10 Edit notice.** Who: author (own) or admin.
- Another committee member editing it gets 403.
- `updatedAt` changes; `createdAt` never changes.

**FR-11 Delete/archive notice.** Who: author (own) or admin.
- Archive hides it from the public and keeps it. Delete removes it and its images.
- Another committee member gets 403.

**FR-12 Pin notice.** Who: admin.
- Pinned notices show first on the board (max 3 pinned).
- Unpin restores date order.

**FR-13 My notices.** Who: committee, admin.
- Committee sees only their own, any status. Admin sees all.
- Filter by status; paginated 20 per page.

**FR-14 Auto-expiry.** System.
- A notice past its `expiresAt` disappears from the public API results without any manual action.
- An open board hides it within 30 s of `expiresAt` without a refresh.
- It stays visible to its author and admin with an "Expired" label.

### Public board
**FR-15 Browse board.** Who: anyone.
- Shows published, unexpired notices; pinned first, then newest `publishedAt` first.
- 20 per page with next/previous pages.
- Each card shows title, category, date/time, and the first image if any.

**FR-16 Search and filter.** Who: anyone.
- Search by text across title and body; filter by category and by date range.
- Filters are kept in the URL so a link reproduces the view.
- Search text such as `{"$ne":null}` or `'; DROP` is treated as plain text and returns normal results.

**FR-17 View notice.** Who: anyone.
- Full title, body, category, published time and all images.
- A draft, archived or expired id returns 404 to the public.

**FR-18 Original-quality images.** Who: anyone (for public notices).
- Accepted types: JPEG, PNG, WebP; max 10 MB each; type verified by file content, not file name.
- The stored and served bytes are identical to the upload; the server never resizes or recompresses.
- Display uses the original file; the page scales it only with CSS.

### Protection
**FR-19 Route protection.** System.
- Visiting `/committee/*` or `/admin/*` without a valid session redirects to `/login`; with the wrong role shows a 403 page.
- The same checks run again in every API handler (the real protection).
- Direct API calls (curl) without a token get 401; wrong role gets 403.

**FR-20 Injection-safe input.** System.
- Every request body, query, path param and socket message is validated against a schema; unknown keys are rejected or dropped.
- Keys beginning with `$` or containing `.` are rejected (operator injection).
- Notice text is stored as plain text and output-escaped, so `<script>` shows as text and never executes.

**FR-21 Rate limiting.** System.
- Public reads: 120 req/min per IP. Login: see FR-01. Writes: 30 req/min per user. Socket connections: 20 per minute per IP. Exceeding returns 429 (or refuses the connection).

### Real-time and client
**FR-22 Live board updates.** Who: anyone viewing the board or a notice.
- When a notice is published, updated, archived, deleted or pinned, every open board updates within 2 s without refresh.
- A notice opened in detail view that gets removed shows a "This notice is no longer available" message.
- If the connection drops, the client reconnects automatically and refetches the current page.

**FR-23 Private live events.** Who: committee (own), admin (all).
- Draft and archived changes are sent only to the author's room and the admin room.
- A socket without a valid token never receives draft or archived data (tested).
- A socket is disconnected when its access token expires or its user is disabled, and the client reconnects with a fresh token.

**FR-24 Current session and client state.** Who: any visitor.
- On app load the client calls `GET /api/auth/me`; the session store holds the user or `null`.
- Notice list, filters, page and live updates live in the notices store; toast messages in the UI store.
- Reloading the page restores the same view from the URL and the session from the cookies.

## 7. Non-functional requirements

Security:
- Passwords hashed with bcrypt (cost 12); never logged or returned.
- JWTs signed HS256 with a secret of 32+ random bytes from the environment; access 15 min, refresh 7 days.
- Cookies: `HttpOnly`, `Secure` (production), `SameSite=Strict`.
- CSRF: `SameSite=Strict` plus an `Origin` header check on all non-GET requests.
- Secure headers (helmet): CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, HSTS in production.
- Image responses carry `Content-Type` from the verified type, `nosniff`, and `Content-Disposition: inline`.
- Socket.IO accepts connections only from the app origin.
- Dependency audit (`npm audit`) shows no high/critical issues at release.

Performance: board API response under 300 ms at the 95th percentile with 1,000 notices; images served with `ETag` and `Cache-Control: public, max-age=31536000, immutable`; client JavaScript bundle under 300 KB gzipped for the public board (admin and committee code is lazy-loaded).

Accessibility: WCAG 2.1 AA targets: keyboard navigable, visible focus, 4.5:1 text contrast, image `alt` text field required on upload, live updates announced with `aria-live="polite"`.

Responsive: usable from 360 px to 1920 px wide (Tailwind breakpoints, mobile-first).

Privacy: collect only name, email and password hash for staff; no tracking of viewers; IP addresses appear only in the rate limiter and the audit log of login events.

Logging and audit: structured JSON logs without secrets; audit log per FR-08, retained 1 year.

Backup and recovery: nightly `mongodump` kept 14 days; restore procedure documented in the README and tested once.

Containers and deployment:
- The app builds into one Docker image (multi-stage, non-root user, under 300 MB) that serves the API, Socket.IO and the built frontend on one port.
- `docker compose up` starts the app and an authenticated MongoDB with health checks.
- `GET /api/health` returns 200 only when the database responds; used by Docker and the host.
- A CI pipeline runs lint, type check, tests and builds the image on every push to `main`; the pipeline fails on any error.
- Production runs on Render (Docker) with MongoDB Atlas over TLS; secrets are set in the host, never in the image or repository.

## 8. Data and database requirements

Database: **MongoDB** (chosen by the owner), database name `noticeboard`, accessed through Mongoose.

Data stored: users, refresh tokens, categories, notices, image files (MongoDB GridFS bucket `images`, so images share the one store and the one backup), audit logs.

Sensitive data: password hashes, refresh token hashes, email addresses, IPs in the audit log. Never returned by public endpoints; password and token hashes never returned by any endpoint or socket event.

Database user policy:
- Authentication is enabled on MongoDB.
- The app connects as its own user `noticeboard_app` with `readWrite` on `noticeboard` only; never an administrator account.
- A separate admin account is for setup and maintenance only; a read-only user may be used for backups.

Retention:
- Refresh tokens are deleted automatically after expiry (TTL index).
- Expired notices are kept (hidden) for 1 year, then removed by a monthly cleanup script along with their images.
- Audit logs are removed after 1 year (TTL index).

## 9. Key user flows

### 9.1 Viewer reads notices
1. Viewer opens `/`.
2. Server returns the first page of published, unexpired notices.
3. Viewer searches or filters; results update and the URL changes.
4. Viewer opens a notice and sees full text and images.

```text
flowchart TD
  A[Viewer opens /] --> B[GET /api/notices]
  B --> C{Rate limit ok?}
  C -- no --> D[429 Too many requests]
  C -- yes --> E[Validate query params]
  E -- invalid --> F[400]
  E -- valid --> G[Find published and unexpired notices]
  G --> H[Show board, pinned first]
  H --> I[Open a notice]
  I --> J[GET /api/notices/id]
  J --> K{Published and unexpired?}
  K -- no --> L[404]
  K -- yes --> M[Show notice and images]
```

### 9.2 Committee member publishes a notice
1. Member logs in at `/login`; server sets cookies.
2. Member opens `/committee/new`, fills title, body, category, optional expiry.
3. Member attaches images; each is uploaded and verified.
4. Member saves as draft or publishes; if published, it appears on all open boards at once (flow 9.5).

```text
flowchart TD
  A[Login] --> B{Valid credentials?}
  B -- no --> C[Generic error, count attempt]
  B -- yes --> D[Set access and refresh cookies]
  D --> E[Open /committee/new]
  E --> F[Upload images]
  F --> G{JPEG PNG WebP, under 10MB, content matches?}
  G -- no --> H[400 reject file]
  G -- yes --> I[Store original bytes in GridFS]
  I --> J[Submit notice]
  J --> K{Token valid and role ok?}
  K -- no --> L[401 or 403]
  K -- yes --> M[Validate and strip operator keys]
  M --> N[Save notice with timestamps]
  N --> O[Write audit entry]
  O --> P[Emit socket event]
```

### 9.3 Unauthorised URL access
1. Anyone requests `/committee` or `/admin`.
2. The app asks `GET /api/auth/me`; the route guard decides.
3. No session: redirect to `/login`. Valid session, wrong role: 403 page.
4. Whatever the page does, every API call behind it is checked again on the server.

```text
flowchart TD
  A[Open /admin or /committee] --> B[GET /api/auth/me]
  B --> C{Valid session?}
  C -- no --> D[Redirect to /login]
  C -- yes --> E{Role allowed for area?}
  E -- no --> F[403 page]
  E -- yes --> G[Render page]
  G --> H[API call]
  H --> I{Server checks token, role, owner}
  I -- fail --> J[401 or 403]
  I -- pass --> K[Data returned]
```

### 9.4 Admin creates a committee account
1. Admin opens `/admin/users`, enters name, email, role, temporary password.
2. Server validates, hashes the password, saves the user, writes an audit entry.
3. Admin tells the member the temporary password; the member changes it on first login.

### 9.5 Live update reaches open boards
1. Every open board connects a socket and joins the `public` room (members and admins also join their private rooms).
2. A notice is published, edited, archived, deleted or pinned through the REST API.
3. After the database write succeeds, the server emits an event.
4. Each client updates its notices store; the card appears, changes or disappears.

```text
flowchart TD
  A[Board opens] --> B[Socket connects with cookie]
  B --> C{Token valid?}
  C -- yes --> D[Join public room and own rooms]
  C -- no or none --> E[Join public room only]
  F[REST write succeeds] --> G{Notice public after change?}
  G -- yes --> H[Emit to public room]
  G -- no --> I[Emit removed to public room if it was public]
  F --> J[Emit full event to author and admin rooms]
  H --> K[Clients update notices store]
  I --> K
  J --> K
```

## 10. Milestones and commit plan

### M1: Repository setup, rules and hook
Goal: a clean project skeleton with the rules enforced.
Built: `git init`, commit-msg hook, `.gitignore`, `client/` (Vite + React + TypeScript + Tailwind), `server/` (Express + TypeScript), lint and test runners, `.env.example`, README stub, `docker-compose.yml` with authenticated MongoDB.
Verify: a test commit with attribution text is rejected; both apps build and tests run; `docker compose up mongo` starts with auth.
Commits:
1. `chore(repo): initialise repository with ignore rules and commit hook`
2. `chore(client): scaffold vite react app with tailwind and test setup`
3. `chore(server): scaffold express typescript api with env check and health route`
4. `chore(db): add authenticated mongodb compose file and env template`

### M2: Database layer and authentication
Goal: working login, logout, refresh, session endpoint, route guards (server).
Built: Mongoose models (users, refreshTokens, categories, auditLogs), db connection, admin seed script, password hashing, JWT helpers, auth endpoints including `/api/auth/me`, auth middleware, rate limiter, validation helpers.
Verify: FR-01 to FR-04, FR-20 (helpers), FR-21 tests pass; every role against every protected route returns the expected status.
Commits:
1. `feat(db): add mongoose models, connection and first-admin seed script`
2. `feat(auth): add password hashing, jwt cookies and login/logout/refresh/me`
3. `feat(security): add role guards, origin check, rate limiting and input sanitiser`

### M3: Notices and images (API)
Goal: committee can create, edit, delete notices with original-quality images through the API.
Built: notice model, GridFS upload/serve, notice CRUD with ownership checks, categories read, audit logging, my-notices endpoint, public listing and search endpoints.
Verify: FR-09 to FR-11, FR-13 to FR-18, FR-20; SHA-256 of served image equals upload; committee B cannot edit committee A's notice; injection strings in search return normal results.
Commits:
1. `feat(notices): add notice model, validation and crud with ownership checks`
2. `feat(images): add verified gridfs upload and original-bytes serving`
3. `feat(board): add public listing, text search, filters and audit entries`

### M4: Frontend foundation and public board
Goal: viewers browse, search, filter and read in a Tailwind React app; login works.
Built: router, layout, Zustand session and notices stores, API client with silent refresh, route guards, board page, notice page, filters in the URL, login page.
Verify: FR-15 to FR-17, FR-19, FR-24; unauthenticated visit to `/admin` goes to `/login`; reload keeps the view.
Commits:
1. `feat(client): add router, tailwind layout, api client and session store`
2. `feat(board): add public board with pagination, search and filters`
3. `feat(board): add notice detail page, login page and route guards`

### M5: Committee and admin areas
Goal: staff manage content from the UI.
Built: committee dashboard and notice form with image upload; admin users, categories, pinning, audit log; the matching admin endpoints (FR-05 to FR-08, FR-12).
Verify: FR-05 to FR-08, FR-12; admin-only tests; self-demotion blocked; category in use cannot be deleted; committee cannot open `/admin`.
Commits:
1. `feat(committee): add my notices page and notice form with image upload`
2. `feat(admin): add user management with disable and password reset`
3. `feat(admin): add category management, notice pinning and audit log view`

### M6: Real-time with Socket.IO
Goal: open boards update without refresh.
Built: Socket.IO server attached to the HTTP server, handshake authentication from cookies, rooms (`public`, `user:<id>`, `admin`), emit hooks in the notice service, token-expiry disconnect, client socket module feeding the notices store, expiry timer, reconnect handling.
Verify: FR-22, FR-23, FR-14 (client hide); a test with two clients shows a published notice arriving within 2 s; an anonymous socket never receives a draft.
Commits:
1. `feat(realtime): add socket.io server with authenticated rooms`
2. `feat(realtime): emit notice events from services after database writes`
3. `feat(client): add socket client, live store updates and reconnect refetch`

### M7: Docker and DevOps
Goal: one-command containers and an automated pipeline.
Built: multi-stage `Dockerfile`, `.dockerignore`, full `docker-compose.yml` (app + MongoDB, health checks), GitHub Actions workflow (install, lint, type check, test, build, docker build, push image on `main`), Render and Atlas deployment guide, health endpoint wiring.
Verify: `docker compose up` serves the working app on one port; the workflow file passes `actionlint` or a dry run; the image runs as non-root.
Commits:
1. `chore(docker): add multi-stage dockerfile and full compose stack`
2. `chore(ci): add github actions pipeline for lint, test, build and image`
3. `docs(deploy): add render and atlas deployment guide`

### M8: Hardening, documentation and README
Goal: ready to hand in and demonstrate.
Built: security headers and CSP, cleanup script, backup instructions, full access-control test matrix, Playwright end-to-end flow, accessibility pass, README with a demo script that walks through all nine checklist items.
Verify: Definition of done (Section 11) fully checked.
Commits:
1. `feat(security): add helmet headers and csp`
2. `test(access): add full role-by-route and socket access test matrix`
3. `docs(readme): add setup, demo script, backup/restore and usage guide`

## 11. Definition of done

- [x] Every functional requirement (FR-01 to FR-24) met and verified. (Automated tests plus a Chromium run on an in-memory database; not yet run against a real MongoDB server.)
- [x] Access control matrix (Section 5) enforced on the server (REST and sockets) and covered by tests.
- [ ] All nine faculty checklist items (Section 2.1) demonstrable in the running app. (Items 1 to 8 demonstrated, Docker included; deployment to Render and Atlas and the pipeline have not been run yet.)
- [x] No secrets in the repository; `.env.example` present with placeholders only.
- [x] All tests pass; client and server builds succeed; Docker image builds and runs. (Image built and run with `docker compose up --build`: 244 MB, non-root, both services healthy.)
- [x] CI workflow file present and passing locally where possible. (Every command it runs passes locally; the workflow itself has not run.)
- [x] App connects to MongoDB with the least-privilege `noticeboard_app` user. (Verified in the running container against the authenticated MongoDB.)
- [x] No attribution or tool mentions anywhere in files or commit history. (The prohibited file names appear only in `.gitignore` and this document, as rules.)
- [x] No `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursorrules` or `.claude/` in the repository.
- [x] `git status` is clean; commits follow Section 0.1.

## 12. Assumptions and open questions

Assumptions (please correct):
1. "SQL injection" in the request is treated as NoSQL/operator injection because the database is MongoDB. SQL is not used anywhere.
2. "Nav user" means a viewer with no account; no viewer login exists.
3. Two staff roles exist: `committee` and `admin`. The owner said "committee" only; admin is added because someone must create committee accounts (no self-registration).
4. Stack (chosen to fit the faculty checklist, replacing the earlier Next.js plan): React 18 + Vite + TypeScript + Tailwind + Zustand + React Router on the client; Node 20 + Express + TypeScript + Mongoose + Zod + Socket.IO on the server; Vitest, Supertest and Playwright for tests. The owner named only MongoDB and JWT.
5. JWT is kept in HttpOnly cookies (not localStorage) so scripts cannot steal it. In production the Express server serves the built frontend, so everything is one origin and `SameSite=Strict` works.
6. Notice bodies are plain text, not HTML.
7. "Image quality maintained" means byte-identical storage and delivery, no recompression. Limits: 5 images per notice, 10 MB each.
8. Images are stored in MongoDB GridFS, not on disk.
9. Only the admin can pin notices.
10. Single college, no scheduled publishing, no email notifications.
11. Zustand is the state management choice (smaller than Redux, enough for three stores).
12. Hosting is Render (Docker) with MongoDB Atlas; GitHub Actions is the pipeline. The owner can swap the host without changing the app.
13. Socket.IO runs on one app instance, so no Redis adapter is needed.

Risks and open questions:
- Keeping the original bytes also keeps EXIF metadata such as GPS location. Risk accepted to honour the original-quality decision; the upload form should warn committee members.
- A single-page app serves its JavaScript files to everyone, so "URL protection" is real only at the API: the client route guard is a convenience, and admin code contains no secrets.
- No password-reset email means the admin must reset passwords by hand.
- Free hosting tiers may sleep when idle; for the live demo, open the site a few minutes beforehand.
- Should viewers later get optional accounts (e.g. saved categories)? Not needed for this version.
