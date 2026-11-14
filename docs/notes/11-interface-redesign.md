# Notes 11: Interface redesign

## Design system (`client/tailwind.config.js`, `client/src/index.css`)
- **Tokens live in the Tailwind theme.** Colours: `paper` (#F4F6F5 page), `ink` (#13233B text and header), `signal` (#1F4BFF actions and focus), `marigold` (#F5B800, only for "Pinned" and the live dot), `line` (#D5DBD8 dividers), `edge` (#7F8B86 input/button borders, 3:1 against white), `muted` (#4A5668 secondary text), and a `cat-*` family (text colour plus `-tint` background) for category and status badges. Every text/background pair is at least 4.5:1; the browser accessibility scan (`e2e/a11y.spec.ts`) enforces this on every main page.
- **The old grey scale was remapped, not removed.** `slate-50 … 900` now point at the same palette (`slate-300` is `edge`, `slate-200` is `line`, `slate-600/500` is `muted`, `slate-800/900` is `ink`). Screens still using `border-slate-200` or `text-slate-600` therefore match the new look without edits. New code should use the named tokens (`line`, `muted`, `ink`) rather than `slate-*`.
- **Fonts:** `@fontsource-variable/bricolage-grotesque` (headings, dates, `font-display`) and `@fontsource-variable/public-sans` (body, `font-sans`), imported in `main.tsx`. They are bundled by Vite into `/assets/*.woff2` and split by alphabet with `unicode-range`, so a Latin-only visitor downloads about 41 KB (Bricolage) plus 27 KB (Public Sans). The CSP from Plan 09 (`font-src 'self'`) is satisfied because nothing comes from Google Fonts. If a font fails to load the system sans font is used. Both families are variable fonts with a weight axis only (the width and optical-size axes are not imported).
- **Shared classes** (`@layer components` in `index.css`): `btn`, `btn-primary`, `btn-quiet`, `btn-danger`, `field`, `field-label`, `panel`, `badge`, `page-title`. Use these instead of long utility strings. A `btn` is `px-4 py-2`; add `px-3 py-1` for a compact one (utilities are emitted after components, so they win).
- **Focus and motion:** one global `:focus-visible` outline (3 px `signal`). A `prefers-reduced-motion: reduce` rule disables all animation and transitions.

## Category colours (`client/src/lib/category.ts`)
`categoryStyle(name)` returns `{ bar, chip }` class names. Exams is red, Events violet, Placements green, General slate; any other name hashes (31-multiplier string hash) into teal, orange or rose, so a new category is coloured stably with no database field. The class names are written out in full in `STYLES` because Tailwind only keeps classes it can find as literal strings in the source. Tests: `lib/category.test.ts`.

## Board (`NoticeCard.tsx`, `Board.tsx`)
- `Board` splits the page's items into `pinned` (up to 3, rendered as `variant="feature"` cards in a `<section aria-label="Pinned notices">`) and `rest` (rows in one bordered list). The server already sorts pinned first, so no re-sorting is done. The pinned section has no visible "Pinned" heading on purpose: the card badge is the only element with the text "Pinned", which the tests rely on.
- A row has an `aria-hidden` date block (day number and short month from `publishedAt`, falling back to `createdAt`), a coloured left bar by category, the chips line (with the full `<time>` text, which is what screen readers read), the title as an `<h2>` link, a two-line excerpt and an optional thumbnail. Thumbnails are never hidden on small screens, because they carry content (alt text). Images are the original files, only scaled with CSS (`object-cover`).
- **Fresh highlight:** `noticesStore.load(query, silent)` compares the ids it receives with the ids already on screen. When it is a silent (live) reload and the page already had items, new ids go into `fresh` for `FRESH_MS` (8 s) and are then removed by a timer. `Board` passes `fresh` to `NoticeCard`, which adds `data-fresh`, a static marigold treatment (ring or tinted background) and the `animate-arrive` slide. The static marker stays for people who disabled animation. The first load and non-live loads never mark anything. Test: `live.test.tsx` ("fresh highlight"; it waits for the real 8 s timer, so it takes about 8 s).
- Filters are one row on `lg` screens via a CSS grid; the dates wrapper uses `lg:contents` so its two fields join the parent grid. On phones the form stacks (about 310 px tall); collapsing it behind a "Filters" disclosure is a possible later improvement.

## Other screens
- `Layout.tsx`: ink header band, wordmark, live pill (dot plus the existing `aria-live` text "Live" / "Reconnecting…"; the `connecting` state renders an empty string so nothing is announced on load), account links, footer sentence.
- Sign-in, change password, notice editor use `panel`; forms keep their field ids and labels, so tests and the e2e flow are unchanged.
- My notices and Users show colour-coded badges: status (published green, draft orange, archived slate), role (admin violet, committee teal), active/disabled, expired and pinned. Colour is never the only signal; every badge has text.
- Admin: `AdminNav` is an underline tab bar (`NavLink` sets `aria-current="page"`); `admin/Home.tsx` is a grid of cards where the heading's `<Link>` is stretched over the card (`after:absolute after:inset-0`), so the link's accessible name stays "Users", "Categories", "Audit log", "My notices". Categories show the board colour as a swatch. The audit table header no longer uses all-caps.

## Verification
- `npm run lint`, `npm test` (117 client tests), `npm run build`, `npm run e2e` (7 browser tests including the accessibility and CSP scan) pass.
- Screenshots were taken at 1280 px and 390 px against the Docker stack with the demo data (`npm run seed:demo`) and reviewed by eye. They are not stored in the repository. Only a few screens were checked at phone width (board, committee list); the editor, users and categories screens were checked on desktop only.
- Public bundle: JS 79.5 KB gzipped (was 72.5 KB before Plan 07 additions plus this work), CSS 5 KB, fonts about 68 KB once per visitor. Budget is 300 KB.

## Gotchas
- A Tailwind class built from a variable (`bg-${colour}`) is silently dropped from the build; keep literal class names (see `category.ts`).
- The stretched-link cards on the admin overview rely on the `<li>` being `relative`; removing that makes the whole page clickable.
- The seeded demo data makes layout problems visible (long titles, many pinned notices, images); use `npm run seed:demo` when reviewing UI changes.
- Dark mode is out of scope (PRD).

## Follow-up details (after the first review)
- **Filters fold away on phones.** `Filters.tsx` keeps Search always visible; category and dates sit in `#filter-fields`, which is `hidden` below `sm` until the "Filters" button (`aria-expanded`, `aria-controls`) opens it, and `sm:contents` puts the fields back into the form grid from `sm` up. It starts open when category or dates are already in the address, and the button shows the count ("Filters (2)"). Tests find the fields by label, which works with the fields folded because they stay in the DOM.
- **Sign out lands on the board.** `Layout` navigates to `/` with router state `{ signedOut: true }` before calling `logout()`; otherwise the route guard would redirect the emptied session to `/login` first. `Board` shows "You have been signed out." (`role="status"`) from that state. The header always has a "Notice board" link, and the sign-in page has "Back to the notice board".
- **Small details:** per-page tab titles through `lib/useTitle.ts` ("Users · Digital Notice Board"), an SVG favicon (`client/public/favicon.svg`) plus description and theme colour in `index.html`, scroll to top on route change (`ScrollToTop` in `App.tsx`; `window.scrollTo` is stubbed in `setupTests.ts` because jsdom does not implement it), a "Show password" checkbox on sign-in, and the live pill is invisible (not removed) while the socket is still connecting, so the `aria-live` region stays in place.
- **e2e:** `getByLabel("Password")` now also matches "Show password", so the sign-in helper uses `{ exact: true }`.
- **One admin.** The demo seed no longer creates admins; the single admin is the account from `npm run seed`.

- **Header on phones.** The wordmark link shows only the board icon below `sm` (the name is `aria-label` on the link and the visible text is `hidden sm:inline`), so the header stays on one line with the Live pill and the account links. From `sm` up the icon and the full name are shown.
