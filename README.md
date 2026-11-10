# Digital Notice Board

A college notice board. A committee signs in and posts notices; everyone else reads them live, with no account.

Stack: React + Tailwind (client), Express + TypeScript (server), MongoDB, Socket.IO.
See `PRD.md` for requirements and `architecture.md` for the design.

## Quick start

```sh
cp .env.example .env        # then replace every CHANGE_ME value
docker compose up -d mongo  # authenticated MongoDB
npm install
npm run dev                 # server on :4000, client on :5173
```

Checks: `npm run lint`, `npm test`, `npm run build`.
