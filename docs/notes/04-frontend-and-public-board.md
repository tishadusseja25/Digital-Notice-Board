# Notes 04: React frontend and public board

## Structure
- `client/src/main.tsx`: `BrowserRouter` around `App`. `App.tsx` holds only the route table and calls `useSessionStore().init()` once. Tests wrap `App` in `MemoryRouter` instead, which is why the router is not inside `App`.
- `components/Layout.tsx`: header (site name, account links), a skip-to-content link, `<Outlet/>` in `<main id="main">`. It renders account links only when `status === "ready"`, so there is no "Sign in" flash for a signed-in user.
- Routes: `/` Board, `/notices/:id`, `/login`, `/committee/*` (roles committee+admin), `/admin/*` (admin), `*` NotFound. The two staff routes render lazy-loaded placeholder pages (`pages/committee/Home.tsx`, `pages/admin/Home.tsx`) behind `RouteGuard`; M5 replaces them. Vite emits them as separate ~0.27 KB chunks.
- Bundle: main JS 178.6 KB, 58.1 KB gzipped (PRD budget 300 KB gzipped); CSS 2.7 KB gzipped. Re-check with `npm run build -w client` whenever a dependency is added.

## API client (`lib/api.ts`)
- `api<T>(path, { method, body, query })` prefixes `/api`, sends cookies (`credentials: "same-origin"`), JSON-encodes bodies, drops `undefined`/`""` query values, returns `undefined` for 204 and throws `ApiError(status, code, message, fields)` for non-2xx (the server's common error format; non-JSON error bodies become code `UNKNOWN`).
- 401 handling: for any path except `/auth/login` and `/auth/refresh`, call `refreshOnce()` and retry the request once. `refreshOnce()` keeps one in-flight promise in the module variable `refreshing`, so N simultaneous 401s produce exactly one `POST /api/auth/refresh`. This matters: the server rotates refresh tokens and treats reuse of a rotated token as theft, revoking every session of the user. Never call `/auth/refresh` directly from components.
- If the refresh fails, the registered `onSessionLost` handler runs (`sessionStore` registers one that clears the user) and the original 401 is thrown.
- Cost for an anonymous first visit: `GET /api/auth/me` (401) + `POST /api/auth/refresh` (401) + the board requests. The refresh cookie is HttpOnly and path-limited, so JavaScript cannot tell whether it exists; skipping the refresh would log out users whose 15-minute access cookie expired. Both calls count against the per-IP 120 GET/min limit and the 30 writes/min limit (the refresh is a POST), which is far above normal use.
- Mutating requests rely on the browser sending the `Origin` header; the server rejects POST/PATCH/DELETE without `Origin` equal to `APP_ORIGIN`. In dev, Vite serves on 5173 and proxies `/api` to 4000, so set `APP_ORIGIN=http://localhost:5173` in `.env`.

## State (Zustand)
- `store/sessionStore.ts`: `user`, `status` (`loading` -> `ready`), `init()`, `login()`, `logout()`. `init()` maps every failure (401 after failed refresh, offline) to "visitor". `logout()` clears the user in a `finally`, so the UI signs out even if the request fails (the server-side token then simply expires).
- `store/noticesStore.ts`: `items`, `total`, `page`, `limit`, `loading`, `error`, `categories`, `load(query)`, `loadCategories()`. A module counter `latest` makes `load()` ignore stale answers (fast filter changes). M6 will add an `applyEvent()` here for live updates.
- The board's filters are not in a store: the URL (`useSearchParams`) is the source of truth, `Board` derives `query` from it and reloads when `params.toString()` changes. `Filters` keeps a local draft and is re-mounted via `key={queryKey}` so Clear and back/forward reset the inputs.
- No toast/UI store yet (no feature needs it until the M5 forms); FR-24 mentions one.

## Board and detail
- Board request: `GET /api/notices?q&category&from&to&page` (page last; `page=1` is omitted from the address). `from`/`to` are date-input values (`YYYY-MM-DD`), interpreted as UTC days by the server.
- Search is submit-based (button or Enter), not per keystroke: one request per search, no debounce code.
- `NoticeCard` shows the full-body text clamped to 3 lines by CSS (`line-clamp-3`); the list response still carries the whole body (up to 5000 chars x 20 items). First image uses `loading="lazy"`; `object-cover` crops only the display, the file served is the original.
- `NoticeDetail` loads with its own local state (not the store) and uses an `current` flag to drop answers after the id changes. 404 -> "no longer available"; other errors -> generic message. All images are shown with `max-w-full h-auto`.
- All user text is rendered through React text nodes, so notice titles/bodies are escaped. Tests assert that `<script>` and `<img onerror>` text stay text.

## Auth screens
- `RouteGuard`: `loading` -> "Loading…" (prevents a redirect before the first `/auth/me` answer), no user -> `<Navigate to="/login" replace state={{ from: pathname }}>`, wrong role -> `Forbidden` (a 403 page rendered in place, URL unchanged), else children. It only decides what to show; the page bundle is public and every API call is re-checked by the server.
- `Login`: plain `FormData` form (HTML `required`, `type=email`, `autoComplete`). Error messages: 401 -> "Invalid email or password.", 429 -> wait message, anything else generic. After success it goes to the saved `from` path or the user's area (`/admin` for admins, `/committee` otherwise). `safePath()` accepts only paths starting with a single `/`, so `//evil.example` or full URLs in router state are ignored. A signed-in user opening `/login` is redirected to their area.
- `mustChangePassword` is stored on the user but not acted on yet.

## Tests (client)
- Vitest + jsdom + React Testing Library; no network library. `src/testUtils.ts` provides `stubFetch(fn)` (replaces global `fetch` with a `vi.fn`), `json(status, body)`, `calls(mock)` (list of `"METHOD url"`) and a sample `user`. Always `vi.unstubAllGlobals()` in `afterEach`.
- `api.test.ts` covers the single shared refresh, retry, failed refresh and no-refresh-after-bad-login. `App.routes.test.tsx` covers guards (signed-out redirect for `/admin`, `/committee`, `/admin/users`; loading state; committee on `/admin` -> 403; admin in both areas; sign-out inside an area) and the login page. `Board.test.tsx` covers listing, empty/error/retry, URL-driven filters, search, clear and paging.
- When a test renders `App`, the fake server must answer `/api/auth/me` and the notice list with the right shapes; an answer of the wrong shape (for example `{ user }` for the list) crashes the board's `map`.

## Gotchas and known gaps
- No end-to-end check against the real server yet (no Docker/MongoDB here); client tests use faked responses, server tests cover the API separately. A Playwright flow is planned for M8.
- The board is empty until notices exist; committee screens come in M5.
- Date display uses the browser's locale and time zone; the date filter works in UTC days, so a late-evening notice can appear under the next day in far-east or far-west time zones.
- Layout has no `aria-live` region yet; live updates (M6) must add one.
