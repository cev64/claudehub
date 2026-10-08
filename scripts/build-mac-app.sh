#!/usr/bin/env bash
# Builds ClaudeHub.app, a native window onto the ClaudeHub agent's dashboard (http://127.0.0.1:4317).
# Needs Xcode or the Command Line Tools (swiftc). No Xcode project: sources are in mac/.
#
# Usage: ./scripts/build-mac-app.sh [--install]
#   --install   also copy the app to ~/Applications/ClaudeHub.app (replacing an existing one)
#
# The dashboard address can be changed per user: defaults write com.claudehub.app url http://host:4317
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO/mac"
BUILD="$REPO/build"
APP="$BUILD/ClaudeHub.app"
INSTALL_DIR="$HOME/Applications"
TARGET="arm64-apple-macos14"

say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --install) INSTALL=1 ;;
    -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option: $arg (try --help)" ;;
  esac
done

[ "$(uname -s)" = "Darwin" ] || die "ClaudeHub.app is a macOS app."
for tool in swiftc xcrun sips iconutil codesign plutil ditto; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool not found. Install Xcode or run: xcode-select --install"
done
SDK="$(xcrun --sdk macosx --show-sdk-path 2>/dev/null)" || die "macOS SDK not found. Run: xcode-select --install"

# -- compile -----------------------------------------------------------------------------
say "Compiling ClaudeHub ($TARGET)"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$BUILD/tools"
swiftc -O -swift-version 6 -target "$TARGET" -sdk "$SDK" \
  -o "$APP/Contents/MacOS/ClaudeHub" "$SRC"/ClaudeHub/*.swift

# -- icon --------------------------------------------------------------------------------
say "Drawing the app icon"
swiftc -O -target "$TARGET" -sdk "$SDK" -o "$BUILD/tools/make-icon" "$SRC/tools/make-icon.swift"
ICONSET="$BUILD/AppIcon.iconset"
rm -rf "$ICONSET"
mkdir -p "$ICONSET"
"$BUILD/tools/make-icon" "$BUILD/AppIcon-1024.png"
for px in 16 32 128 256 512; do
  sips -z "$px" "$px" "$BUILD/AppIcon-1024.png" --out "$ICONSET/icon_${px}x${px}.png" >/dev/null
  double=$((px * 2))
  sips -z "$double" "$double" "$BUILD/AppIcon-1024.png" --out "$ICONSET/icon_${px}x${px}@2x.png" >/dev/null
done
iconutil -c icns -o "$APP/Contents/Resources/AppIcon.icns" "$ICONSET"

# -- bundle ------------------------------------------------------------------------------
say "Assembling $APP"
cp "$SRC/Info.plist" "$APP/Contents/Info.plist"
BUILD_NUMBER="$(git -C "$REPO" rev-list --count HEAD 2>/dev/null || echo 1)"
plutil -replace CFBundleVersion -string "$BUILD_NUMBER" "$APP/Contents/Info.plist"
plutil -lint -s "$APP/Contents/Info.plist" || die "Info.plist is invalid."
printf 'APPL????' > "$APP/Contents/PkgInfo"

say "Signing (ad hoc)"
codesign --force --deep -s - "$APP"
codesign --verify --strict "$APP" || die "Signature check failed."

# -- install -----------------------------------------------------------------------------
if [ "$INSTALL" = 1 ]; then
  DEST="$INSTALL_DIR/ClaudeHub.app"
  say "Installing to $DEST"
  mkdir -p "$INSTALL_DIR"
  rm -rf "$DEST"
  ditto "$APP" "$DEST"
  if pgrep -xq ClaudeHub; then
    warn "ClaudeHub is running. Quit it (⌘Q) and open it again to use this build."
  fi
  say "Done. Open it with: open \"$DEST\""
else
  say "Done. Run it with: open \"$APP\" (or re-run with --install)"
fi
