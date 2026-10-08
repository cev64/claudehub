# ClaudeHub

A dashboard that runs on Charlie's Mac Mini: it scans the local projects folder and GitHub
(`cev64`), shows every project, PRs and activity, suggests next steps, and runs Claude Code in a
project on the Mac with `claude -p`, from anywhere. There is no cloud mode (`claude --cloud`
needs an interactive terminal). What's left to build is in `docs/NEXT_STEPS.md`.

## Layout

- `shared/types.ts`: the API contract. Every `/api/*` route and its JSON shape is listed at the
  bottom. Change it first, then the server and the web app to match.
- `server/src/`: the Mac agent (Fastify, run directly with `tsx`, no build step).
  - `index.ts`: routes, auth hook, SSE, static serving of `dist/web`.
  - `hub.ts`: state and orchestration (scan loop, GitHub sync, overview, actions, jobs, new projects).
  - `scanner.ts` and `git.ts` cover local repos. `github.ts` is the GraphQL sync. `merge.ts` combines the two into `Project[]`.
  - `jobs.ts` + `claude.ts`: Claude runner (queue of 2, NDJSON parsing, persistence in `~/.claudehub/jobs`).
  - `usage.ts`: Claude usage. Scans `~/.claude/projects` transcripts (mtime+size cache), reads plan limits and per-session context captured by `scripts/statusline.mjs`, records the last `rate_limit_event`, and installs/removes the status line in `~/.claude/settings.json` (backup first, chains an existing status line).
  - `suggestions.ts` (rules + Claude suggestions), `actions.ts` (open/fetch/pull/clone), `config.ts`, `store.ts`.
- `web/src/`: React 19 + Vite dashboard. `api.ts` is the typed client, `mock.ts` holds sample data
  for `?mock=1`, and `screens/` and `components/` hold the UI.
- `scripts/statusline.mjs`: Claude Code status line command (plain Node, no deps, never fails). Saves the JSON Claude Code pipes in to `~/.claudehub/statusline/`, then runs the user's previous status line (`chain.json`) or prints a short default.
- `scripts/install-mac.sh` / `uninstall-mac.sh`: launchd agent `com.claudehub.agent`, logs in
  `~/.claudehub/agent.log`.
- `scripts/install-remote-control.sh`: launchd service `com.claudehub.remote-control` running
  `claude remote-control --spawn same-dir` in the projects folder (sessions from the Claude app).
- `mac/` + `scripts/build-mac-app.sh`: ClaudeHub.app, a native AppKit + WKWebView window onto the agent at :4317 (swiftc, no Xcode project; `--install` copies it to `~/Applications`). User agent ends in `ClaudeHubMac/1.0`; `window.webkit.messageHandlers.copy.postMessage(text)` copies without a user gesture.
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
`~/.claudehub`), `GITHUB_TOKEN`, `CLAUDE_BIN`, `CLAUDE_CONFIG_DIR` (Claude Code's config folder, read for
usage; default `~/.claude`).

## Testing without spending the subscription

Never run the real `claude` from tests. Point the agent at the fake CLI, which prints realistic
stream-json, and at a throwaway home and projects folder:

```bash
CLAUDE_BIN=$PWD/scripts/dev/fake-claude CLAUDEHUB_HOME=/tmp/chub-home \
PROJECTS_DIR=/tmp/chub-projects PORT=4399 npx tsx server/src/index.ts
```

For usage tests also set `CLAUDE_CONFIG_DIR` to a folder with fake `projects/*/*.jsonl` transcripts and
`settings.json`, so the real `~/.claude` is never read or edited. The fake CLI emits a `rate_limit_event`.

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
