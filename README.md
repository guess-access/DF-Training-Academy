# DealerFocus Training Academy

Training hub hosted entirely on Cloudflare (Pages + Functions + D1). Two access roles:

- **Admin** — sees and edits every user's results, progress and usage (`admin-dashboard.html`).
- **User (staff)** — sees only their own progress and score log (`user-dashboard.html`).

Access control is enforced on the server (`functions/api/[[path]].js`), not in the browser: a staff account
cannot read another user's data or call admin endpoints, whatever the page does.

## Architecture

| Piece | Where |
| --- | --- |
| Static site (HTML/CSS/JS) | Cloudflare Pages, production branch `App` |
| API (`/api/*`) | Pages Functions: `functions/api/[[path]].js` |
| Database | Cloudflare D1, binding name `DB`, tables in `schema.sql` |
| First-admin bootstrap code | Pages secret `ADMIN_CODE` (never stored in the repo) |

**Accounts are admin-only.** There is no public sign-up: only an admin can add or remove users (and reset
their passwords) from the admin dashboard. Staff just log in. The `ADMIN_CODE` secret is used only to create
the very first admin while the users table is empty (e.g. a fresh database); once any user exists, sign-up is
refused with or without the code.

Passwords are hashed with PBKDF2-SHA256 (per-user salt); sessions are random tokens in an HttpOnly cookie.
After 8 wrong passwords an email is locked for 15 minutes.

## Deploy / first-time setup (Cloudflare)

1. **Pages project** `df-training-academy`: connected to this repo, production branch `App`, no build command, output directory `/`. Every push to `App` redeploys.
2. **D1 database**: create one (e.g. `df-training-academy`) and run `schema.sql` in its Console (or `npx wrangler d1 execute df-training-academy --remote --file=schema.sql`).
3. **Bind it**: Pages project > Settings > Bindings > Add > D1 database > variable name `DB` > select the database (Production and Preview).
4. **Bootstrap code** (only needed for an empty database): Pages project > Settings > Variables and Secrets > add a **secret** named `ADMIN_CODE` (long random value).
5. **Redeploy** (Deployments > Retry, or push a commit) so the binding and secret take effect.
6. **First admin** (empty database only): `POST /api/signup` with `{"name","email","password","adminCode"}` creates it. After that, log in at `/login` and use **Admin > + Add user** to create everyone else.

## Local development

```bash
npx wrangler d1 execute DB --local --file=schema.sql   # needs a wrangler.toml or --d1 flag; see Cloudflare docs
printf "ADMIN_CODE=dev-code\n" > .dev.vars
npx wrangler pages dev . --d1=DB
```

## About Us gate (Step 1 for staff)

`about-us.html` holds the About Us video (`assets/about-us-video.mp4`) and records completion on the server.
The player has no seek bar: skipping ahead and speed changes are undone, and playback pauses when the tab is hidden.
The browser sends a heartbeat every few seconds and the **server** decides what counts (`functions/api/[[path]].js`,
`aboutBeat`): only in-order playback at normal speed earns coverage (about 97% of the video must be covered and the
video must finish), and time on the page accrues only while the tab is visible (default minimum 5 minutes).
Skip/fast-forward attempts are counted and shown to admins.

- **Admin dashboard > About Us gate**: turn the gate on/off and set the minimum minutes. While ON, staff can open only Home,
  About Us and My Progress, and the API refuses to record module progress or quiz scores, until at least 50% of the video is watched. At 50% the Next button on About Us opens Module 1. Full completion (97% of the video + minimum time) is still recorded separately.
  Admins are exempt. The gate is OFF by default so a missing video can never lock everyone out.
- Per user: an admin can see About Us status and reset it (**View / edit > Reset About Us**).
- Existing databases need the `about_progress` table and the two settings rows from `schema.sql`.
- Cloudflare Pages allows files up to **25 MiB** (and GitHub 100 MB), so the video is compressed to fit: the current
  file is about 23 MiB, 1280x720, 10 fps, mono audio, H.264 (x264 CRF 31) + AAC with `faststart`. To replace it,
  re-encode the new source to under 25 MiB and overwrite `assets/about-us-video.mp4`; if the length changes, an
  admin should reset About Us progress (the server restarts coverage automatically when the duration differs by
  more than 2 seconds).

## Module pacing: Next unlocks at 50% (`pace.js`)

Inside a module, a Next / forward move stays locked until the **current page is at least 50% complete**. Completion is the
smaller of (a) how far down the page the learner has scrolled and (b) time on the page vs. its estimated reading time
(about 220 words/min, tab visible), so scrolling to the bottom in a second does not unlock it. Backward moves are free.
Staff only; admins are exempt. A "page complete" hint pill shows progress at the bottom-left.

- Covers Module 1 (Next on every lesson + sidebar jumps + Assessment link), Module 2 (Next on both tabs + tabs + Assessment link) and Module 4 / CSR fundamentals
  (Next/Finish + section menu). Add `<script src="pace.js"></script>` after `bridge.js` to cover another interactive page
  (it needs an adapter in `pace.js` for that page's navigation).
- Modules 3, 5 and 6 have one "Next Module" link at the bottom of the page (`data-df-next`; Module 6's goes to My Progress).
  It is paced by that page's own text only: Module 3's training is an outside site (onizoa.github.io) and Module 6 embeds
  `training-1.html`, which is not in the repo, so activity inside those cannot be measured.
- Finished pages are remembered per user in the browser (`localStorage`); this is a pacing aid in the page, not a server
  check like the About Us video.

- **Next Module** (`data-df-next-module`): Modules 1, 2 and 4 also have a button to the next module that unlocks when half of that module's lessons are complete.

## Module completion (automatic)

Modules 1 to 5 are required. Module 6 (Refresher Courses) is optional and does not affect certification.

Staff no longer mark modules done. `pace.js` reports how much of each lesson page has been read; the server stores it in
`module_completion` and works out each module's **Completion Rate** (average of its pages). A module is **Completed** when
the rate is 100% and its assessment score is at or above the Admin pass mark. Modules 3 and 6 have no assessment, so 100%
alone completes them. Assessments on Google Forms (Modules 1, 2) reach the site through **Log score** or an admin's Set score.
Existing databases need the `module_completion` table from `schema.sql`.

## Graduation Certificate (`certificate.js`)

When all five required modules are Completed the server issues one certificate per user (`certificates` table): number, name
and date are fixed at that moment. It appears on My Progress and the Certification page and can be downloaded as PNG or PDF.
The trainer name is set in `certificate.js`. An admin's **Reset progress** removes it. Existing databases need the
`certificates` table from `schema.sql`.

## Notes

- Module 02 and other pages still reference `assets/*.mp4` clips that are not in the repo; add them to `assets/` to enable them.
- Google Form assessments (Module 02) cannot be auto-graded; staff use **Log score** and an admin can verify/edit.
