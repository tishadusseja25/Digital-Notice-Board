# Notes 07: Live updates with Socket.IO

## Shape
Server pushes only. Clients cannot send anything meaningful: `realtime/socket.ts` registers no handler for incoming events, and `maxHttpBufferSize` is 10 000 bytes. The client treats every event as "something changed, reload" except `notice:removed` on the detail page.

| Event | Room | Payload |
|---|---|---|
| `notice:created` | `public` | public notice DTO (`toDto(n, false)`) |
| `notice:updated` | `public` | public notice DTO (edits and pin/unpin) |
| `notice:removed` | `public` | `{ id }` |
| `notice:changed` | `user:<authorId>` and `admin` | staff DTO (adds `status`, `authorId`) |

## Server
- `server/src/realtime/socket.ts` `attachSocket(httpServer, env, connectionsPerMinute?)` is called from `index.ts`, which now creates the HTTP server explicitly. It returns the `io` instance and registers it with `events.ts` (`setIo`).
- **Origin**: `allowRequest` refuses any request whose `Origin` header is present and not `APP_ORIGIN`. A missing Origin is allowed (curl, `socket.io-client` in tests); browsers always send one on WebSocket, and a non-browser client has no victim cookie. No CORS headers are sent.
- **Rate limit**: `io.use` consumes one point per connection from a `RateLimiterMemory` (`LIMITS.socketConnectionsPerMinute` = 20 per minute per IP, in `middleware/rateLimit.ts`). It is not in `allowRequest`, because that runs for every polling request, not once per connection. In production the IP is the last `X-Forwarded-For` entry (same trust-one-proxy rule as `app.ts`). The `connectionsPerMinute` argument exists only so tests can run many connections.
- **Auth**: the `nb_access` cookie is read from the handshake header with a small regex (no cookie library needed) and checked with the existing `verifyAccessToken`. Anything invalid means a public-only socket, not an error. Rooms: everyone `public`; committee `user:<id>`; admin `admin` and `user:<id>`.
- **Expiry**: one `setTimeout` per authenticated socket, to the token's `exp` (decoded with `jwt.decode` after verification), calls `socket.disconnect(true)`; cleared on disconnect. Anonymous sockets have no timer. `disconnect(true)` closes the transport and gives the client reason `io server disconnect`.
- **Emitting**: `realtime/events.ts` holds a module-level `io` (null in unit tests and scripts, so `announceNotice` is a no-op). `noticeService.announce(notice, wasPublic)` builds both DTOs and compares `wasPublic` (captured with `isPubliclyVisible` before mutation) with `isPubliclyVisible(notice)` after. not-public to public: `created`; public to public: `updated`; public to not-public: `removed`; `notice:changed` always goes to the author and admin rooms. It runs after the database write and the audit entry, and `announceNotice` catches its own errors so a socket problem cannot fail a request.
- Hooks: `createNotice`, `updateNotice`, `removeNotice` (archive and delete) and `setPinned` (only when the pin actually changed).

## Client
- `client/src/lib/socket.ts`: one `socket.io-client` connection (`io()` with no URL, same origin, cookie sent by the browser). `restartSocket()` closes any old socket and opens a new one; `App.tsx` calls it when the session status becomes `ready` and again when the signed-in user id changes, so the server re-assigns rooms after sign-in and sign-out. `stopSocket` is the effect cleanup.
- `useLiveStore.status`: `connecting` (renders nothing, so a screen reader hears no announcement on page load), `live`, `offline`. `Layout.tsx` shows it in an `aria-live="polite"` span.
- `subscribeLive(listener)` fans events out to pages. `reconnected` is emitted when `connect` fires after an earlier `connect`, because events during the gap are lost.
- On `io server disconnect` (token expiry) the client does not retry by itself: it calls `api("/auth/me")` (which silently refreshes on a 401) and then `socket.connect()` whatever the result; if the session is gone it reconnects as a public socket.
- `noticesStore`: `load(query, silent)` remembers the last query. `reload()` debounces 300 ms then does a silent `load`, so a burst of events costs one request and the list never flashes a spinner or an error. `dropExpired()` runs every 30 s from `Board.tsx` and removes items whose `expiresAt` has passed.
- Detail page marks the notice gone on `notice:removed` for its id. `committee/Home.tsx` reloads on `notice:changed` and `reconnected`.
- Reload instead of patching cards: with search, category, date and page filters, deciding whether a new card belongs on the current page would duplicate the server's query logic. The cost is one list request per burst per open board.

## Tests
- Server: `tests/realtime.test.ts` (real `socket.io-client` against `http.createServer(createApp(...))`; rooms, forged and expired tokens, Origin, disconnect at expiry, ignored client messages, event routing per room, no private fields in public payloads, drafts reach nobody but author and admin) and `tests/realtime.limits.test.ts` (the connection limit; separate file because it replaces the module-level `io`).
- Client: `src/live.test.tsx`. `socket.io-client` is mocked for every client test in `setupTests.ts` with `src/fakeSocket.ts`, so no test opens a real connection; use `lastSocket().trigger(event, data)` to play a server event.

## Limits and gotchas
- Single instance: rooms are in memory. A second app instance would need the Redis adapter.
- A disabled user's open socket lasts until the access token expires (up to 15 minutes) and then fails to refresh. No instant kick.
- Nothing is sent when a notice expires on the server; boards rely on the 30 s sweep. An author sees the "Expired" label on the next reload.
- A connection refused by the rate limiter or by a middleware error does not auto-reconnect (Socket.IO treats it as fatal). The status stays "Reconnecting…" until the page is reloaded. Rare at 20 per minute per IP, but a school network behind one NAT could hit it; raise `socketConnectionsPerMinute` if so.
- `maxHttpBufferSize` also bounds what a hostile client can make the server buffer per message.
- Monitor: connected socket count (`io.engine.clientsCount`), and 429s on `GET /api/notices` right after a publish (a large audience reloading at once is the main extra load).
- Not run against a real browser or proxy yet (Docker unavailable): the Vite dev proxy for `/socket.io` and Render's WebSocket support are untested.
- Public bundle: 72.5 KB gzipped (was 59.0 KB), mostly `socket.io-client`.
