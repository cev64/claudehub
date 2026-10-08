#!/usr/bin/env bash
# Installs the ClaudeHub agent as a launchd service on macOS. Safe to run again.
#
# Optional environment variables read at install time and written into the service:
#   HOST, PORT               listen address (default 127.0.0.1:4317)
#   CLAUDEHUB_TOKEN          required bearer token for non-loopback requests
#   CLAUDE_CODE_OAUTH_TOKEN  long-lived Claude login from `claude setup-token` (headless Macs)
#   GITHUB_TOKEN             GitHub token (otherwise `gh auth token` is used)
# ANTHROPIC_API_KEY is deliberately never copied: it would override your Claude subscription.
set -euo pipefail

LABEL="com.claudehub.agent"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${CLAUDEHUB_HOME:-$HOME/.claudehub}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PORT_VALUE="${PORT:-4317}"
HOST_VALUE="${HOST:-127.0.0.1}"

say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "This installer is for macOS (launchd)."

# -- prerequisites -----------------------------------------------------------------------
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin"

command -v node >/dev/null 2>&1 || die "Node.js not found. Install Node 22+ (brew install node)."
NODE_BIN="$(command -v node)"
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || die "Node 22 or newer is required (found $("$NODE_BIN" -v))."
command -v git >/dev/null 2>&1 || die "git not found. Run: xcode-select --install"
command -v gh  >/dev/null 2>&1 || warn "gh (GitHub CLI) not found. GitHub features need it or GITHUB_TOKEN: brew install gh && gh auth login"
if command -v gh >/dev/null 2>&1 && ! gh auth status >/dev/null 2>&1; then
  warn "gh is not logged in. Run: gh auth login"
fi
if command -v claude >/dev/null 2>&1; then
  claude auth status >/dev/null 2>&1 || warn "claude is not logged in. Run: claude, then /login (or export CLAUDE_CODE_OAUTH_TOKEN from 'claude setup-token' and re-run this script)."
else
  warn "claude CLI not found. Claude jobs need it: https://claude.ai/code"
fi
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  warn "ANTHROPIC_API_KEY is set in this shell. It is NOT copied into the service so your Claude subscription is used."
fi

# -- build -------------------------------------------------------------------------------
cd "$REPO"
say "Installing dependencies"
npm install --no-audit --no-fund
say "Building the web app"
npm run build

TSX_CLI="$REPO/node_modules/tsx/dist/cli.mjs"
[ -f "$TSX_CLI" ] || die "tsx CLI not found at $TSX_CLI (did npm install succeed?)."
[ -f "$REPO/server/src/index.ts" ] || die "server/src/index.ts missing."

# -- config ------------------------------------------------------------------------------
mkdir -p "$DATA_DIR"
if [ ! -f "$DATA_DIR/config.json" ]; then
  DEFAULT_DIR="$HOME/Desktop"
  read -r -p "Folder that contains your projects [$DEFAULT_DIR]: " PROJECTS_INPUT
  PROJECTS_INPUT="${PROJECTS_INPUT:-$DEFAULT_DIR}"
  case "$PROJECTS_INPUT" in "~"*) PROJECTS_INPUT="$HOME${PROJECTS_INPUT#\~}";; esac
  [ -d "$PROJECTS_INPUT" ] || warn "$PROJECTS_INPUT does not exist yet."
  PROJECTS_DIR_VALUE="$PROJECTS_INPUT" "$NODE_BIN" -e '
    const fs = require("fs");
    const cfg = { projectsDir: process.env.PROJECTS_DIR_VALUE, scanDepth: 2, editor: "Visual Studio Code", refreshMinutes: 5, defaultModel: null };
    fs.writeFileSync(process.argv[1], JSON.stringify(cfg, null, 2));
  ' "$DATA_DIR/config.json"
  say "Wrote $DATA_DIR/config.json"
else
  say "Keeping existing $DATA_DIR/config.json"
fi

# -- launchd plist -----------------------------------------------------------------------
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
ENV_LINES=""
add_env() { ENV_LINES="$ENV_LINES        <key>$1</key><string>$(xml "$2")</string>
"; }

SERVICE_PATH="$PATH"
for extra in /opt/homebrew/bin /usr/local/bin "$HOME/.local/bin"; do
  case ":$SERVICE_PATH:" in *":$extra:"*) ;; *) SERVICE_PATH="$SERVICE_PATH:$extra";; esac
done
add_env PATH "$SERVICE_PATH"
add_env HOME "$HOME"
[ -n "${CLAUDEHUB_HOME:-}" ]          && add_env CLAUDEHUB_HOME "$CLAUDEHUB_HOME"
[ -n "${HOST:-}" ]                    && add_env HOST "$HOST"
[ -n "${PORT:-}" ]                    && add_env PORT "$PORT"
[ -n "${CLAUDEHUB_TOKEN:-}" ]         && add_env CLAUDEHUB_TOKEN "$CLAUDEHUB_TOKEN"
[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && add_env CLAUDE_CODE_OAUTH_TOKEN "$CLAUDE_CODE_OAUTH_TOKEN"
[ -n "${GITHUB_TOKEN:-}" ]            && add_env GITHUB_TOKEN "$GITHUB_TOKEN"
[ -n "${CLAUDE_BIN:-}" ]              && add_env CLAUDE_BIN "$CLAUDE_BIN"

if [ -n "${HOST:-}" ] && [ "$HOST" != "127.0.0.1" ] && [ "$HOST" != "localhost" ] && [ -z "${CLAUDEHUB_TOKEN:-}" ]; then
  warn "HOST=$HOST exposes the agent on your network without CLAUDEHUB_TOKEN. Set CLAUDEHUB_TOKEN and re-run."
fi

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(xml "$NODE_BIN")</string>
        <string>$(xml "$TSX_CLI")</string>
        <string>$(xml "$REPO/server/src/index.ts")</string>
    </array>
    <key>WorkingDirectory</key><string>$(xml "$REPO")</string>
    <key>EnvironmentVariables</key>
    <dict>
$ENV_LINES    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>$(xml "$DATA_DIR/agent.log")</string>
    <key>StandardErrorPath</key><string>$(xml "$DATA_DIR/agent.log")</string>
</dict>
</plist>
PLIST_EOF
chmod 600 "$PLIST"   # may contain tokens
plutil -lint "$PLIST" >/dev/null || die "Generated plist is invalid: $PLIST"
say "Wrote $PLIST"

# -- (re)start ---------------------------------------------------------------------------
UID_NUM="$(id -u)"
launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
sleep 1
launchctl bootstrap "gui/$UID_NUM" "$PLIST"
launchctl kickstart -k "gui/$UID_NUM/$LABEL" 2>/dev/null || true

SHOW_HOST="$HOST_VALUE"
case "$SHOW_HOST" in 0.0.0.0|::) SHOW_HOST="$(hostname)";; esac
say "ClaudeHub is running: http://$SHOW_HOST:$PORT_VALUE"
echo "    Logs:      $DATA_DIR/agent.log"
echo "    Uninstall: $REPO/scripts/uninstall-mac.sh"
