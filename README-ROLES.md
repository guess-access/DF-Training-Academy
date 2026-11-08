# Roles (Admin / User)

- **Admin**: `admin-dashboard.html`. All users' results, progress and usage; **add and remove users**, reset
  passwords, set quiz scores, reset progress, promote/demote, change the pass mark, export CSV. Only admins can
  create or delete accounts (there is no public sign-up). The last remaining admin cannot be demoted, and
  an admin cannot delete themselves.
- **User**: `user-dashboard.html`. Own modules, best score, attempt history and usage only.

Enforcement is in the API (`functions/api/[[path]].js`): every `/api/admin/*` route requires an admin session,
and every user route reads/writes only the signed-in user's rows.

Files: `auth.js` (client session + API wrapper), `bridge.js` (hooks module pages into the progress log),
`login.html`, `schema.sql` (D1 tables).
