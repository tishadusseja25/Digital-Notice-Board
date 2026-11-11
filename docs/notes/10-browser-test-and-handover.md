# Notes 10: Browser test, accessibility scan, pipeline, README

## Browser test layout
- `playwright.config.ts`: one Chromium project, `workers: 1` (all tests share one server and database), 30 s per test, 7 s per assertion, `webServer` runs `npx tsx e2e/server.ts` and waits for `http://localhost:4100/api/health` (120 s allowed; the first run may download the test MongoDB). `reuseExistingServer: false` so a stale server never answers.
- `e2e/server.ts` is production minus Docker: `NODE_ENV=production`, `CLIENT_DIST=client/dist`, `APP_ORIGIN=http://localhost:4100`, `createApp(env)` + `attachSocket` on a plain HTTP server, `mongodb-memory-server` as the database, and users/categories inserted directly (`mustChangePassword: false`, bcrypt cost 4). It runs the same helmet headers, static serving and SPA fallback as the image, which is what makes it a CSP test. It imports server TypeScript through `tsx`, not `server/dist`.
- `npm run e2e` = `npm run build && playwright test`; the build is needed because the test serves `client/dist`. Chromium comes from `npx playwright install chromium` (about 125 MB, cached in `~/.cache/ms-playwright`, on Windows `%LOCALAPPDATA%\ms-playwright`).
- `e2e/helpers.ts`: constants, `signIn`, `createNoticeViaApi` (needs an `Origin` header equal to `APP_ORIGIN`, as the server's CSRF check requires), and `watchProblems`, which records console messages matching `content security policy|refused to|blocked` and any `pageerror`.

## What the tests prove
- `flow.spec.ts` (serial): a viewer window opened first sees a notice created by the committee member appear, edit and disappear/"no longer available" with no reload (socket path through the real proxy-less server); the image has `naturalWidth > 0`; search narrows the live board; anonymous visitors to `/admin`, `/admin/users`, `/committee`, `/committee/new` land on `/login`; API calls without a cookie get 401; a committee member gets the 403 page and a 403 from `/api/users`; a wrong password shows "Invalid email or password."; an admin pins a notice and the audit table shows `notice.pin`, `notice.create`, `login.success`. The viewer window also asserts that no CSP problem was reported.
- `a11y.spec.ts`: `@axe-core/playwright` with tags `wcag2a, wcag2aa, wcag21a, wcag21aa` on `/`, a notice, `/login`, the 404 page, `/committee`, `/committee/new`, `/account/password`, `/admin` and its three pages; each page must also produce no blocked-resource or CSP console message. The scan found no violations, so no client code changed. Checked once that axe does report problems on a deliberately bad page (missing alt text and label were detected), so a clean result is meaningful.
- Gotchas: tests share the database, so they must not assume an empty board or a single row; they filter list rows by title. Live updates are awaited with Playwright's retrying assertions (7 s), not fixed sleeps. Rate limits (120 reads/min per IP, 5 failed logins per IP+email) are per server process and the whole suite stays under them; adding many more page loads or failed logins in one minute could trip them.
- Not covered: Firefox/Safari, mobile viewports, keyboard-only use and screen readers (automatic rules find only part of the issues).

## Pipeline changes (`.github/workflows/ci.yml`)
- `check` now also runs `npm audit --omit=dev --audit-level=high`, which fails on high or critical findings in shipped code. Dev-tool findings (Vite/Vitest chain) are not in scope of this step.
- New `e2e` job (needs `check`): `npm ci`, cache of the test MongoDB binary and Playwright browsers keyed on the lockfile, `npx playwright install --with-deps chromium`, `npm run e2e`. `image` now needs both `check` and `e2e`, so a failing browser test blocks publishing.
- All five third-party actions are pinned to full commit IDs with the version tag as a comment. The IDs were read from the GitHub API (`git/ref/tags/<tag>`, dereferenced if an annotated tag) at implementation time. Update them with Dependabot or by repeating that lookup; `actions/checkout@v4` etc. are moving tags, so the pinned commit is the one the tag pointed to then.
- The workflow has never run (no remote). Likely first-run issues: `--with-deps` needs `sudo`, which `ubuntu-latest` provides; the Playwright cache path `~/.cache/ms-playwright` is the Linux default.

## README and Definition of done
- `README.md` is the hand-over document: roles table, development and Docker runs, test commands, pipeline, Render + Atlas guide, backup/restore, cleanup, the 9-step demo script, known limitations, troubleshooting. Backup uses `mongodump --archive --gzip` through `docker compose exec` with the read-only `noticeboard_ro` user; restore uses `mongorestore --drop --nsInclude "noticeboard.*"` with `nb_admin`. These commands were not run (no Docker for the tooling); the README says so.
- `PRD.md` Section 11: ticked items that were verified; left unticked, with a reason in the line: faculty checklist demonstrable (Docker and deployment not yet run), Docker image builds and runs, least-privilege database user (not run against a real authenticated MongoDB). "No attribution anywhere" holds for history and files; the prohibited file names appear only in `.gitignore` and `PRD.md` as rules.

## Remaining work for the owner
- Install and run: `docker compose up --build`, then fix whatever the first real image build, authenticated MongoDB (GridFS, text index, collation indexes) and backup/restore runs reveal.
- Push to GitHub to run the pipeline for the first time.
- Keyboard-only and screen-reader pass.
- Optional: enforce the temporary-password rule on the server.
