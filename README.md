# Digital Notice Board

A college notice board. A committee signs in and posts notices (with images); everyone else reads them live, with no account.

Stack: React 18 + Tailwind + Zustand (client), Express + TypeScript + Mongoose (server), MongoDB, Socket.IO, Docker, GitHub Actions.
Requirements are in `PRD.md`; the design is in `architecture.md`; engineering notes per feature are in `docs/notes/`.

## What each person can do

| Who | How they get in | What they can do |
|---|---|---|
| Viewer (anyone) | Nothing to sign in | Read the board, search, filter by category and date, open a notice and its images. New notices appear without a refresh. |
| Committee member | Account created by an admin; must change the temporary password at first sign-in | Create, edit, archive and delete **their own** notices (draft or published), upload up to 5 images per notice (JPEG, PNG or WebP, 10 MB each, stored byte-for-byte), set an expiry time, change their password. |
| Admin | The first one is created by `npm run seed` | Everything a committee member can do on **any** notice, plus: create committee accounts, disable them, reset passwords, manage categories, pin up to 3 notices to the top, read the audit log. |

Notices that pass their expiry time disappear from the board; the author and admins still see them labelled "Expired". Expired notices are removed for good by the cleanup command (below) after one year.

## Run it for development

```sh
cp .env.example .env        # then replace every CHANGE_ME value
docker compose up -d mongo  # authenticated MongoDB
npm install
npm run seed                # creates the first admin and the default categories
npm run dev                 # starts both: server on :4000, client on :5173
```

Open http://localhost:5173. Sign in with the `SEED_ADMIN_*` values from `.env`; you must set a new password at first sign-in.

## Run everything in Docker

```sh
cp .env.example .env        # replace every CHANGE_ME; use letters and digits only in MONGO_APP_PASSWORD
docker compose up --build   # app on http://localhost:3000, MongoDB behind it
```

The app image contains the API, live updates and the built website on one port. `docker compose ps` shows both services as healthy when the database answers. Create the first admin from your own computer once the database is up (it listens on `127.0.0.1:27017`): set `MONGODB_URI` in `.env` to the `localhost` address and run `npm run seed`.

Inside Docker the app runs in production mode, so login cookies are marked Secure. Chrome, Edge and Firefox accept them on `localhost`; Safari does not. Production mode also trusts one proxy for visitor addresses (right on Render); when run directly like this, do not expose port 3000 to untrusted networks.

## Tests

| Command | What it runs |
|---|---|
| `npm run lint` | ESLint over the whole repository |
| `npm test` | Server tests (real in-memory MongoDB, real sockets) and client tests (React Testing Library). The first run downloads a test MongoDB of several hundred MB. |
| `npm run build` | Type-checks and builds both apps |
| `npm run e2e` | Builds, then drives a real Chromium through the finished app on a throwaway database: posting with an image, live updates in a second window, URL protection, admin pin and audit log, and an accessibility and content-security-policy scan of every main page. The first run downloads Chromium: `npx playwright install chromium`. |

## Pipeline

`.github/workflows/ci.yml` runs on every push and pull request: lint, `npm audit` (fails on high findings), type check, tests and build (`check`); the browser test (`e2e`); then a Docker image build (`image`). On `main` it also pushes the image to GitHub Container Registry as `ghcr.io/<owner>/<repo>`, tagged with the commit and `latest`. The pipeline has not run yet because the repository has no remote; the first push is its first real test.

## Deploy to Render with MongoDB Atlas

1. **Database.** In MongoDB Atlas create a free cluster. Under Database Access add a user `noticeboard_app` with a strong password and the role `readWrite` on the database `noticeboard` only. Under Network Access allow access from anywhere (`0.0.0.0/0`) for a Render free service, or add Render's outbound addresses; the user and password are the protection. Copy the connection string and add the database name and `authSource`: `mongodb+srv://noticeboard_app:<password>@<cluster>/noticeboard?retryWrites=true&w=majority`.
2. **Web service.** On Render choose New, Web Service, connect the repository and pick the Docker runtime (it uses the `Dockerfile` in the repository root). Alternatively point Render at the image published by the pipeline.
3. **Environment variables** (Render, Environment tab). Nothing secret goes in the repository or the image.
   - `MONGODB_URI`: the Atlas string from step 1.
   - `APP_ORIGIN`: the public address Render gives you, for example `https://your-app.onrender.com` (no trailing slash). A wrong value means sign-in and live updates are refused.
   - `JWT_ACCESS_SECRET` and `JWT_REFRESH_PEPPER`: two different random values, each from `openssl rand -base64 32`.
   - Leave `NODE_ENV`, `PORT` and `CLIENT_DIST` alone; the image sets them. Optional: `ACCESS_TOKEN_MINUTES`, `REFRESH_TOKEN_DAYS`, `BCRYPT_COST`, `MAX_IMAGE_MB`, `MAX_IMAGES_PER_NOTICE`.
4. **Health check.** Set the health check path to `/api/health`. It returns 200 only when the database answers.
5. **First admin.** On your own computer put the Atlas string in `MONGODB_URI` (and the `SEED_ADMIN_*` values) in `.env`, make sure your current IP is allowed in Atlas, and run `npm run seed` once.
6. **Check it.** Open the Render address: the board loads. Sign in as the admin, post a notice, and watch it appear in a second window without refreshing (that confirms HTTPS and live updates work).

Render's free tier sleeps after about 15 minutes without visits, so the first visit afterwards is slow and open live connections drop and reconnect. For a demo, open the page a minute before you start.

## Backup, restore and cleanup

Everything (users, notices, images, audit log) is in one MongoDB database, so one backup covers it. With the Docker setup, using the read-only database user `noticeboard_ro` (password `MONGO_RO_PASSWORD` in `.env`):

```sh
mkdir -p backups
docker compose exec mongo mongodump --username noticeboard_ro --password "<MONGO_RO_PASSWORD>" \
  --authenticationDatabase noticeboard --db noticeboard --gzip --archive=/tmp/nb.gz
docker compose cp mongo:/tmp/nb.gz backups/noticeboard-$(date +%F).gz
```

Keep the last 14 backups and store them somewhere other than the same computer (`backups/` is git-ignored). On Atlas, use its snapshot feature instead.

Restore into the running database, replacing what is there (use the administrator user, `nb_admin` with `MONGO_ADMIN_PASSWORD`):

```sh
docker compose cp backups/noticeboard-YYYY-MM-DD.gz mongo:/tmp/nb.gz
docker compose exec mongo mongorestore --username nb_admin --password "<MONGO_ADMIN_PASSWORD>" \
  --authenticationDatabase admin --gzip --archive=/tmp/nb.gz --drop --nsInclude "noticeboard.*"
```

Then open the board to check the notices and images are back. The backup and restore commands have not been run yet on this project (Docker was not available when they were written); try them once before you rely on them.

**Cleanup.** `npm run cleanup` deletes notices that expired more than a year ago (with their images) and uploaded images that were never attached to a notice and are over a day old. It deletes data for good, so take a backup first and preview with `npm run cleanup -- --dry-run`. It reads `MONGODB_URI` from `.env`, so it runs from a computer that can reach the database, not inside the container. Run it about once a month.

## Demo script (about 10 minutes, covers all nine faculty checklist items)

Before you start: `docker compose up -d mongo`, `npm run seed`, `npm run dev`; have two browser windows side by side, both on http://localhost:5173.

1. **Frontend with Tailwind (1 min).** Show the board in window A. Resize the window to show the responsive layout. Point out that every style is a Tailwind class (open `client/src/components/NoticeCard.tsx`).
2. **React and state management (1 min).** Type in the search box and pick a category: the address bar changes and a copied link reproduces the view. Say: the session, the notice list and the live connection status are each a Zustand store (`client/src/store/`).
3. **Authentication and authorisation (2 min).** In window A type `/admin` in the address bar: you are sent to the login page. Sign in as the admin; open Users and create a committee account (temporary password). Sign out, sign in as that account, set the new password, then type `/admin`: the 403 page. Say: the server checks the same rules on every request; the screen guard is only for comfort (`server/tests/matrix.test.ts` tests every route against every role).
4. **REST API (1 min).** In a terminal run `curl http://localhost:4000/api/notices` (works) and `curl http://localhost:4000/api/users` (401). Mention one error format, paging and about 24 endpoints (`architecture.md` Section 7).
5. **Data validation (1 min).** Type `{"$ne":null}` into the search box on the board: it is treated as plain text and the board answers normally. In the notice editor submit an empty title: the field message from the server. Say: Zod checks every input and keys starting with `$` are rejected.
6. **MongoDB and Mongoose (1 min).** `docker compose exec mongo mongosh -u nb_admin -p <MONGO_ADMIN_PASSWORD> --authenticationDatabase admin noticeboard --eval "db.notices.find().limit(1)"`. Show the models in `server/src/models/`. Say: images are stored in MongoDB too (GridFS) and the app connects with a least-privilege user.
7. **Real-time features (Socket.IO) (2 min).** Keep window B on the board. In window A as the committee member create a notice with an image and publish: it appears in window B without a refresh, with the image in full quality. Edit the title, then archive it: window B follows each change. Point at "Live" in the header.
8. **Docker (1 min).** Stop `npm run dev`; run `docker compose up --build`, open http://localhost:3000 and show `docker compose ps` with both services healthy. Show the `Dockerfile`: three stages, runs as the `node` user.
9. **DevOps and deployment (1 min).** Show `.github/workflows/ci.yml` (lint, audit, tests, build, browser test, image) and the Render and Atlas steps above (or the live Render address if you deployed). Mention the health endpoint `/api/health` and the backup commands.

## Known limitations

- A user who must change a temporary password is only stopped by the screen, not by the server, until they change it.
- A disabled user's open session works for up to 15 minutes (the length of an access token); their refresh is refused at once.
- Two admins pinning at the same instant can briefly pin four notices; a pinned notice that expires keeps its pin flag.
- The audit log records what happened and to whom, not the old and new values.
- Photo location data inside uploaded images is kept, because images are stored exactly as uploaded.
- One server instance only (live updates are held in memory). Several copies would need a shared message store such as Redis.
- Automatic accessibility checks pass on every main page, but nobody has yet tested with a screen reader or by keyboard alone; do that before relying on it.
- The Docker image, the Docker run commands and the pipeline were written without Docker or GitHub available on the development machine and have not been run.

## Troubleshooting

- **Port in use** (5173, 4000 or 3000): stop the older process (`npm run dev` left running in another terminal) or change the port.
- **`docker compose` asks for a password variable:** `.env` is missing or a `CHANGE_ME` is left in it.
- **MongoDB passwords changed but old ones still work:** the first start stored them in the `mongo-data` volume; reset with `docker compose down -v` (this deletes all data).
- **Cannot stay signed in on `http://localhost:3000` in Safari:** Safari rejects Secure cookies on plain http; use Chrome, Edge or Firefox, or run behind HTTPS.
- **Sign-in works but live updates say "Reconnecting…":** `APP_ORIGIN` does not match the address in the browser, or a proxy does not pass WebSockets.
- **A page is blank and the console says "blocked by Content Security Policy":** something loads from another site; the policy allows only the app's own address.
