-- DealerFocus Training Academy — Supabase production migration (recommended)
-- Run in Supabase SQL editor. Enables real multi-device Admin/User backend.
-- Front-end swap: replace localStorage calls in auth.js with supabase-js calls.

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  name text not null,
  role text not null default 'user' check (role in ('admin','user')),
  created_at timestamptz default now(),
  last_active timestamptz
);

create table if not exists modules (
  id text primary key,
  title text not null,
  href text not null,
  quiz_id text not null,
  sort int default 0
);

create table if not exists progress (
  user_id uuid references profiles(id) on delete cascade,
  module_id text references modules(id) on delete cascade,
  done boolean default true,
  updated_at timestamptz default now(),
  primary key (user_id, module_id)
);

create table if not exists attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  quiz_id text not null,
  score int not null check (score >= 0 and score <= 100),
  passed boolean not null,
  answers jsonb,
  source text default 'quiz',
  created_at timestamptz default now()
);
create index if not exists attempts_user_idx on attempts(user_id, created_at desc);

create table if not exists usage_events (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(id) on delete cascade,
  kind text not null, -- login | view | quiz
  page text,
  created_at timestamptz default now()
);

create table if not exists settings (
  id int primary key generated always as identity,
  pass_pct int not null default 80,
  updated_at timestamptz default now()
);
insert into settings(pass_pct) values (80) on conflict do nothing;

insert into modules(id,title,href,quiz_id,sort) values
 ('m1','Module 01 — All About the USA','module-01-usa.html','quiz_m1_usa',1),
 ('m2','Module 02 — Vehicle 101','module-02-vehicle101.html','quiz_m2_vehicle',2),
 ('m3','Module 03 — Program Software & Tools','module-03-software-tools.html','quiz_m3_tools',3),
 ('m4','Module 04 — CSR Fundamentals','module-04-csr-fundamentals.html','quiz_m4_csr',4),
 ('m5','Module 05 — Certification (Final)','module-05-certification.html','quiz_final',5),
 ('m6','Module 06 — Refresher Courses','module-06-refresher-courses.html','quiz_m6_refresh',6)
on conflict (id) do nothing;

-- RLS
alter table profiles enable row level security;
alter table progress enable row level security;
alter table attempts enable row level security;
alter table usage_events enable row level security;
alter table modules enable row level security;
alter table settings enable row level security;

create policy "users read own profile" on profiles for select using (auth.uid() = id);
create policy "admins read all profiles" on profiles for select using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy "admins update all profiles" on profiles for update using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
create policy "users update own name" on profiles for update using (auth.uid() = id);

create policy "modules readable by all authed" on modules for select using (auth.role() = 'authenticated');
create policy "settings readable by all authed" on settings for select using (auth.role() = 'authenticated');
create policy "admins edit modules/settings" on modules for all using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
-- (apply same admin-only pattern to settings via service role or duplicate policy)

create policy "own progress RW" on progress for all using (auth.uid() = user_id);
create policy "admin progress R" on progress for select using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "own attempts RW" on attempts for all using (auth.uid() = user_id);
create policy "admin attempts R" on attempts for select using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy "own usage insert/read" on usage_events for all using (auth.uid() = user_id);
create policy "admin usage read" on usage_events for select using (
  exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- Make first admin (after signup in Supabase Auth dashboard, run):
-- update profiles set role='admin' where email='admin@dealerfocus.com';
