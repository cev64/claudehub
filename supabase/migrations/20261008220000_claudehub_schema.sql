-- ClaudeHub relay schema (lives in the Budget project next to `public` and `betting`).
--
-- The hosted dashboard signs in as the user (RLS: own rows). It reads the snapshot the Mac
-- agent pushes, inserts commands, and streams job events over Realtime.
-- The Mac agent never holds a service key: it holds an agent token (sha256-hashed here)
-- and talks only through the security-definer agent_* functions below.

create schema if not exists claudehub;
grant usage on schema claudehub to anon, authenticated, service_role;

-- Agents (one per Mac) -------------------------------------------------------
create table claudehub.agents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name          text not null default 'Mac Mini',
  token_hash    text not null unique,
  token_hint    text,
  hostname      text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz,
  revoked       boolean not null default false
);
create index agents_user_idx on claudehub.agents (user_id);

-- Latest state pushed by each agent ------------------------------------------
create table claudehub.snapshots (
  agent_id    uuid primary key references claudehub.agents (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  health      jsonb not null default '{}'::jsonb,   -- Health
  overview    jsonb,                                -- Overview
  projects    jsonb not null default '[]'::jsonb,   -- Project[]
  pulls       jsonb not null default '[]'::jsonb,   -- PullRequest[]
  details     jsonb not null default '{}'::jsonb,   -- { [projectId]: ProjectDetail without jobs }
  settings    jsonb not null default '{}'::jsonb,   -- Settings
  updated_at  timestamptz not null default now()
);
create index snapshots_user_idx on claudehub.snapshots (user_id);

-- Commands from the dashboard to the Mac -------------------------------------
create table claudehub.commands (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  agent_id      uuid not null references claudehub.agents (id) on delete cascade,
  kind          text not null check (kind in (
                  'job.create', 'job.cancel', 'project.create', 'project.action',
                  'refresh', 'suggestions.ai', 'settings.update')),
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'pending' check (status in ('pending', 'claimed', 'done', 'error')),
  result        jsonb,
  created_at    timestamptz not null default now(),
  claimed_at    timestamptz,
  completed_at  timestamptz
);
create index commands_agent_pending_idx on claudehub.commands (agent_id, created_at) where status = 'pending';
create index commands_user_idx on claudehub.commands (user_id, created_at desc);

-- Claude runs and their transcripts ------------------------------------------
create table claudehub.jobs (
  id          text primary key,                     -- Job.id from the agent
  user_id     uuid not null references auth.users (id) on delete cascade,
  agent_id    uuid not null references claudehub.agents (id) on delete cascade,
  project_id  text,
  status      text not null,
  job         jsonb not null,                       -- Job (without events)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index jobs_user_created_idx on claudehub.jobs (user_id, created_at desc);

create table claudehub.job_events (
  id          bigint generated always as identity primary key,
  job_id      text not null references claudehub.jobs (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  seq         integer not null,
  event       jsonb not null,                       -- JobEvent
  created_at  timestamptz not null default now(),
  unique (job_id, seq)
);
create index job_events_user_idx on claudehub.job_events (user_id);

-- RLS: the signed-in user sees only their rows -------------------------------
alter table claudehub.agents     enable row level security;
alter table claudehub.snapshots  enable row level security;
alter table claudehub.commands   enable row level security;
alter table claudehub.jobs       enable row level security;
alter table claudehub.job_events enable row level security;

create policy "own rows select" on claudehub.agents for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own rows update" on claudehub.agents for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own rows delete" on claudehub.agents for delete to authenticated
  using (user_id = (select auth.uid()));

create policy "own rows select" on claudehub.snapshots for select to authenticated
  using (user_id = (select auth.uid()));

create policy "own rows select" on claudehub.commands for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own rows insert" on claudehub.commands for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and exists (select 1 from claudehub.agents a
                where a.id = agent_id and a.user_id = (select auth.uid()) and not a.revoked)
  );

create policy "own rows select" on claudehub.jobs for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own rows select" on claudehub.job_events for select to authenticated
  using (user_id = (select auth.uid()));

grant select, update, delete on claudehub.agents to authenticated;
grant select on claudehub.snapshots, claudehub.jobs, claudehub.job_events to authenticated;
grant select, insert on claudehub.commands to authenticated;
grant all on all tables in schema claudehub to service_role;
revoke all on all tables in schema claudehub from anon;

-- Dashboard: pair a Mac. Returns the plaintext token once. ---------------------
create or replace function claudehub.issue_agent_token(p_name text default 'Mac Mini')
returns table (agent_id uuid, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_token text;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  v_token := 'chub_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into claudehub.agents (user_id, name, token_hash, token_hint)
  values (v_uid, coalesce(nullif(trim(p_name), ''), 'Mac Mini'),
          encode(extensions.digest(v_token, 'sha256'), 'hex'), right(v_token, 4))
  returning id into v_id;
  return query select v_id, v_token;
end;
$$;

-- Agent side: every call authenticates with the agent token. ------------------
create or replace function claudehub.agent_auth(p_token text)
returns claudehub.agents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent claudehub.agents;
begin
  select * into v_agent from claudehub.agents
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
    and not revoked;
  if not found then
    raise exception 'invalid agent token' using errcode = '28000';
  end if;
  update claudehub.agents set last_seen_at = now() where id = v_agent.id;
  return v_agent;
end;
$$;

create or replace function claudehub.agent_push_snapshot(p_token text, p_snapshot jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent claudehub.agents := claudehub.agent_auth(p_token);
begin
  update claudehub.agents set hostname = p_snapshot #>> '{health,hostname}' where id = v_agent.id;
  insert into claudehub.snapshots as s (agent_id, user_id, health, overview, projects, pulls, details, settings, updated_at)
  values (v_agent.id, v_agent.user_id,
          coalesce(p_snapshot -> 'health', '{}'), p_snapshot -> 'overview',
          coalesce(p_snapshot -> 'projects', '[]'), coalesce(p_snapshot -> 'pulls', '[]'),
          coalesce(p_snapshot -> 'details', '{}'), coalesce(p_snapshot -> 'settings', '{}'), now())
  on conflict (agent_id) do update set
    health   = excluded.health,
    overview = coalesce(excluded.overview, s.overview),
    projects = case when p_snapshot ? 'projects' then excluded.projects else s.projects end,
    pulls    = case when p_snapshot ? 'pulls'    then excluded.pulls    else s.pulls end,
    details  = case when p_snapshot ? 'details'  then excluded.details  else s.details end,
    settings = case when p_snapshot ? 'settings' then excluded.settings else s.settings end,
    updated_at = now();
end;
$$;

-- Claims pending commands (oldest first) and marks them claimed.
create or replace function claudehub.agent_claim_commands(p_token text, p_limit integer default 10)
returns setof claudehub.commands
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent claudehub.agents := claudehub.agent_auth(p_token);
begin
  return query
  with claimed as (
    update claudehub.commands c set status = 'claimed', claimed_at = now()
    where c.id in (
      select p.id from claudehub.commands p
      where p.agent_id = v_agent.id and p.status = 'pending'
      order by p.created_at
      limit least(greatest(p_limit, 1), 50)
      for update skip locked)
    returning c.*)
  select * from claimed order by created_at;
end;
$$;

create or replace function claudehub.agent_complete_command(p_token text, p_id uuid, p_ok boolean, p_result jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent claudehub.agents := claudehub.agent_auth(p_token);
begin
  update claudehub.commands
  set status = case when p_ok then 'done' else 'error' end, result = p_result, completed_at = now()
  where id = p_id and agent_id = v_agent.id;
end;
$$;

-- Upserts a job and appends events (each event: {seq, event}).
create or replace function claudehub.agent_push_job(p_token text, p_job jsonb, p_events jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agent claudehub.agents := claudehub.agent_auth(p_token);
  v_id text := p_job ->> 'id';
begin
  if v_id is null then
    raise exception 'job id missing';
  end if;
  insert into claudehub.jobs as j (id, user_id, agent_id, project_id, status, job, created_at, updated_at)
  values (v_id, v_agent.user_id, v_agent.id, p_job ->> 'projectId', p_job ->> 'status', p_job - 'events',
          coalesce((p_job ->> 'createdAt')::timestamptz, now()), now())
  on conflict (id) do update set status = excluded.status, job = excluded.job, updated_at = now()
  where j.agent_id = v_agent.id;

  insert into claudehub.job_events (job_id, user_id, seq, event)
  select v_id, v_agent.user_id, (e ->> 'seq')::integer, e -> 'event'
  from jsonb_array_elements(coalesce(p_events, '[]')) e
  on conflict (job_id, seq) do nothing;
end;
$$;

revoke all on function claudehub.issue_agent_token(text) from public, anon;
revoke all on function claudehub.agent_auth(text) from public, anon, authenticated;
revoke all on function claudehub.agent_push_snapshot(text, jsonb) from public;
revoke all on function claudehub.agent_claim_commands(text, integer) from public;
revoke all on function claudehub.agent_complete_command(text, uuid, boolean, jsonb) from public;
revoke all on function claudehub.agent_push_job(text, jsonb, jsonb) from public;
grant execute on function claudehub.issue_agent_token(text) to authenticated;
grant execute on function claudehub.agent_push_snapshot(text, jsonb) to anon, authenticated;
grant execute on function claudehub.agent_claim_commands(text, integer) to anon, authenticated;
grant execute on function claudehub.agent_complete_command(text, uuid, boolean, jsonb) to anon, authenticated;
grant execute on function claudehub.agent_push_job(text, jsonb, jsonb) to anon, authenticated;

-- Realtime for the dashboard (RLS applies) -----------------------------------
alter publication supabase_realtime add table claudehub.snapshots, claudehub.commands, claudehub.jobs, claudehub.job_events;

-- Housekeeping: finished commands after 7 days, runs after 60 days ------------
select cron.schedule('claudehub-cleanup', '17 4 * * *', $$
  delete from claudehub.commands where created_at < now() - interval '7 days';
  delete from claudehub.jobs where updated_at < now() - interval '60 days';
$$);

-- Expose the schema to the API, keeping the existing ones --------------------
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, betting, claudehub';
notify pgrst, 'reload config';
