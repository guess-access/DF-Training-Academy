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

## Notes

- Module videos are referenced as `assets/<name>.mp4` but the video files are not in the repo yet; add them to `assets/` to enable them.
- Google Form assessments (Module 02) cannot be auto-graded; staff use **Log score** and an admin can verify/edit.
