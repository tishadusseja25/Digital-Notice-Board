# Notes 03: Notices and images API

## Pieces and how they connect
- `models/Notice.ts`: one document per notice. `images` is an embedded array of `{ fileId, alt }`; the bytes live in GridFS. `authorId` drives every ownership check. `publishedAt` is set once, on the first transition to `published`.
- `lib/visibility.ts`: `publicNoticeFilter()` (MongoDB filter) and `isPubliclyVisible()` (same rule for a loaded document) define "public" = `status = published` and (`expiresAt` null or in the future). Every public read goes through one of them. Change the rule in this file only.
- `lib/access.ts`: `Caller` type and `canManage(notice, caller)` (author or admin). Lives in `lib` because both `noticeService` and `imageService` need it and importing one service from the other created a cycle.
- `services/noticeService.ts`: create, `getNotice`, update, `removeNotice`, `listMine`, `listPublic`. `toDto(notice, staff)` is the only serializer: public shape omits `authorId` and `status`.
- `services/imageService.ts`: upload, serve, delete, and the attach helpers used by the notice service (`checkAttachable`, `attachImages`, `deleteFiles`).
- Routes: `routes/notices.ts` (list, read, create, patch, delete), `routes/me.ts` (`GET /api/me/notices`), `routes/images.ts`, `routes/categories.ts` (read only). `createApp(env)` mounts them after the global guards from Plan 02.

## Access rules (what returns what)
- Read one notice: public notice -> anyone. Not public -> author/admin get it, everyone else gets 404 (so draft ids are not confirmed to exist). Malformed id -> 404.
- Edit/delete: unknown id -> 404; exists but caller is not author/admin -> 403 (FR-10, FR-11). Committee needs a token (401 otherwise).
- Images mirror the notice they sit on: public notice -> anyone; otherwise author/admin; not attached to any notice yet -> uploader/admin only. Everyone else gets 404. Delete: uploader, notice author or admin; others 403.
- `pinned` cannot be set through the API yet (`.strict()` schemas reject it); the pin endpoint is M5.

## Images
- Type detection: `fileTypeFromBuffer` reads magic bytes. Allowed: `image/jpeg`, `image/png`, `image/webp`. The client's filename and `Content-Type` are ignored. SVG, HTML, PDF and plain text are refused (400, `fields.file`).
- Stored as received: `bucket().openUploadStream(...)` receives the original `Buffer`; nothing decodes or re-encodes it. Metadata on the `images.files` document: `uploaderId`, `contentType`, `sha256`, `alt`, `noticeId` (null until attached). Filename is `<uuid>.<ext>`, never the user's name.
- Upload path: `staff` role check -> `multer` (memory storage, `fileSize = MAX_IMAGE_MB` MB, one file, 4 fields, 6 parts) -> validation of `alt` -> `uploadImage`. The role check runs before multer so anonymous callers cost no buffering. Over the cap -> multer error -> 413 `FILE_TOO_LARGE` (mapped in `middleware/errorHandler.ts`); other multer errors -> 400 `BAD_UPLOAD`.
- Serving: headers `Content-Type` (stored, verified type), `Content-Length`, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, `Content-Security-Policy: default-src 'none'; sandbox`, `ETag: "<sha256>"`. `If-None-Match` equal to the ETag -> 304 with no body read. Public images: `Cache-Control: public, max-age=31536000, immutable`; private ones: `private, no-cache`. An image id never changes content, which is what makes the year-long cache safe. Caveat: after a notice is archived or expired, copies already in browser or proxy caches stay valid until their max-age ends.
- Attaching: a notice create/patch lists `images: [{ fileId, alt }]`. `checkAttachable` verifies (max `MAX_IMAGES_PER_NOTICE`, no duplicates, file exists, uploaded by the caller unless admin, not used by another notice). `attachImages` then sets `metadata.noticeId`. A PATCH with `images` replaces the list; files no longer listed are deleted from GridFS. Deleting a notice (`mode=delete`) deletes its files; archiving keeps them.
- No transaction spans the notice write and the GridFS metadata update. A crash between them leaves an image with `noticeId: null` that is still referenced by a notice (the notice still serves it only to staff). Low probability; the M8 cleanup script should reconcile.

## Search and the board query
- `listPublic` builds: `publicNoticeFilter()` + optional `categoryId` + optional `$text` + optional `publishedAt` range, sorted `{ pinned: -1, publishedAt: -1 }`, `skip/limit`, plus a `countDocuments` with the same filter.
- `Notice` has a text index (`title` weight 3, `body` weight 1). The search string is the `$search` value only: `trusted({ $search: q })`. MongoDB text search treats `"quoted phrases"` and `-negated` words specially; that is allowed. Text search is stemmed English, no typo tolerance, and the sort is not by relevance (pinned and date win).
- Why `trusted()` appears: Mongoose is configured with `sanitizeFilter: true`, which neutralises every `$operator` in a filter. Operators the server writes (`$text`, `$gt`, `$gte`, `$lte`) must be wrapped. Never wrap a value that comes from a request.
- Query validation (`listQuery` in `routes/notices.ts`): strict (unknown keys -> 400), `q` 1-100 chars, `category` valid id, `from`/`to` either `YYYY-MM-DD` (`from` = start of that day UTC, `to` = end of that day UTC) or an ISO timestamp, `from <= to`, `page` 1-10000, `limit` 1-50 (default 20). `rejectOperatorKeys` (Plan 02) already turns `?q[$ne]=1` into 400 before this.

## Performance and limits
- List cost: the board query uses `{ status, pinned, publishedAt }`; with `$text` MongoDB uses the text index and filters/sorts the matches in memory. Page cap of 50 bounds the response. Each item includes the full body (up to 5000 chars), so a worst-case page is about 250 KB; default 20 items about 100 KB. If the board gets heavy, add a truncated `excerpt` to list items and keep the full body for the detail route.
- `countDocuments` runs on every list call (one extra index scan). Fine at this size; replace with "has next page" logic if the collection grows large.
- Memory: an upload is held in memory for its whole request (up to 10 MB, for as many requests as run at once). The write limiter (30/min per user) and role check bound the load. Move multer to disk or stream straight into GridFS if concurrency grows.
- GridFS chunks are 255 KB, so a 10 MB image is about 40 chunk documents. Serving streams chunk by chunk; the process never holds a whole image on the download path.
- Test files use unique database names; `connectTestDb` now awaits `Model.init()` for every registered model so unique and text indexes exist before the first query. In production Mongoose builds indexes in the background at startup (`autoIndex` default); on a large collection, build them in advance and set `autoIndex: false`.
- Monitor: 413 and 400 counts on `POST /api/images`, GridFS storage size (`images.files`/`images.chunks`), and 5xx on `GET /api/images/:id`.

## Gotchas
- `GET /api/notices/:id` returns the staff shape (with `status`, `authorId`) when the caller is the author or an admin, even for public notices.
- `PATCH` with `expiresAt: null` clears the expiry; omitting the key leaves it alone. A past `expiresAt` is rejected on create and edit, but a notice that later expires on its own can still be edited by its author.
- Express 4: each async handler is wrapped with `wrap()`. The `/:id` route is declared after `/` so `GET /api/notices` is never mistaken for an id.
- Unattached uploads are not cleaned up yet (planned for the M8 cleanup script: files with `noticeId: null` older than 24 h).
- Original bytes include metadata such as GPS in photos. Accepted by decision D7; the upload form (M5) must warn the user.
- Still unverified against the real authenticated MongoDB from `docker-compose.yml` (Docker is not installed): GridFS, text search and index builds ran only on the in-memory server.
