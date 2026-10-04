# DealerFocus Training Academy — 2 roles (Admin / User)

Built from your deployed site + Drive structure. Deploy folder: `dealerfocus-training/app`.

## What was added (recommended: Supabase-ready, works today with no server)

- `auth.js` — login/signup, sessions, per-user progress/scores/usage, admin guards.
  Seed accounts: `admin@dealerfocus.com / Admin123!`, `user@dealerfocus.com / User123!`
  Admin signup code: `DEALER-ADMIN-2026` (change `ADMIN_CODE` in auth.js).
- `login.html` — login + signup (role = user unless valid admin code).
- `user-dashboard.html` — unique log per user: modules done, best score, full attempt history, usage. Users see ONLY their own.
- `admin-dashboard.html` — all users table, search/filter, per-user detail, editing rights:
  set role, set quiz score, reset progress, delete user, change pass %, export CSV.
- `bridge.js` — injected on every module page: floating tracker (Mark done / Log score / Dashboard),
  auto-hooks Module 01 `gradeQuiz()` and Module 05 `submitQuiz()` into per-user logs,
  migrates legacy `dfCert_v1` into the logged-in user on first login.
- `supabase-schema.sql` — production backend (Auth + Postgres + RLS) when ready for multi-device.

## Admin vs User

- Admin: `admin-dashboard.html` (guarded; non-admins redirect to login). Sees results, progress, usage for ALL users + edit.
- User: `user-dashboard.html` (guarded; logged-out redirects to login). Sees ONLY own logs.

## Deploy (Netlify, same as now)

1. Drag-drop `dealerfocus-training/app` to Netlify or set publish dir to it.
2. Test: open `/login.html`, log in as admin, open `/admin-dashboard.html`; sign up a new user, complete Module 01 quiz, mark modules, check both dashboards.

## Production upgrade (Supabase)

1. Create Supabase project → SQL editor → run `supabase-schema.sql`.
2. Enable Email auth. Sign up admin, then `update profiles set role='admin' where email='...'`.
3. Install `@supabase/supabase-js`, replace localStorage helpers in `auth.js` with Supabase calls (tables map 1:1: profiles/progress/attempts/usage_events/settings).

## Notes / limits of front-end v1

- Passwords are SHA-256 in localStorage (demo-grade). Real security = Supabase Auth.
- Data is per-browser until Supabase migration (documented above).
- Google Form assessments (Module 02) can't auto-grade → users Log score manually, admin verifies/edits.
