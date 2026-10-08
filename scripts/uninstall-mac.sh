#!/usr/bin/env bash
# Stops the ClaudeHub agent and removes its launchd service. Your data in ~/.claudehub is kept.
set -euo pipefail
LABEL="com.claudehub.agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
[ "$(uname -s)" = "Darwin" ] || { echo "error: macOS only" >&2; exit 1; }
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$PLIST"
echo "ClaudeHub agent removed. Settings and job history remain in ${CLAUDEHUB_HOME:-$HOME/.claudehub}."
