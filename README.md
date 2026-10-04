# DealerFocus Training Academy

Training hub with 2 access roles: Admin (full results, progress and usage view + editing) and User (own progress and score log only).

## Log in

- login.html: signup defaults to User; Admin signup needs code DEALER-ADMIN-2026 (change ADMIN_CODE in auth.js).
- Demo accounts: admin@dealerfocus.com / Admin123! and user@dealerfocus.com / User123!
- Admin dashboard: admin-dashboard.html (view/edit all users, set scores, reset progress, export CSV).
- User dashboard: user-dashboard.html (unique per-user log).

## Deploy (Netlify from GitHub)

1. Netlify: Add new site > Import an existing project > GitHub > this repo.
2. Branch: main. Build command: none. Publish directory: . (see netlify.toml).
3. Deploy, then test /login.html as admin and as a new user.

## Production backend (optional)

Front-end v1 stores data per-browser. Run supabase-schema.sql in Supabase for real multi-device Auth + Postgres + RLS (see README-ROLES.md).
