# ClaudeHub

A dashboard that runs all the time on your Mac Mini. It reads your projects folder and your
GitHub, shows every project in one place (PRs, most active project, uncommitted work), suggests
what to do next, and sends prompts to Claude running on the Mac, from anywhere. For Claude Code on
the web sessions, use claude.ai/code directly.

```
            ┌──────────────────────── Mac Mini ────────────────────────┐
 browser ──▶│  ClaudeHub agent (Node, port 4317, launchd keeps it up)  │
 (Mac, or   │   ├─ scans ~/Desktop/<projects> with git                 │
 phone via  │   ├─ syncs GitHub (gh login or a token) ────────────────▶│── api.github.com
 Tailscale) │   ├─ runs `claude -p` in a repo (your subscription)      │
            │   └─ serves the dashboard (Fluid Glass UI)               │
            └──────────────────────────────────────────────────────────┘
```

No API key is needed. Claude runs through the Claude Code CLI you're already logged in to,
so it uses your Claude subscription.

## What to install on the Mac Mini

| What | Why | How |
|---|---|---|
| Xcode Command Line Tools | `git` | `xcode-select --install` |
| Homebrew | installs the rest | https://brew.sh |
| Node.js 22 or newer | runs the agent | `brew install node` |
| GitHub CLI | lets the agent read your GitHub | `brew install gh` then `gh auth login` |
| Claude Code | sends prompts to Claude | `curl -fsSL https://claude.ai/install.sh \| bash` then run `claude` once and log in |
| Tailscale (optional) | open the dashboard from your phone or laptop | `brew install --cask tailscale` |

## Install

```bash
git clone https://github.com/cev64/claudehub.git ~/claudehub
cd ~/claudehub
./scripts/install-mac.sh
```

The script asks where your projects live (for example `~/Desktop/Projects`), builds the
dashboard, and installs a launchd agent that starts at login and restarts if it crashes.
Open http://localhost:4317.

Keep the Mac Mini awake: System Settings → Energy → turn on "Prevent automatic sleeping when the
display is off", and turn on "Start up automatically after a power failure". Set your user to log in
automatically (System Settings → Users & Groups) so the agent comes back after a reboot.

Logs: `~/.claudehub/agent.log`. Stop it with `./scripts/uninstall-mac.sh`.

## Open it from other devices

The agent only listens on the Mac itself by default. To reach it from your phone, use Tailscale
and set an access token. **Anyone who can reach the dashboard can run Claude on your Mac, so
always set a token before opening it to the network:**

```bash
export HOST=0.0.0.0
export CLAUDEHUB_TOKEN="$(openssl rand -hex 24)"; echo "$CLAUDEHUB_TOKEN"
./scripts/install-mac.sh
```

Then open `http://<mac-mini-tailscale-name>:4317` and paste the token in Settings.

## Claude runs

Runs use `claude -p` inside the project folder on the Mac. Permissions: *Plan* (reads only and
proposes changes), *Edit files* (may edit files, but shell commands that need approval are
denied), *Auto* (Claude Code's auto mode, which can also commit and push). Each run keeps its
session, so you can continue it.

There is no cloud mode: `claude --cloud` only works from an interactive terminal, so the agent
can't start one. Start Claude Code on the web sessions at claude.ai/code instead.

The agent removes `ANTHROPIC_API_KEY` from Claude's environment so your subscription is always
used. If a launchd-started `claude` can't reach the Keychain login, run `claude setup-token`
and reinstall with `export CLAUDE_CODE_OAUTH_TOKEN=...` set. The Settings page shows whether
Claude is logged in.

### Optional: drive the Mac Mini from the Claude app

Claude Code's Remote Control lets you start and steer sessions on the Mac Mini from claude.ai/code
or the Claude phone app, with ClaudeHub showing the overall picture. Run `claude` once in your
projects folder, log in, trust the folder and accept the Remote Control prompt. Then run
`claude remote-control --name "Mac Mini"` in a terminal that stays open.

## Usage

The Usage screen shows how much of your Claude plan you have used and where the tokens went:

- **Plan limits**: the 5-hour and weekly percentages and when they reset. These come from
  interactive Claude Code sessions on this Mac and update whenever one runs. Claude.ai chats and
  cloud sessions count toward the same limits but are not itemised here.
- **Tokens**: today, the last 7 days, a 14-day chart, and breakdowns by model, project and session
  (with how full each session's context window is). Counts are read from Claude Code's local
  transcripts in `~/.claude/projects`, a format that can change between Claude Code versions.
- **Last limit notice**: the latest usage warning Claude reported to a job started from ClaudeHub.

To get plan limits, turn on usage capture in ClaudeHub → Usage. That sets Claude Code's
`statusLine` in `~/.claude/settings.json` to `scripts/statusline.mjs`, after saving a copy of the
file to `~/.claudehub/backups/`. If you already have a status line, it keeps running and showing
as before; turning capture off restores it. Nothing else in the file is touched, and an invalid
`settings.json` is left alone. Without capture, token counts still work. (`CLAUDE_CONFIG_DIR` is
honoured if you use a non-default Claude config folder.)

## Develop

```bash
npm install
npm run dev          # agent on :4317 + Vite on :5173
open "http://localhost:5173/?mock=1"   # UI with sample data, no agent needed
```

Layout: `server/` is the agent (Fastify + git + GitHub GraphQL + Claude CLI runner), `web/` is
the React dashboard, `shared/types.ts` is the API contract, and `docs/` holds the design guide.

## Settings

`~/.claudehub/config.json`, also editable in the dashboard: projects folder, scan depth, editor app
(`open -a "Visual Studio Code"`, Cursor, Zed…), refresh interval and default model. Environment
overrides: `PROJECTS_DIR`, `PORT`, `HOST`, `CLAUDEHUB_TOKEN`, `GITHUB_TOKEN`, `CLAUDE_BIN`,
`CLAUDEHUB_HOME`, `CLAUDE_CONFIG_DIR`.

## Status

- Works now: the Mac agent (scanning, GitHub sync, Claude runs, new projects, launchd) and the
  dashboard, served by the agent at http://localhost:4317.
- Supabase relay: the `claudehub` schema exists in the Budget project
  (`supabase/migrations/`), but the agent and dashboard don't use it yet. Until then, reach the
  dashboard from other devices with Tailscale.
- What's left to build and verify, and how: [`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md). Repo
  guide for Claude Code: [`CLAUDE.md`](CLAUDE.md).
