# Next steps

Work through these in order. Each section ends with what "done" means.

## 1. Verify on the Mac Mini

The agent was built and tested in a Linux cloud container with a fake `claude` and no GitHub login.
These parts have never run against the real thing:

| Area | Check | Where to fix |
|---|---|---|
| Install | `./scripts/install-mac.sh` finishes, `launchctl print gui/$(id -u)/com.claudehub.agent` shows it running, and http://localhost:4317 loads | `scripts/install-mac.sh` |
| Restart | Reboot the Mac: the agent comes back by itself | plist `RunAtLoad`/`KeepAlive` |
| GitHub | Settings → Health says GitHub ready. Projects show stars, open PRs and pushed dates. Pull requests lists real PRs. "PRs authored" matches github.com | `server/src/github.ts` (GraphQL field mapping, pagination) |
| Claude login under launchd | Health shows "Logged in (claude.ai)". A *Plan* run in a small repo streams text and finishes | `server/src/claude.ts`. If the Keychain isn't readable from launchd, use `claude setup-token` + `CLAUDE_CODE_OAUTH_TOKEN` |
| Permission flags | A local run doesn't fail right away on `--permission-prompts none` | `jobs.ts` `start()` (remove the flag if this CLI version rejects it) |
| Edit / Auto runs | *Edit files* changes a file. *Auto* can run `npm test` or `swift build` | `jobs.ts` |
| Actions | Open in editor / Finder / Terminal, Fetch, Pull, Clone all work | `server/src/actions.ts` |
| New project | Creates a local folder with a first commit (no GitHub repo), then starts the run | `hub.ts` `createProject` |
| Usage tokens | Usage shows today's and this week's tokens, and they roughly match Claude Code's `/usage` history | `server/src/usage.ts` (transcript parsing; the format is internal and may have changed) |
| Usage capture | Usage → Turn on. `~/.claude/settings.json` gets the `statusline.mjs` command (with a backup in `~/.claudehub/backups/`), an existing status line still shows, and after one prompt in an interactive `claude` the 5-hour and weekly % match `/usage` | `scripts/statusline.mjs`, `usage.ts` |
| Subagent tokens | Sessions that used subagents include their tokens (the code expects `<session>/subagents/*.jsonl`) | `usage.ts` |

Done: every row checked, fixes committed.

### Results on the Mac Mini (2026-10-08, Claude Code 2.1.295)

- Passed: install, launchd restart after a kill, GitHub (24 repos, 3 open PRs, 255 authored and
  157 merged in 30 days, all matching github.com), Claude login under launchd (Keychain works, no
  `setup-token` needed), `--permission-prompts none`, *Plan*, *Edit files* and *Auto* runs
  (`npm test`), cancel (no leftover processes), Open in editor/Finder/Terminal, Fetch, Pull, usage
  tokens, subagent transcripts at `<session>/subagents/*.jsonl`.
- Cloud runs removed: `claude --cloud` exits with "requires an interactive terminal", and under
  a pseudo-terminal it stops at the folder-trust prompt. Cloud sessions are started from
  claude.ai/code instead.
- Also passed later: New project (local only now), a push from an *Auto* run, clone-before-run on a
  GitHub-only repo, next-edit suggestions generated automatically after a sync.
- Remote Control runs as `com.claudehub.remote-control` in `~/Desktop/DEV` (no TTY needed once the
  first-run questions are answered by hand).
- Still open: reboot (both services should come back), usage capture.

## 2. Supabase relay (use the dashboard away from home without Tailscale)

The schema is already applied to the Budget project (`sygxozspiszqfawkmpzx`, URL
`https://sygxozspiszqfawkmpzx.supabase.co`). See `supabase/migrations/20261008220000_claudehub_schema.sql`.

```
phone ──(signed in, RLS)──▶ Supabase claudehub.* ◀──(agent token, RPC only)── Mac agent
          reads snapshots, jobs, job_events                 pushes snapshot + jobs
          inserts commands                                   claims + completes commands
```

Not yet applied: `supabase/migrations/20261008230000_claudehub_agent_cleanup.sql` (it needs
Charlie's approval). Apply it before the agent calls `agent_cleanup`.

### Agent: `server/src/relay.ts`

- Config (settings + env): `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `CLAUDEHUB_AGENT_TOKEN`.
  The relay is off unless all three are set. Never use a service-role key.
- Call RPCs with `fetch` `POST {url}/rest/v1/rpc/<fn>`, headers `apikey: <publishable key>`,
  `Content-Type: application/json`, `Content-Profile: claudehub`. Body: `{ "p_token": ..., ... }`.
- `agent_push_snapshot(p_token, p_snapshot)`: after every scan, and on settings change.
  `p_snapshot = { health, overview, projects, pulls, settings, details }`, where `details` maps
  project id → `ProjectDetail` without `jobs`. Skip the push when nothing changed (hash it), and
  leave `details` out of a push to keep the stored one.
- `agent_claim_commands(p_token, p_limit)`: poll every 3 s. Back off to 15 s after an hour with
  no commands, and back to 3 s when one arrives. Dispatch by `kind`:
  - `job.create` → `hub.createJob(payload)`.
  - `job.cancel` → `hub.jobs.cancel(payload.id)`.
  - `project.create` → `hub.createProject(payload)`.
  - `project.action` → `hub.action(payload.projectId, payload.action)`.
  - `refresh` → `hub.refresh()`.
  - `suggestions.ai` → `hub.aiSuggest()`.
  - `settings.update` → `hub.updateSettings(payload)`.
  
  Then call `agent_complete_command(p_token, id, ok, result)` with the method's return value, or
  `{ error }` if it throws.
- `agent_push_job(p_token, p_job, p_events)`: on every job status change, and batched every
  ~500 ms while it streams. `p_events` is `[{ seq, event }]`, where `seq` is the event's index
  in the job's event list (inserts are idempotent per `(job_id, seq)`).
- `agent_cleanup(p_token)` once a day.
- Add `relay` to `Health.checks` in `shared/types.ts` ("Connected · last push 12s ago", or the
  last error). Relay failures must never break the local dashboard.

### Dashboard: hosted relay mode

- Build-time env `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Add `@supabase/supabase-js`
  and use `createClient(url, key, { db: { schema: 'claudehub' } })`.
- Mode: the web app served by the agent stays on `/api`. The hosted build (GitHub Pages or Vercel)
  uses the relay. Give `web/src/api.ts` the same interface over two transports.
- Sign-in: email magic link (Charlie already has an account in the Budget project). Add the
  hosted URL to Supabase Auth → URL configuration → Redirect URLs.
- Reads: `snapshots` (pick the agent, usually only one) feeds overview, projects, pulls, detail and
  health. Show "Mac last seen 3m ago" from `snapshots.updated_at` and a calm "Mac offline" state
  after 10 minutes.
- Writes: insert into `commands` (`agent_id`, `kind`, `payload`). Wait for the `result` with a
  Realtime subscription on that row (fall back to polling every 2 s), and time out after 30 s
  with "The Mac hasn't picked this up".
- Runs: `jobs` for the list. The transcript comes from `job_events` ordered by `seq`, plus a
  Realtime subscription filtered on `job_id`.
- Settings → "Pair a Mac": `rpc('issue_agent_token', { p_name })`. Show the token once, with the
  line to paste on the Mac (`export CLAUDEHUB_AGENT_TOKEN=...; ./scripts/install-mac.sh`). List
  agents with revoke (`update agents set revoked = true`).
- Keep `?mock=1` working.

Done: from a phone on cellular data, sign in, see fresh data, start a *Plan* run on the Mac and
watch it stream, create a new project.

## 3. Later

- Push notifications when a run finishes or CI fails (web push from the hosted dashboard).
