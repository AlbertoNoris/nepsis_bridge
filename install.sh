#!/usr/bin/env bash
#
# Nepsis Bridge Installer
#
# Usage:
#   curl -fsSL https://YOUR_DOMAIN/install.sh | bash
#
# What it does:
#   1. Downloads the pre-built Nepsis Bridge for your Mac
#   2. Installs it to ~/.nepsis/
#   3. Starts the background daemon (auto-starts on login)
#   4. Adds 'nepsis' to your PATH
#   5. Generates a temporary pairing code
#
set -euo pipefail

NEPSIS_DIR="$HOME/.nepsis"
LAUNCHD_LABEL="com.nepsis.daemon"
LAUNCHD_PLIST="$HOME/Library/LaunchAgents/${LAUNCHD_LABEL}.plist"
GITHUB_REPO="AlbertoNoris/nepsis_bridge"
RELAY_URL="wss://nepsis.stolenorbit.com"

# --- Helpers ---

info()  { echo "=> $*"; }
error() { echo "ERROR: $*" >&2; exit 1; }

# --- Pre-flight checks ---

if [ "$(uname -s)" != "Darwin" ]; then
  error "Nepsis Bridge is currently macOS only."
fi

# Detect architecture
ARCH="$(uname -m)"
case "$ARCH" in
  arm64)  TARBALL_ARCH="arm64" ;;
  x86_64) TARBALL_ARCH="x64"   ;;
  *)      error "Unsupported architecture: $ARCH" ;;
esac

# --- Determine download URL ---

# Allow override for local testing: NEPSIS_TARBALL=/path/to/file.tar.gz
if [ -n "${NEPSIS_TARBALL:-}" ]; then
  info "Using local tarball: $NEPSIS_TARBALL"
  LOCAL_TARBALL="$NEPSIS_TARBALL"
else
  TARBALL_NAME="nepsis-darwin-${TARBALL_ARCH}.tar.gz"
  DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/releases/latest/download/${TARBALL_NAME}"
  info "Downloading Nepsis Bridge for macOS ${TARBALL_ARCH}..."
  LOCAL_TARBALL="$(mktemp)"
  curl -fsSL "$DOWNLOAD_URL" -o "$LOCAL_TARBALL" || error "Download failed. Check your internet connection and try again."
fi

# --- Stop existing daemon if running ---

if launchctl print "gui/$(id -u)/${LAUNCHD_LABEL}" &>/dev/null; then
  info "Stopping existing Nepsis daemon..."
  launchctl bootout "gui/$(id -u)/${LAUNCHD_LABEL}" 2>/dev/null || true
  sleep 1
fi

# --- Install ---

info "Installing to ${NEPSIS_DIR}/..."
mkdir -p "$NEPSIS_DIR"

# Extract tarball (overwrites existing files)
tar -xzf "$LOCAL_TARBALL" -C "$NEPSIS_DIR"

# Clean up temp download
if [ -z "${NEPSIS_TARBALL:-}" ]; then
  rm -f "$LOCAL_TARBALL"
fi

# Verify the install
if [ ! -x "$NEPSIS_DIR/bin/nepsis" ]; then
  error "Installation failed — nepsis binary not found."
fi
if [ ! -x "$NEPSIS_DIR/node/bin/node" ]; then
  error "Installation failed — bundled Node.js not found."
fi

# --- Setup launchd daemon ---

info "Configuring background daemon..."

NODE_EXEC="$NEPSIS_DIR/node/bin/node"
CLI_ENTRY="$NEPSIS_DIR/bridge/packages/cli/dist/index.js"

mkdir -p "$(dirname "$LAUNCHD_PLIST")"

cat > "$LAUNCHD_PLIST" << PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LAUNCHD_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_EXEC}</string>
        <string>${CLI_ENTRY}</string>
        <string>daemon</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${NEPSIS_DIR}/daemon.log</string>
    <key>StandardErrorPath</key>
    <string>${NEPSIS_DIR}/daemon.err</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${HOME}</string>
        <key>NEPSIS_RELAY_URL</key>
        <string>${RELAY_URL}</string>
    </dict>
</dict>
</plist>
PLIST

# Start the daemon
info "Starting daemon..."
launchctl bootstrap "gui/$(id -u)" "$LAUNCHD_PLIST" 2>/dev/null || {
  # Fallback for older macOS
  launchctl load "$LAUNCHD_PLIST" 2>/dev/null || true
}

# --- Setup PATH ---

append_to_profile() {
  local profile="$HOME/$1"
  if [ ! -f "$profile" ]; then
    touch "$profile"
  fi
  if ! grep -q 'nepsis' "$profile" 2>/dev/null; then
    printf '\n# Nepsis Bridge CLI\nexport PATH="$HOME/.nepsis/bin:$PATH"\n' >> "$profile"
  fi
}

case "${SHELL:-/bin/zsh}" in
  */zsh)
    append_to_profile ".zshrc"
    ;;
  */bash)
    append_to_profile ".bash_profile"
    append_to_profile ".bashrc"
    ;;
  */fish)
    FISH_CONFIG="$HOME/.config/fish/config.fish"
    mkdir -p "$(dirname "$FISH_CONFIG")"
    if ! grep -q 'nepsis' "$FISH_CONFIG" 2>/dev/null; then
      printf '\n# Nepsis Bridge CLI\nfish_add_path $HOME/.nepsis/bin\n' >> "$FISH_CONFIG"
    fi
    ;;
  *)
    # Default to zsh (macOS default)
    append_to_profile ".zshrc"
    ;;
esac

# Make nepsis available in the current script context
export PATH="$NEPSIS_DIR/bin:$PATH"

# --- Wait for daemon and generate pairing code ---

SOCKET_PATH="/tmp/nepsis-daemon.sock"
info "Waiting for daemon to start..."
DAEMON_READY=false
for i in $(seq 1 15); do
  if [ -S "$SOCKET_PATH" ]; then
    DAEMON_READY=true
    break
  fi
  sleep 1
done

PAIR_OUTPUT=""
if [ "$DAEMON_READY" = true ]; then
  info "Generating pairing code..."
  PAIR_OUTPUT="$("$NEPSIS_DIR/bin/nepsis" pair --display 2>&1)" || true
fi

# --- Done ---

echo ""
echo "============================================="
echo "       Nepsis Bridge is Installed!           "
echo "============================================="
echo ""

if [ -n "$PAIR_OUTPUT" ]; then
  echo "$PAIR_OUTPUT"
else
  echo "  The daemon is starting up..."
  echo "  Run 'nepsis pair' to generate a pairing code."
fi

echo ""
echo "  The 'nepsis' command is ready in any new terminal."
echo ""

case "${SHELL:-/bin/zsh}" in
  */zsh)  echo "  To use it now: source ~/.zshrc" ;;
  */bash) echo "  To use it now: source ~/.bash_profile" ;;
  */fish) echo "  To use it now: source ~/.config/fish/config.fish" ;;
esac

echo ""
echo "  The daemon runs in the background and starts"
echo "  automatically when you log in."
echo "============================================="
