# Digital Notice Board

A college notice board. A committee signs in and posts notices; everyone else reads them live, with no account.

Stack: React + Tailwind (client), Express + TypeScript (server), MongoDB, Socket.IO.
See `PRD.md` for requirements and `architecture.md` for the design.

## Run it for development

```sh
cp .env.example .env        # then replace every CHANGE_ME value
docker compose up -d mongo  # authenticated MongoDB
npm install
npm run seed                # creates the first admin and the default categories
npm run dev                 # starts both: server on :4000, client on :5173
```

Open http://localhost:5173. Sign in with the `SEED_ADMIN_*` values from `.env`; you must set a new password at first sign-in.

Checks: `npm run lint`, `npm test`, `npm run build`.

## Run everything in Docker

```sh
cp .env.example .env        # replace every CHANGE_ME value; use letters and digits only in MONGO_APP_PASSWORD
docker compose up --build   # app on http://localhost:3000, MongoDB behind it
```

The app image contains the API, live updates and the built website on one port. `docker compose ps` shows both services as healthy when the database answers. Create the first admin from your own computer once the database is up (it listens on `127.0.0.1:27017`): set `MONGODB_URI` in `.env` to the `localhost` address and run `npm run seed`.

Notes: inside Docker the app runs in production mode, so login cookies are marked Secure. Chrome, Edge and Firefox accept them on `localhost`; Safari does not. Production mode also trusts one proxy for visitor addresses (right on Render); when run directly like this, do not expose port 3000 to untrusted networks.

## Pipeline

`.github/workflows/ci.yml` runs on every push and pull request: lint, type check, tests, build, then a Docker image build. On `main` it also pushes the image to GitHub Container Registry as `ghcr.io/<owner>/<repo>` tagged with the commit and `latest`.

## Deploy to Render with MongoDB Atlas

1. **Database.** In MongoDB Atlas create a free cluster. Under Database Access add a user `noticeboard_app` with a strong password and the role `readWrite` on the database `noticeboard` only. Under Network Access allow access from anywhere (`0.0.0.0/0`) for a Render free service, or add Render's outbound addresses; the user and password are the protection. Copy the connection string and add the database name and `authSource`: `mongodb+srv://noticeboard_app:<password>@<cluster>/noticeboard?retryWrites=true&w=majority`.
2. **Web service.** On Render choose New, Web Service, connect the repository and pick the Docker runtime (it uses the `Dockerfile` in the repository root). Alternatively point Render at the image published by the pipeline.
3. **Environment variables** (Render, Environment tab). Nothing secret goes in the repository or the image.
   - `MONGODB_URI`: the Atlas string from step 1.
   - `APP_ORIGIN`: the public address Render gives you, for example `https://your-app.onrender.com` (no trailing slash). Wrong value means sign-in and live updates are refused.
   - `JWT_ACCESS_SECRET` and `JWT_REFRESH_PEPPER`: two different random values, each from `openssl rand -base64 32`.
   - Leave `NODE_ENV`, `PORT` and `CLIENT_DIST` alone; the image sets them. Optional: `ACCESS_TOKEN_MINUTES`, `REFRESH_TOKEN_DAYS`, `BCRYPT_COST`, `MAX_IMAGE_MB`, `MAX_IMAGES_PER_NOTICE`.
4. **Health check.** Set the health check path to `/api/health`. It returns 200 only when the database answers.
5. **First admin.** On your own computer put the Atlas string in `MONGODB_URI` (and the `SEED_ADMIN_*` values) in `.env`, make sure your current IP is allowed in Atlas, and run `npm run seed` once.
6. **Check it.** Open the Render address: the board loads. Sign in as the admin, post a notice, and watch it appear in a second window without refreshing (that confirms HTTPS and live updates work).

Render's free tier sleeps after about 15 minutes without visits, so the first visit afterwards is slow and open live connections drop and reconnect. For a demo, open the page a minute before you start.
