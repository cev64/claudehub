# ClaudeHub

A dashboard that runs on Charlie's Mac Mini: it scans the local projects folder and GitHub
(`cev64`), shows every project, PRs and activity, suggests next steps, and runs Claude Code in a
project (on the Mac with `claude -p`, or in the cloud with `claude --cloud`). What's left to build
is in `docs/NEXT_STEPS.md`.

## Layout

- `shared/types.ts`: the API contract. Every `/api/*` route and its JSON shape is listed at the
  bottom. Change it first, then the server and the web app to match.
- `server/src/`: the Mac agent (Fastify, run directly with `tsx`, no build step).
  - `index.ts`: routes, auth hook, SSE, static serving of `dist/web`.
  - `hub.ts`: state and orchestration (scan loop, GitHub sync, overview, actions, jobs, new projects).
  - `scanner.ts` and `git.ts` cover local repos. `github.ts` is the GraphQL sync. `merge.ts` combines the two into `Project[]`.
  - `jobs.ts` + `claude.ts`: Claude runner (queue of 2, NDJSON parsing, persistence in `~/.claudehub/jobs`).
  - `suggestions.ts` (rules + Claude suggestions), `actions.ts` (open/fetch/pull/clone), `config.ts`, `store.ts`.
- `web/src/`: React 19 + Vite dashboard. `api.ts` is the typed client, `mock.ts` holds sample data
  for `?mock=1`, and `screens/` and `components/` hold the UI.
- `scripts/install-mac.sh` / `uninstall-mac.sh`: launchd agent `com.claudehub.agent`, logs in
  `~/.claudehub/agent.log`.
- `supabase/migrations/`: the `claudehub` schema in the **Budget** Supabase project
  (`sygxozspiszqfawkmpzx`), shared with the budget app (`public`) and bet tracker (`betting`).
  Never touch tables outside the `claudehub` schema.

## Commands

```bash
npm install
npm run typecheck        # tsc over server, web and shared — must pass before committing
npm run build            # builds web into dist/web (the agent serves it)
npm run dev              # agent on :4317 + Vite on :5173 (proxies /api)
npm start                # agent only, serves dist/web
```

Useful env vars: `PROJECTS_DIR`, `PORT`, `HOST`, `CLAUDEHUB_TOKEN`, `CLAUDEHUB_HOME` (default
`~/.claudehub`), `GITHUB_TOKEN`, `CLAUDE_BIN`.

## Testing without spending the subscription

Never run the real `claude` from tests. Point the agent at the fake CLI, which prints realistic
stream-json, and at a throwaway home and projects folder:

```bash
CLAUDE_BIN=$PWD/scripts/dev/fake-claude CLAUDEHUB_HOME=/tmp/chub-home \
PROJECTS_DIR=/tmp/chub-projects PORT=4399 npx tsx server/src/index.ts
```

Put a prompt containing `slow` in a job to get a long-running fake job for cancel tests. Check UI
changes in a browser at `?mock=1` (sample data) and against the running agent, at 1440px and
390px wide, in light and dark mode.

## Rules

- Claude runs on Charlie's **subscription**: never require or pass `ANTHROPIC_API_KEY` (the runner
  deletes it from the child env), and never use `--bare` (it disables subscription login).
- Spawn processes with `execFile`/`spawn` and argument arrays, never shell strings, since paths and prompts are user input.
- Anything that can run Claude must stay behind the token check when reachable from the network.
- UI follows `docs/FLUID_GLASS_DESIGN_GUIDE.md`. Keep its tokens and anti-patterns (no stripes, no
  dividers, one accent per view, no emoji, U+2212 minus, reduced motion). Copy is short and calm.
- Keep `?mock=1` working when you add API fields: update `web/src/mock.ts`.
