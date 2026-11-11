# Notes 06: Admin area

## Endpoints added (all admin-only unless stated)
| Endpoint | Behaviour |
|---|---|
| `GET /api/users?page&limit` | Paged, newest first, shape from `adminUserDto()` (no hashes). |
| `POST /api/users` | `{ name, email, role, password>=10 }`, strict schema. Stored with `mustChangePassword: true`. Duplicate email (unique index, error code 11000) -> 409 with `fields.email`. |
| `PATCH /api/users/:id` | Any of `{ role, active, password }`. 404 for unknown/malformed id, 400 for an empty or unknown-key body. |
| `POST /api/notices/:id/pin` | `{ pinned: boolean }`. |
| `POST /api/categories`, `PATCH /api/categories/:id`, `DELETE /api/categories/:id` | `GET /api/categories` stays public. |
| `GET /api/audit?page&limit` | Read-only. No write routes exist; tests assert POST/PATCH/DELETE answer 404/405. |
`requireRole("admin")` is applied per route (categories, pin, audit) or router-wide (`routes/users.ts` uses `router.use`).

## Users (`services/userService.ts`)
- Self-protection: if the target is the caller, any change returns 409 `CANNOT_CHANGE_SELF`. This guarantees at least the caller stays an enabled admin. It does not stop two admins from disabling each other; there is no "last admin" count check.
- Disable and password reset set `endSessions` and run `RefreshToken.updateMany({ userId }, { revoked: true })`. Already-issued access tokens (15 min, `ACCESS_TOKEN_MINUTES`) keep working until they expire because `authenticate` does not query the user. A role change reaches the user at their next refresh or sign-in, since `signAccessToken` reads the role from the database when issuing.
- Password reset stores the new hash (bcrypt `BCRYPT_COST`, 12 in production, about 0.25 s of CPU) and sets `mustChangePassword: true`.
- Audit actions written per effective change: `user.create`, `user.role`, `user.disable`, `user.enable`, `user.reset_password`. A PATCH that changes nothing writes nothing. There is no details field in `AuditLog`, so the audit row says what happened and to whom (`targetId`) but not the old/new value.
- No delete: notices reference `authorId`, and an audit trail needs the person to still exist.

## Pinning (`noticeService.setPinned`)
- Only notices that pass `isPubliclyVisible` (published and not expired) can be pinned: 409 `NOT_PUBLISHED` otherwise. At most `MAX_PINNED = 3` publicly visible notices can be pinned: 409 `PIN_LIMIT` for the fourth. Pinning an already pinned notice and unpinning an unpinned one are no-ops (no audit row).
- `updateNotice` clears `pinned` whenever the resulting status is not `published`, and archiving via `removeNotice` clears it too. Editing other fields keeps the pin.
- The limit is a count-then-update, so two simultaneous pins could exceed three; with admins only and a 30-write/min limit this is accepted. Edge case: a pinned notice that expires keeps `pinned: true`; it does not count toward the limit (the count uses `publicNoticeFilter()`), so clearing its expiry later could show four pinned notices. The board still sorts correctly (`{ pinned: -1, publishedAt: -1 }`).
- `pinned` cannot be set through create/patch (`.strict()` schemas reject it); tests cover this.
- Audit: `notice.pin`, `notice.unpin`.

## Categories (`services/categoryService.ts`)
- Names trimmed, 1 to 40 characters. The unique index uses collation `{ locale: "en", strength: 2 }`, so "exams" clashes with "Exams" (409 `CONFLICT`, `fields.name`). Renaming to a different letter case of itself is allowed.
- Delete checks `Notice.exists({ categoryId })` and refuses with 409 `CATEGORY_IN_USE`. The check is not atomic with the delete; a notice created in between would keep a dangling category id. Low risk because only admins delete categories.
- Audit: `category.create`, `category.rename`, `category.delete`.

## Audit list (`auditService.listAudit`)
- Sorted by `at` descending (TTL index on `at`, 365 days), `skip/limit` paging (max 50) plus `countDocuments`, and one `populate("actorId", "name email")` per page. `actor` is `null` for failed sign-ins (no actor id) and for actors whose user record no longer exists.
- Response never contains secrets: the model stores only action, ids and IP.

## Client
- Routes: `/admin` (index), `/admin/users`, `/admin/categories`, `/admin/audit`, all under `GuardedOutlet roles={["admin"]}` and the shared `components/AdminNav.tsx` (tab bar + `<Outlet/>`). All pages are lazy chunks (Users 2.1 KB, Categories 1.3 KB gzip); public bundle is 59.0 KB gzip.
- `pages/admin/Users.tsx`: create form (temporary password is a visible text field on purpose, the admin must read it out), per-row actions held in `pending: { id, kind }` (disable and role change need a second click; reset opens an inline password form, minimum 10 characters checked before any request). The signed-in admin's own row shows no actions. Server messages are shown in the page alert or beside the create-form field.
- `pages/admin/Categories.tsx`: reads the public list, add/rename/delete with the same two-step pattern; server 409 messages are displayed as they come.
- `pages/admin/Audit.tsx`: table with `<caption class="sr-only">` and column headers (`scope="col"`), target shown as type + last 6 characters of the id.
- `pages/committee/Home.tsx` (My notices): admins see Pin on published non-expired notices and Unpin on pinned ones; everyone sees the Pinned badge. The old `run` helper became `act(work)` so archive, delete and pin share the busy/error/reload handling.

## Tests
- Server: `users.test.ts`, `categories.test.ts`, `pin.test.ts`, `audit.test.ts` (31 new tests; 120 total). Each endpoint is called as anonymous (401), committee (403) and admin.
- Client: `Users.test.tsx`, `Categories.test.tsx`, `Audit.test.tsx` and new cases in `committee/Home.test.tsx` (103 client tests in total).
- Fake-server handlers receive `init.method` as an explicit string ("GET" by default).

## Gotchas and gaps
- No real MongoDB/browser run yet (Docker unavailable): the new unique-index and collation behaviour was exercised only on the in-memory server.
- The audit log has no filter or search; entries are only viewable newest-first by page.
- Temporary passwords are never emailed; the success banner after creating or resetting reminds the admin to pass them on.
- A shell tip for future edits: complex multi-line edits passed through `node -e` break on apostrophes; use the editor tool for files containing quotes.
