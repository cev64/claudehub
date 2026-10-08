#!/usr/bin/env bash
# Keeps `claude remote-control` running in your projects folder as a launchd service, so you can
# start Claude sessions on this Mac from the Claude app or claude.ai/code at any time.
#
#   ./scripts/install-remote-control.sh [folder] [name]    # default: ~/Desktop/DEV "Mac Mini"
#   ./scripts/install-remote-control.sh --uninstall
#
# Run `claude remote-control` in that folder once by hand first: it asks to enable Remote Control,
# to trust the folder and for a spawn mode, and a background service can't answer those.
set -euo pipefail

LABEL="com.claudehub.remote-control"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DATA_DIR="${CLAUDEHUB_HOME:-$HOME/.claudehub}"
UID_NUM="$(id -u)"

say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || die "This installer is for macOS (launchd)."

if [ "${1:-}" = "--uninstall" ]; then
  launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  say "Removed $LABEL"
  exit 0
fi

DIR="${1:-$HOME/Desktop/DEV}"
NAME="${2:-Mac Mini}"
case "$DIR" in "~"*) DIR="$HOME${DIR#\~}";; esac
[ -d "$DIR" ] || die "$DIR is not a folder."
DIR="$(cd "$DIR" && pwd)"

export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
CLAUDE_BIN="${CLAUDE_BIN:-$(command -v claude || true)}"
[ -n "$CLAUDE_BIN" ] || die "claude not found. Install it: curl -fsSL https://claude.ai/install.sh | bash"
claude auth status >/dev/null 2>&1 || die "claude is not logged in. Run: claude, then /login"

xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

mkdir -p "$DATA_DIR" "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(xml "$CLAUDE_BIN")</string>
        <string>remote-control</string>
        <string>--name</string>
        <string>$(xml "$NAME")</string>
        <string>--spawn</string>
        <string>same-dir</string>
    </array>
    <key>WorkingDirectory</key><string>$(xml "$DIR")</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key><string>$(xml "$PATH")</string>
        <key>HOME</key><string>$(xml "$HOME")</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>ThrottleInterval</key><integer>30</integer>
    <!-- stdout is a live status screen that redraws constantly (~45 MB a day); keep errors only. -->
    <key>StandardOutPath</key><string>/dev/null</string>
    <key>StandardErrorPath</key><string>$(xml "$DATA_DIR/remote-control.log")</string>
</dict>
</plist>
PLIST_EOF
plutil -lint "$PLIST" >/dev/null || die "Generated plist is invalid: $PLIST"
say "Wrote $PLIST"

launchctl bootout "gui/$UID_NUM/$LABEL" 2>/dev/null || true
sleep 1
launchctl bootstrap "gui/$UID_NUM" "$PLIST"
say "Remote Control is running in $DIR as \"$NAME\""
echo "    Errors:    $DATA_DIR/remote-control.log"
echo "    Uninstall: $0 --uninstall"
