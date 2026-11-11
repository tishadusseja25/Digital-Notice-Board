# Notes 05: Committee area

## Routes and guards
- `App.tsx` routes (all lazy-loaded, all behind `GuardedOutlet`): `/committee` (My notices), `/committee/new`, `/committee/:id/edit` (both `NoticeEditor`), `/account/password` (`ChangePassword`). Roles allowed: committee and admin. `/admin/*` is still the Plan 04 placeholder with its own `RouteGuard`.
- `components/RouteGuard.tsx`: `RouteGuard` (loading -> redirect to `/login` -> 403 page) plus `GuardedOutlet`, which wraps `RouteGuard` + `Suspense` + `<Outlet/>` so a group of nested routes shares one guard and one lazy-loading fallback.
- First-login rule: after the role check, a user with `mustChangePassword === true` is redirected to `/account/password` unless already on that path. It covers only guarded pages (the public board is not redirected). It is enforced in the interface only; the server still accepts API calls from such a user. Do not treat it as a security control.
- Built chunks (gzip): NoticeEditor 2.7 KB, My notices 1.6 KB, ChangePassword 1.1 KB; the public entry stays at 58.3 KB.

## My notices (`pages/committee/Home.tsx`)
- Data: `GET /api/me/notices?status=&page=`; local component state, no store (nothing else needs it). The status filter and page live in the URL (`?status=draft&page=2`).
- Rows come back in the staff shape (`status`, `authorId` present), which is why `Notice` in `store/noticesStore.ts` gained those two optional fields.
- "Expired" label: shown when `status === "published"` and `expiresAt` is in the past (computed at render time; the server already hides such notices from the public).
- Archive/Delete are two-step buttons held in `pending: { id, action }` (first click -> "Confirm archive|delete" + "Cancel"); no `window.confirm`, which would block automation and tests. Archive calls `DELETE /api/notices/:id?mode=archive`; Delete is `DELETE /api/notices/:id` (the server default is hard delete, and deletes the images' files). After success the list reloads; if a later page became empty, the page number steps back (`setParams` with `replace`).
- A server refusal (for example 403) leaves the row in place and shows the server's message.

## Notice form (`components/NoticeForm.tsx`, `pages/committee/NoticeEditor.tsx`)
- `NoticeEditor` is the loader: new -> form; edit -> `GET /api/notices/:id`. If the response has no `status` field it is the public shape, meaning the notice is not the caller's (admins always get the staff shape), so the form is replaced by "You can only edit your own notices". 404 -> "Notice not found". The form is keyed by id so navigating between notices resets it.
- Payload (create `POST /api/notices`, edit `PATCH /api/notices/:id`): `title, body, categoryId, status, expiresAt, images[{fileId, alt}]`. `PATCH` sends the whole set every time; `images` replaces the list server-side and the server deletes files that were dropped. `expiresAt`: the `datetime-local` value is interpreted in the browser's time zone and sent as `new Date(value).toISOString()`; empty -> `null` (clears it).
- Server `400` field messages (`err.fields`) are shown under the matching inputs (`aria-invalid`, `aria-describedby`); other errors appear in one alert. Field names must match the server's keys (`title`, `body`, `categoryId`, `status`, `expiresAt`, `images`).
- Defaults: new notices start as `draft` (accidental publishing is worse than forgetting to publish). `archived` is offered only when editing, so an archived notice can be restored.

## Images in the form
- Flow: alt text first, then choose a file. On selection the browser checks alt not empty, count < 5, type in {jpeg, png, webp}, size <= 10 MB (constants `MAX_IMAGES`, `MAX_IMAGE_BYTES`, `IMAGE_TYPES` mirror `MAX_IMAGES_PER_NOTICE` / `MAX_IMAGE_MB`; the server stays authoritative). Then `POST /api/images` (multipart: `alt`, `file`) uploads immediately, one file per request, sequentially because the input is disabled while uploading.
- The `File` object is appended to the `FormData` untouched: no canvas, no resize, no recompression (decision D7). `api.ts` detects `FormData` and sends it as is with no JSON `Content-Type`, so the browser sets the multipart boundary. If a 401 triggers refresh-and-retry, the same `FormData` is reused (allowed).
- Preview = `<img src="/api/images/:id">`; the uploader can read an unattached image, and `private, no-cache` applies until the notice is public.
- Remove: images uploaded in this session (`isNew`) are deleted immediately with `DELETE /api/images/:id` (they belong to no notice). Images that already belong to the notice are only dropped from the form state; saving the notice makes the server delete their files. If the user abandons the form after uploading, those files stay as unattached uploads until the M8 cleanup script.
- A fixed note under "Images" tells users that originals are stored as-is, including camera data such as location.

## Change password (`pages/account/ChangePassword.tsx`, `sessionStore.changePassword`)
- Browser checks: new password >= 10 characters and matches the repeat (same minimum as the server's `passwordSchema`). Wrong current password comes back as `400` with `fields.current` and is shown by that field.
- `sessionStore.changePassword()` calls `POST /api/auth/password` and then sets `mustChangePassword: false` locally (the server clears it in the same call), saving a `/auth/me` round trip. On success the user goes to `/admin` or `/committee`. The server revokes the user's other sessions but keeps the current one (it uses the refresh cookie from the request).
- `Layout` gained a "Password" link for signed-in users.

## Tests (client)
- New: `pages/committee/Home.test.tsx`, `NoticeEditor.test.tsx`, `pages/account/ChangePassword.test.tsx`; extended `api.test.ts` and `sessionStore.test.ts`. 75 client tests, 89 server tests.
- In fake-server handlers remember that `api()` always passes a `method` (`"GET"` by default); matching on `!init?.method` never matches.
- The test helper `<output data-testid="where">` has the implicit ARIA role `status`; query messages by text, not `getByRole("status")`.
- `jsdom` does not run real uploads; the tests check the `FormData` contents (`file` is the very `File` object chosen, `alt` is set).

## Gotchas and gaps
- No real-browser run yet (Docker/MongoDB unavailable here). First manual pass should cover: create with image -> appears on the public board -> edit/replace image -> archive -> delete.
- Editing is last-write-wins; two tabs editing the same notice overwrite each other.
- Expiry is entered in local time; users in other time zones see the same instant in their own zone.
- Admins use the same committee pages for their own notices (and can open any notice by id); admin-only tools (pin, users, categories, audit) are the next plan.
