/* DealerFocus Training Academy — API (Cloudflare Pages Functions + D1)
 * All data lives in the D1 database bound as env.DB. Authorization is enforced HERE, server-side:
 *   - user  : can read/write ONLY their own progress, scores and usage
 *   - admin : can read/edit everyone's data
 * Secret (Pages > Settings > Variables and Secrets): ADMIN_CODE  — code needed to sign up as an admin.
 */

const MODULE_IDS = ["m1", "m2", "m3", "m4", "m5", "m6"];
const QUIZ_IDS = ["quiz_m1_usa", "quiz_m2_vehicle", "quiz_m3_tools", "quiz_m4_csr", "quiz_final", "quiz_m6_refresh"];
const CORE_MODULES = ["m1", "m2", "m3", "m4"];
const SESSION_DAYS = 30;
const PBKDF2_ITER = 100000; // Workers max
const MIN_PASSWORD = 8;
// About Us gate: the team video must be watched in order at normal speed; time on the page is also required.
const ABOUT_MAX_DURATION = 3600;   // seconds; longer videos are refused
const ABOUT_COVER_NEED = 0.97;     // share of the video that must have been played in order
const BEAT_MAX_WALL = 20;          // time-on-page: a heartbeat gap longer than this adds no page time
const COVER_MAX_WALL = 120;        // video credit: playback is capped by real elapsed time, so longer gaps are safe
const ABOUT_DEFAULT_MIN_SEC = 300; // default minimum time on the About Us page (5 minutes)
const MAX_FAILS = 8;
const LOCK_MIN = 15;

const enc = new TextEncoder();
const nowISO = () => new Date().toISOString();

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}
const fail = (msg, status = 400) => json({ error: msg }, status);

/* ---------- crypto ---------- */
const toHex = (buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
function randHex(n) { return toHex(crypto.getRandomValues(new Uint8Array(n))); }
async function sha256Hex(s) { return toHex(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
async function hashPassword(password, saltHex, iter = PBKDF2_ITER) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(saltHex), iterations: iter }, key, 256);
  return iter + ":" + toHex(bits); // iteration count is stored with the hash so it can be raised later
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ---------- helpers ---------- */
function getCookie(req, name) {
  const c = req.headers.get("cookie") || "";
  for (const part of c.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
function sessionCookie(token, url, maxAge) {
  return `df_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}` + (url.protocol === "https:" ? "; Secure" : "");
}
const clip = (s, n) => String(s == null ? "" : s).slice(0, n);

async function getPassPct(env) {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key='passPct'").first();
  const n = r ? Number(r.value) : 80;
  return n >= 1 && n <= 100 ? n : 80;
}

async function getAboutCfg(env) {
  const { results } = await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('aboutGate','aboutMinSec')").all();
  const m = {};
  results.forEach((r) => { m[r.key] = r.value; });
  let minSec = Number(m.aboutMinSec);
  if (!(minSec >= 30 && minSec <= 3600)) minSec = ABOUT_DEFAULT_MIN_SEC;
  return { gate: m.aboutGate === "1", minSec: Math.round(minSec) };
}

function countOnes(str) {
  let n = 0;
  for (let i = 0; i < str.length; i++) if (str.charCodeAt(i) === 49) n++;
  return n;
}

function aboutSummary(row, cfg) {
  const dur = row && row.duration ? row.duration : 0;
  const n = Math.ceil(dur);
  const covered = row && row.coverage ? countOnes(row.coverage) : 0;
  return {
    completed: !!(row && row.completed_at),
    completedAt: row && row.completed_at ? row.completed_at : null,
    videoPct: n ? Math.min(100, Math.floor((covered / n) * 100)) : 0,
    pageSec: row ? Math.round(row.page_sec) : 0,
    minSec: cfg.minSec,
    skips: row ? row.violations : 0,
    duration: dur
  };
}

async function aboutDone(env, userId) {
  const r = await env.DB.prepare("SELECT completed_at FROM about_progress WHERE user_id = ?").bind(userId).first();
  return !!(r && r.completed_at);
}

/** Staff cannot record module progress or quiz scores until About Us is complete (when the gate is on). */
async function gateBlocks(env, me) {
  if (me.role === "admin") return false;
  const cfg = await getAboutCfg(env);
  if (!cfg.gate) return false;
  return !(await aboutDone(env, me.id));
}

async function currentUser(req, env) {
  const token = getCookie(req, "df_session");
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const th = await sha256Hex(token);
  const row = await env.DB.prepare(
    "SELECT u.id, u.name, u.email, u.role, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"
  ).bind(th, nowISO()).first();
  return row ? { id: row.id, name: row.name, email: row.email, role: row.role, createdAt: row.created_at } : null;
}

async function createSession(env, userId, url) {
  const token = randHex(32);
  const th = await sha256Hex(token);
  const exp = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)")
    .bind(th, userId, nowISO(), exp).run();
  // opportunistic cleanup of expired sessions
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(nowISO()).run();
  return sessionCookie(token, url, SESSION_DAYS * 86400);
}

/** Full per-user state (progress, attempts, usage). Used for the user's own view and the admin's detail view. */
async function buildUserData(env, userId) {
  const [mods, quizzes, attempts, views, logins, dwell] = await env.DB.batch([
    env.DB.prepare("SELECT module_id, at FROM progress WHERE user_id = ?").bind(userId),
    env.DB.prepare("SELECT quiz_id, score, passed, at, edited_by_admin FROM quizzes WHERE user_id = ?").bind(userId),
    env.DB.prepare("SELECT id, quiz_id, score, raw, total, passed, at, source, extra FROM attempts WHERE user_id = ? ORDER BY at DESC LIMIT 200").bind(userId),
    env.DB.prepare("SELECT page, at FROM usage_events WHERE user_id = ? AND kind='view' ORDER BY id DESC LIMIT 500").bind(userId),
    env.DB.prepare("SELECT at, ua FROM usage_events WHERE user_id = ? AND kind='login' ORDER BY id DESC LIMIT 200").bind(userId),
    env.DB.prepare("SELECT page, SUM(sec) AS sec FROM usage_events WHERE user_id = ? AND kind='dwell' GROUP BY page").bind(userId)
  ]);
  const progress = { modules: {}, quizzes: {} };
  mods.results.forEach((r) => { progress.modules[r.module_id] = { done: true, at: r.at }; });
  quizzes.results.forEach((r) => {
    progress.quizzes[r.quiz_id] = { score: r.score, passed: !!r.passed, at: r.at };
    if (r.edited_by_admin) progress.quizzes[r.quiz_id].editedByAdmin = true;
  });
  const cfgAbout = await getAboutCfg(env);
  const aboutRow = await env.DB.prepare("SELECT coverage, page_sec, duration, violations, completed_at FROM about_progress WHERE user_id = ?").bind(userId).first();
  const usage = {
    views: views.results.reverse(),
    logins: logins.results.reverse(),
    dwell: {}
  };
  dwell.results.forEach((r) => { usage.dwell[r.page] = r.sec; });
  return {
    progress,
    attempts: attempts.results.reverse().map((a) => {
      const o = { id: a.id, quiz: a.quiz_id, score: a.score, raw: a.raw, total: a.total, passed: !!a.passed, at: a.at };
      if (a.source) o.source = a.source;
      if (a.extra) { try { o.extra = JSON.parse(a.extra); } catch (e) {} }
      return o;
    }),
    usage,
    about: aboutSummary(aboutRow, cfgAbout)
  };
}

function isCertified(progress, passPct) {
  const ok = CORE_MODULES.every((m) => progress.modules[m]);
  const f = progress.quizzes.quiz_final;
  return !!(ok && f && f.score >= passPct);
}

async function buildState(env, user) {
  const passPct = await getPassPct(env);
  const cfg = await getAboutCfg(env);
  const settings = { passPct, aboutGate: cfg.gate, aboutMinSec: cfg.minSec };
  if (!user) return { user: null, settings };
  const data = await buildUserData(env, user.id);
  return { user, settings, ...data };
}

async function recordLogin(env, userId, req) {
  const t = nowISO();
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET logins = logins + 1, last_active = ? WHERE id = ?").bind(t, userId),
    env.DB.prepare("INSERT INTO usage_events (user_id, kind, page, ua, at) VALUES (?, 'login', NULL, ?, ?)")
      .bind(userId, clip(req.headers.get("user-agent"), 120), t)
  ]);
}

async function readBody(req) {
  try { return await req.json(); } catch (e) { return null; }
}

/* ---------- route handlers ---------- */
/** Validate + insert a user. Returns { user } or { error, status }. */
async function createUserRecord(env, { name, email, password, role }) {
  name = clip(name, 100).trim();
  email = clip(email, 200).trim().toLowerCase();
  password = String(password || "");
  if (!name || !email || !password) return { error: "Name, email and password are required.", status: 400 };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email address.", status: 400 };
  if (password.length < MIN_PASSWORD || password.length > 200) return { error: "Password must be at least " + MIN_PASSWORD + " characters.", status: 400 };
  if (role !== "admin" && role !== "user") return { error: "Bad role.", status: 400 };
  const exists = await env.DB.prepare("SELECT 1 AS x FROM users WHERE email = ?").bind(email).first();
  if (exists) return { error: "That email already has an account.", status: 409 };
  const id = "u_" + randHex(8);
  const salt = randHex(16);
  const hash = await hashPassword(password, salt);
  const t = nowISO();
  try {
    await env.DB.prepare(
      "INSERT INTO users (id, name, email, pass_hash, pass_salt, role, created_at, logins, last_active) VALUES (?,?,?,?,?,?,?,0,NULL)"
    ).bind(id, name, email, hash, salt, role, t).run();
  } catch (e) { return { error: "That email already has an account.", status: 409 }; }
  return { user: { id, name, email, role, createdAt: t } };
}

/* Public sign-up is CLOSED. Accounts are created only by an admin (POST /api/admin/create).
 * The one exception is recovery/bootstrap: while the users table is EMPTY, the first account may be
 * created as admin with the ADMIN_CODE secret. As soon as one user exists this always refuses. */
async function signup(req, env, url) {
  const b = await readBody(req);
  if (!b) return fail("Invalid request.");
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
  if (n.n > 0) return fail("Sign-up is closed. Ask an administrator to create your account.", 403);
  const adminCode = String(b.adminCode || "").trim();
  if (!env.ADMIN_CODE || !adminCode || !safeEqual(adminCode, String(env.ADMIN_CODE))) return fail("Sign-up is closed. Ask an administrator to create your account.", 403);
  const r = await createUserRecord(env, { name: b.name, email: b.email, password: b.password, role: "admin" });
  if (r.error) return fail(r.error, r.status);
  await recordLogin(env, r.user.id, req);
  const cookie = await createSession(env, r.user.id, url);
  return json(await buildState(env, r.user), 200, { "set-cookie": cookie });
}

async function login(req, env, url) {
  const b = await readBody(req);
  if (!b) return fail("Invalid request.");
  const email = clip(b.email, 200).trim().toLowerCase();
  const password = String(b.password || "");
  if (!email || !password) return fail("Invalid email or password.", 401);

  const lock = await env.DB.prepare("SELECT count, locked_until FROM login_failures WHERE email = ?").bind(email).first();
  if (lock && lock.locked_until && lock.locked_until > nowISO()) {
    return fail("Too many failed attempts. Try again in " + LOCK_MIN + " minutes.", 429);
  }
  const row = await env.DB.prepare("SELECT id, name, email, role, created_at, pass_hash, pass_salt FROM users WHERE email = ?").bind(email).first();
  // always hash, so response time does not reveal whether the email exists
  const iter = row && row.pass_hash.indexOf(":") > 0 ? Number(row.pass_hash.split(":")[0]) : PBKDF2_ITER;
  const h = await hashPassword(password, row ? row.pass_salt : "0".repeat(32), iter);
  if (!row || !safeEqual(h, row.pass_hash)) {
    const count = (lock ? lock.count : 0) + 1;
    const until = count >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60000).toISOString() : null;
    await env.DB.prepare(
      "INSERT INTO login_failures (email, count, locked_until) VALUES (?,?,?) ON CONFLICT(email) DO UPDATE SET count = excluded.count, locked_until = excluded.locked_until"
    ).bind(email, count >= MAX_FAILS ? 0 : count, until).run();
    return fail("Invalid email or password.", 401);
  }
  await env.DB.prepare("DELETE FROM login_failures WHERE email = ?").bind(email).run();
  await recordLogin(env, row.id, req);
  const cookie = await createSession(env, row.id, url);
  const user = { id: row.id, name: row.name, email: row.email, role: row.role, createdAt: row.created_at };
  return json(await buildState(env, user), 200, { "set-cookie": cookie });
}

async function logout(req, env, url) {
  const token = getCookie(req, "df_session");
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  return json({ ok: true }, 200, { "set-cookie": sessionCookie("", url, 0) });
}

async function touch(env, userId) {
  await env.DB.prepare("UPDATE users SET last_active = ? WHERE id = ?").bind(nowISO(), userId).run();
}

async function setModule(req, env, me) {
  const b = await readBody(req);
  if (!b || MODULE_IDS.indexOf(b.id) < 0) return fail("Unknown module.");
  if (await gateBlocks(env, me)) return fail("Complete the About Us video first.", 403);
  if (b.done === false) {
    await env.DB.prepare("DELETE FROM progress WHERE user_id = ? AND module_id = ?").bind(me.id, b.id).run();
  } else {
    await env.DB.prepare("INSERT OR IGNORE INTO progress (user_id, module_id, at) VALUES (?,?,?)").bind(me.id, b.id, nowISO()).run();
  }
  await touch(env, me.id);
  return json({ ok: true });
}

async function upsertQuiz(env, userId, quiz, pct, passPct, t, edited) {
  const passed = pct >= passPct ? 1 : 0;
  if (edited) {
    await env.DB.prepare(
      "INSERT INTO quizzes (user_id, quiz_id, score, passed, at, edited_by_admin) VALUES (?,?,?,?,?,1) ON CONFLICT(user_id, quiz_id) DO UPDATE SET score=excluded.score, passed=excluded.passed, at=excluded.at, edited_by_admin=1"
    ).bind(userId, quiz, pct, passed, t).run();
  } else {
    // keep the best score
    await env.DB.prepare(
      "INSERT INTO quizzes (user_id, quiz_id, score, passed, at, edited_by_admin) VALUES (?,?,?,?,?,0) ON CONFLICT(user_id, quiz_id) DO UPDATE SET score=excluded.score, passed=excluded.passed, at=excluded.at, edited_by_admin=0 WHERE excluded.score >= quizzes.score"
    ).bind(userId, quiz, pct, passed, t).run();
  }
  return passed;
}

async function logQuiz(req, env, me) {
  const b = await readBody(req);
  if (!b || QUIZ_IDS.indexOf(b.quiz) < 0) return fail("Unknown quiz.");
  if (await gateBlocks(env, me)) return fail("Complete the About Us video first.", 403);
  const total = Number(b.total) > 0 ? Math.min(Number(b.total), 1000) : 100;
  const raw = Number(b.raw);
  if (!(raw >= 0) || raw > total) return fail("Invalid score.");
  const pct = Math.round((raw / total) * 100);
  const passPct = await getPassPct(env);
  const t = nowISO();
  const passed = await upsertQuiz(env, me.id, b.quiz, pct, passPct, t, false);
  const id = "a_" + randHex(8);
  let extra = null;
  if (b.extra && typeof b.extra === "object") { try { extra = clip(JSON.stringify(b.extra), 500); } catch (e) {} }
  await env.DB.prepare("INSERT INTO attempts (id, user_id, quiz_id, score, raw, total, passed, at, source, extra) VALUES (?,?,?,?,?,?,?,?,NULL,?)")
    .bind(id, me.id, b.quiz, pct, raw, total, passed, t, extra).run();
  // keep at most 200 attempts per user
  await env.DB.prepare("DELETE FROM attempts WHERE user_id = ? AND id NOT IN (SELECT id FROM attempts WHERE user_id = ? ORDER BY at DESC LIMIT 200)")
    .bind(me.id, me.id).run();
  await touch(env, me.id);
  return json({ ok: true, passed: !!passed, score: pct });
}

async function logUsage(req, env, me) {
  const b = await readBody(req);
  if (!b) return fail("Invalid request.");
  const page = clip(b.page, 120);
  if (b.kind === "view") {
    await env.DB.prepare("INSERT INTO usage_events (user_id, kind, page, at) VALUES (?, 'view', ?, ?)").bind(me.id, page, nowISO()).run();
    await env.DB.prepare("DELETE FROM usage_events WHERE user_id = ? AND kind='view' AND id NOT IN (SELECT id FROM usage_events WHERE user_id = ? AND kind='view' ORDER BY id DESC LIMIT 500)")
      .bind(me.id, me.id).run();
  } else if (b.kind === "dwell") {
    const sec = Math.round(Number(b.sec));
    if (!(sec > 0 && sec <= 4 * 3600)) return fail("Invalid duration.");
    await env.DB.prepare("INSERT INTO usage_events (user_id, kind, page, sec, at) VALUES (?, 'dwell', ?, ?, ?)").bind(me.id, page, sec, nowISO()).run();
  } else return fail("Unknown usage kind.");
  await touch(env, me.id);
  return json({ ok: true });
}

/* About Us heartbeat. The browser reports the video position every few seconds; the SERVER decides what counts:
 * only in-order playback at normal speed (position advancing no faster than the wall clock) earns coverage,
 * jumps ahead / fast-forward earn nothing and are counted as skips, and time on the page accrues only while
 * the tab is visible. Completion needs ~all of the video covered + the video finished + the minimum page time. */
async function aboutBeat(req, env, me) {
  const b = await readBody(req);
  if (!b) return fail("Invalid request.");
  const pos = Number(b.pos), dur = Number(b.duration);
  if (!(pos >= 0) || !(dur > 0) || dur > ABOUT_MAX_DURATION) return fail("Invalid video data.");
  const cfg = await getAboutCfg(env);
  const nowMs = Date.now();
  const n = Math.ceil(dur);
  const row = await env.DB.prepare("SELECT * FROM about_progress WHERE user_id = ?").bind(me.id).first();
  if (row && row.completed_at) return json({ ok: true, about: aboutSummary(row, cfg) });

  let cov = row && row.coverage ? row.coverage : "";
  let pageSec = row ? row.page_sec : 0;
  let viol = row ? row.violations : 0;
  let ended = row ? row.ended : 0;
  // a different video length means the video was replaced: start the coverage over
  if (row && row.duration && Math.abs(row.duration - dur) > 2) { cov = ""; ended = 0; }
  if (cov.length < n) cov = cov + "0".repeat(n - cov.length);
  if (cov.length > n) cov = cov.slice(0, n);

  const lastBeat = row && row.last_beat ? Date.parse(row.last_beat) : null;
  const wall = lastBeat ? (nowMs - lastBeat) / 1000 : 0;
  if (lastBeat && wall < 1.5) return json({ ok: true, about: aboutSummary({ coverage: cov, page_sec: pageSec, duration: dur, violations: viol, completed_at: null }, cfg) }); // ignore bursts

  if (lastBeat && wall <= BEAT_MAX_WALL && b.visible === true) pageSec += wall;

  const lastPos = row && row.last_pos !== null && row.last_pos !== undefined ? row.last_pos : null;
  if (lastBeat && lastPos !== null && wall <= COVER_MAX_WALL && row.last_playing && b.playing === true && Number(b.rate) === 1) {
    const d = pos - lastPos;
    if (d > 0 && d <= wall * 1.15 + 0.75) {
      const chars = cov.split("");
      for (let sec = Math.floor(lastPos); sec < Math.floor(pos) && sec < n; sec++) { if (sec >= 0) chars[sec] = "1"; }
      cov = chars.join("");
    } else if (d > wall * 1.5 + 3) {
      viol++; // jumped ahead or fast-forwarded: no credit
    }
  }
  if (b.ended === true && pos >= dur - 2) ended = 1;

  const covered = countOnes(cov);
  let completedAt = null;
  if (covered >= Math.ceil(n * ABOUT_COVER_NEED) && ended && pageSec >= cfg.minSec) completedAt = nowISO();

  await env.DB.prepare(
    "INSERT INTO about_progress (user_id, coverage, page_sec, last_pos, last_beat, last_playing, duration, ended, violations, completed_at) VALUES (?,?,?,?,?,?,?,?,?,?) " +
    "ON CONFLICT(user_id) DO UPDATE SET coverage=excluded.coverage, page_sec=excluded.page_sec, last_pos=excluded.last_pos, last_beat=excluded.last_beat, " +
    "last_playing=excluded.last_playing, duration=excluded.duration, ended=excluded.ended, violations=excluded.violations, completed_at=excluded.completed_at"
  ).bind(me.id, cov, pageSec, pos, new Date(nowMs).toISOString(), b.playing === true ? 1 : 0, dur, ended, viol, completedAt).run();
  if (completedAt) await touch(env, me.id);
  return json({ ok: true, about: aboutSummary({ coverage: cov, page_sec: pageSec, duration: dur, violations: viol, completed_at: completedAt }, cfg) });
}

/* ---------- admin ---------- */
async function adminUsers(env) {
  const passPct = await getPassPct(env);
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.created_at, u.logins, u.last_active,
       (SELECT COUNT(*) FROM progress p WHERE p.user_id = u.id) AS mods,
       (SELECT COUNT(*) FROM progress p WHERE p.user_id = u.id AND p.module_id IN ('m1','m2','m3','m4')) AS core,
       (SELECT COUNT(*) FROM attempts a WHERE a.user_id = u.id) AS attempts,
       (SELECT MAX(score) FROM quizzes q WHERE q.user_id = u.id) AS best,
       (SELECT score FROM quizzes q WHERE q.user_id = u.id AND q.quiz_id = 'quiz_final') AS final,
       (SELECT completed_at FROM about_progress a WHERE a.user_id = u.id) AS about_done
     FROM users u ORDER BY u.created_at`
  ).all();
  return json(results.map((r) => ({
    id: r.id, name: r.name, email: r.email, role: r.role, createdAt: r.created_at,
    logins: r.logins, lastActive: r.last_active, modulesDone: r.mods + "/6",
    attempts: r.attempts, best: r.best, aboutDone: !!r.about_done, certified: r.core === 4 && r.final !== null && r.final >= passPct
  })));
}

async function adminUser(env, url) {
  const id = url.searchParams.get("id") || "";
  const u = await env.DB.prepare("SELECT id, name, email, role, created_at FROM users WHERE id = ?").bind(id).first();
  if (!u) return fail("Not found.", 404);
  const passPct = await getPassPct(env);
  const data = await buildUserData(env, id);
  return json({
    user: { id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.created_at },
    ...data, certified: isCertified(data.progress, passPct)
  });
}

async function adminCountOtherAdmins(env, id) {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND id != ?").bind(id).first();
  return r.n;
}

async function adminAction(action, req, env, me) {
  const b = await readBody(req);
  if (!b) return fail("Invalid request.");
  if (action === "settings") {
    const up = "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
    if (b.passPct !== undefined) {
      const v = Math.round(Number(b.passPct));
      if (!(v >= 1 && v <= 100)) return fail("Pass mark must be 1-100.");
      await env.DB.prepare(up).bind("passPct", String(v)).run();
    }
    if (b.aboutGate !== undefined) await env.DB.prepare(up).bind("aboutGate", b.aboutGate ? "1" : "0").run();
    if (b.aboutMinSec !== undefined) {
      const m = Math.round(Number(b.aboutMinSec));
      if (!(m >= 30 && m <= 3600)) return fail("Minimum About Us time must be between 30 seconds and 60 minutes.");
      await env.DB.prepare(up).bind("aboutMinSec", String(m)).run();
    }
    return json({ ok: true });
  }
  if (action === "create") {
    const r = await createUserRecord(env, { name: b.name, email: b.email, password: b.password, role: b.role === "admin" ? "admin" : "user" });
    if (r.error) return fail(r.error, r.status);
    return json({ ok: true, user: r.user });
  }
  const id = String(b.id || "");
  const target = await env.DB.prepare("SELECT id, role FROM users WHERE id = ?").bind(id).first();
  if (!target) return fail("Not found.", 404);

  if (action === "role") {
    if (b.role !== "admin" && b.role !== "user") return fail("Bad role.");
    if (target.role === "admin" && b.role === "user" && (await adminCountOtherAdmins(env, id)) === 0) {
      return fail("Cannot remove the last admin.");
    }
    await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(b.role, id).run();
    return json({ ok: true });
  }
  if (action === "password") {
    // nobody may change their own login; another admin resets it
    if (id === me.id) return fail("You cannot change your own login. Ask another admin.", 403);
    const pw = String(b.password || "");
    if (pw.length < MIN_PASSWORD || pw.length > 200) return fail("Password must be at least " + MIN_PASSWORD + " characters.");
    const salt = randHex(16);
    const hash = await hashPassword(pw, salt);
    await env.DB.batch([
      env.DB.prepare("UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?").bind(hash, salt, id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id)
    ]);
    return json({ ok: true });
  }
  if (action === "aboutreset") {
    await env.DB.prepare("DELETE FROM about_progress WHERE user_id = ?").bind(id).run();
    return json({ ok: true });
  }
  if (action === "reset") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM progress WHERE user_id = ?").bind(id),
      env.DB.prepare("DELETE FROM quizzes WHERE user_id = ?").bind(id),
      env.DB.prepare("DELETE FROM attempts WHERE user_id = ?").bind(id)
    ]);
    return json({ ok: true });
  }
  if (action === "score") {
    if (QUIZ_IDS.indexOf(b.quiz) < 0) return fail("Unknown quiz.");
    const score = Math.max(0, Math.min(100, Math.round(Number(b.score))));
    if (!(score >= 0)) return fail("Invalid score.");
    const passPct = await getPassPct(env);
    const t = nowISO();
    const passed = await upsertQuiz(env, id, b.quiz, score, passPct, t, true);
    await env.DB.prepare("INSERT INTO attempts (id, user_id, quiz_id, score, raw, total, passed, at, source, extra) VALUES (?,?,?,?,?,100,?,?,'admin-edit',NULL)")
      .bind("a_" + randHex(8), id, b.quiz, score, score, passed, t).run();
    return json({ ok: true });
  }
  if (action === "delete") {
    if (id === me.id) return fail("Cannot delete yourself.");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM progress WHERE user_id = ?").bind(id),
      env.DB.prepare("DELETE FROM quizzes WHERE user_id = ?").bind(id),
      env.DB.prepare("DELETE FROM attempts WHERE user_id = ?").bind(id),
      env.DB.prepare("DELETE FROM usage_events WHERE user_id = ?").bind(id),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(id),
      env.DB.prepare("DELETE FROM about_progress WHERE user_id = ?").bind(id),
      env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id)
    ]);
    return json({ ok: true });
  }
  return fail("Not found.", 404);
}

/* ---------- entry ---------- */
export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  const method = request.method;

  if (!env.DB) return fail("Database is not configured (missing D1 binding 'DB').", 500);

  // CSRF defence: state-changing requests must be same-origin JSON
  if (method !== "GET" && method !== "HEAD") {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return fail("Forbidden.", 403);
    if (!(request.headers.get("content-type") || "").includes("application/json")) return fail("Unsupported media type.", 415);
  }

  try {
    if (method === "GET" && route === "state") {
      return json(await buildState(env, await currentUser(request, env)));
    }
    if (method === "POST" && route === "signup") return await signup(request, env, url);
    if (method === "POST" && route === "login") return await login(request, env, url);
    if (method === "POST" && route === "logout") return await logout(request, env, url);

    // everything below needs a valid session
    const me = await currentUser(request, env);
    if (!me) return fail("Not signed in.", 401);

    if (method === "POST" && route === "module") return await setModule(request, env, me);
    if (method === "POST" && route === "quiz") return await logQuiz(request, env, me);
    if (method === "POST" && route === "usage") return await logUsage(request, env, me);
    if (method === "POST" && route === "about/beat") return await aboutBeat(request, env, me);

    if (route.indexOf("admin/") === 0) {
      if (me.role !== "admin") return fail("Admin only.", 403);
      const action = route.slice(6);
      if (method === "GET" && action === "users") return await adminUsers(env);
      if (method === "GET" && action === "user") return await adminUser(env, url);
      if (method === "POST") return await adminAction(action, request, env, me);
    }
    return fail("Not found.", 404);
  } catch (e) {
    return fail("Server error.", 500);
  }
}
