# Notes 08: Docker, pipeline and deployment

## Status of verification
Docker is not installed on the development machine and no Git remote exists. Verified locally: lint, type check, 139 server tests (6 new in `static.test.ts`), builds, and that `docker-compose.yml` and `ci.yml` parse as YAML. **Not run**: `docker build`, `docker compose up`, the image size, the non-root check, the workflow itself. The first real run of each is the test. Expect to fix small things there (see "Likely first-run problems").

## Serving the website (`server/src/app.ts`, `config/env.ts`)
- `CLIENT_DIST` (optional) is the folder with the built website. Unset in development and tests, so nothing changes there; the Dockerfile sets `/app/client/dist`.
- Order matters. The static handlers are registered **before** `limiters.publicReads`, so loading one page (HTML, JS, CSS, icons) does not spend the visitor's 120 reads per minute. The SPA fallback is registered **after** `/api` routes and the `/api` 404, so API errors stay JSON.
- `/assets/*` uses `express.static` with `immutable` and `maxAge: 1y`: Vite names these files with a content hash. Other files in the folder (icon) are served with `index: false`, so `/` is handled by the fallback, not by static.
- Fallback: `GET` for any path not starting with `/api`, `/socket.io/` or `/assets/` sends `index.html` with `Cache-Control: no-cache`, so a deploy is visible on the next load and React Router paths survive refresh. A missing `/assets/x.js` is a plain 404, not HTML (a browser would otherwise try to run HTML as JS).
- Socket.IO is attached to the HTTP server, which handles `/socket.io/` before Express; the exclusion in the regex is defence in depth.

## Dockerfile
- Stage `build` (`node:20-alpine`): copies the three `package.json` files and the lockfile first, `npm ci`, then sources, then `npm run build` (server `tsc`, client `tsc --noEmit && vite build`). Dependency layer is reused unless `package*.json` change.
- Final stage: fresh `node:20-alpine`, `npm ci --omit=dev --workspace=server`, copies only `server/dist` and `client/dist`. All three workspace `package.json` files are copied because the root `workspaces` list names them. Target size under 300 MB; no native modules (`bcryptjs`, not `bcrypt`), so Alpine's musl libc is fine.
- `USER node` (UID 1000, from the official image). The app writes nothing to disk (images live in GridFS), so no writable directories are needed.
- `HEALTHCHECK` uses busybox `wget` against `127.0.0.1:3000/api/health` every 30 s, 5 s timeout, 20 s start period, 3 retries. `/api/health` returns 503 when `isDbHealthy()` fails, so a lost database marks the container unhealthy. It does not restart it by itself; `restart: unless-stopped` only covers exits.
- `NODE_ENV=production` inside the image turns on `Secure` cookies and `trust proxy 1` (see `app.ts`, `lib/cookies.ts`).
- `.dockerignore` removes `.env*` (except the example), `.git`, `docs`, `scripts`, tests and `dist` folders, so secrets and history cannot end up in a layer.

## Compose
- `app` builds the Dockerfile, `env_file: .env`, then `environment:` overrides `NODE_ENV`, `PORT`, `APP_ORIGIN` (`http://localhost:3000`) and `MONGODB_URI` (host `mongo`, user `noticeboard_app`, `authSource=noticeboard`). `depends_on` uses `condition: service_healthy` on the `mongo` health check.
- `MONGO_APP_PASSWORD` is interpolated into a URL; characters like `@ / :` would break it unless percent-encoded. `.env.example` says letters and digits only.
- No seed script is in the image (keeps it small). Seed from the host (`npm run seed`) against `127.0.0.1:27017` or Atlas.

## Pipeline (`.github/workflows/ci.yml`)
- `check` job: Node 20 with npm cache, `npm ci`, lint, `tsc --noEmit` for server and client, tests, build. The MongoDB binary used by `mongodb-memory-server` (several hundred MB) is cached at `node_modules/.cache/mongodb-memory-server`, keyed on `package-lock.json`. If that path is wrong for the library version, the cache simply never hits; nothing breaks.
- `image` job needs `check`. It builds the image on every run, so a broken Dockerfile fails pull requests too. It logs in and pushes `ghcr.io/<owner>/<repo>:<sha>` and `:latest` only for a push to `main` (`PUBLISH` env). Workflow-level permission is `contents: read`; only this job gets `packages: write`. The repository name is lower-cased because registry names must be.
- Layer cache uses GitHub's cache (`type=gha`).
- **Known follow-up:** the `actions/*` and `docker/*` steps are pinned to major version tags, not commit SHAs. Pinning to SHAs (with Dependabot to update them) is better practice for the job that holds `packages: write`. It was not done because SHAs could not be looked up from the development machine and must not be guessed. Do this when the repository is on GitHub.
- Not included: image vulnerability scanning, deploy step (Render builds from the repository itself), test reports.

## Likely first-run problems
- `npm ci --omit=dev --workspace=server` may complain if the lockfile and a workspace `package.json` disagree; fix by rerunning `npm install` locally and committing the lockfile.
- Client `tsc --noEmit` runs in the Docker build with test helper files present (`fakeSocket.ts`, `setupTests.ts` import `vitest`). `.dockerignore` removes `*.test.ts(x)` only, so devDependencies must stay installed in the build stage (they are).
- If sign-in works but the cookie is not kept on `http://localhost:3000`, the browser is rejecting `Secure` cookies on http (Safari). Use Chrome, Edge or Firefox, or an HTTPS proxy.
- The rate limiter keys on `req.ip`; with `trust proxy 1` and no proxy in front, a client can send its own `X-Forwarded-For` and dodge the limits. Acceptable for a local demo only.

## Operating notes
- Memory: one Node process; expect roughly 100 to 150 MB at rest, more during image uploads (each upload is buffered up to `MAX_IMAGE_MB`, 10 MB). Render's free tier (512 MB) is enough for a small board.
- Hashed assets are cached for a year by browsers; `index.html` always revalidates. A CDN is not needed at this scale.
- Render free tier sleeps after about 15 minutes idle: cold start of several seconds, live sockets disconnect and the client reconnects and reloads (Plan 07).
- Monitor: `/api/health` status and response time, container restarts, MongoDB connection errors in the JSON logs.
