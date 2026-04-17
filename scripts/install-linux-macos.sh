#!/usr/bin/env bash
set -euo pipefail

if [ -r /dev/tty ]; then
  exec < /dev/tty || true
fi

REPO_URL="${MEMOK_REPO_URL:-https://github.com/galaxy8691/memok-ai.git}"
TARGET_DIR="${MEMOK_INSTALL_DIR:-$HOME/.openclaw/extensions/memok-ai-src}"

run_with_timeout() {
  local seconds="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$seconds" "$@"
  else
    "$@"
  fi
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[memok-ai installer] missing required command: $1" >&2
    exit 1
  fi
}

need_cmd git
need_cmd openclaw
need_cmd npm

cleanup_source_dir() {
  if [ "${MEMOK_KEEP_SOURCE:-0}" = "1" ]; then
    echo "[memok-ai installer] keeping source dir: $TARGET_DIR (MEMOK_KEEP_SOURCE=1)"
    return
  fi
  if [ -d "$TARGET_DIR" ]; then
    rm -rf "$TARGET_DIR"
    echo "[memok-ai installer] removed source dir: $TARGET_DIR"
  fi
}

echo "[memok-ai installer] cloning/updating source..."
if [ -d "$TARGET_DIR/.git" ]; then
  git -C "$TARGET_DIR" fetch --depth=1 origin main
  git -C "$TARGET_DIR" checkout -f origin/main
else
  rm -rf "$TARGET_DIR"
  mkdir -p "$(dirname "$TARGET_DIR")"
  git clone --depth=1 "$REPO_URL" "$TARGET_DIR"
fi

echo "[memok-ai installer] building plugin dist..."
npm --prefix "$TARGET_DIR" install
npm --prefix "$TARGET_DIR" run build

echo "[memok-ai installer] installing plugin via OpenClaw (may take a while)..."
plugins_to="${MEMOK_PLUGINS_INSTALL_TIMEOUT_SECONDS:-0}"
if [ "$plugins_to" -gt 0 ] 2>/dev/null; then
  echo "[memok-ai installer] plugins install bounded by ${plugins_to}s (MEMOK_PLUGINS_INSTALL_TIMEOUT_SECONDS)."
  if ! run_with_timeout "$plugins_to" openclaw plugins install "$TARGET_DIR"; then
    echo "[memok-ai installer] error: openclaw plugins install failed or timed out." >&2
    echo "[memok-ai installer] try: openclaw plugins install \"$TARGET_DIR\"" >&2
    exit 1
  fi
else
  openclaw plugins install "$TARGET_DIR"
fi

echo "[memok-ai installer] install step finished; next: memok setup (restart the gateway yourself when you want new plugins loaded)."

echo "[memok-ai installer] running interactive setup..."
# Do NOT capture stdout/stderr: `openclaw memok setup` uses readline prompts; command substitution
# would hide all questions and look like a hang while still waiting for stdin.
set +e
openclaw memok setup
SETUP_STATUS=$?
set -e

if [ $SETUP_STATUS -ne 0 ]; then
  echo "[memok-ai installer] setup exited with status ${SETUP_STATUS}."
  echo "[memok-ai installer] hints: upgrade OpenClaw (>= 2026.3.24) if 'memok' is unknown;"
  echo "[memok-ai installer] add \"memok\" to plugins.allow in ~/.openclaw/openclaw.json if blocked."
  echo "[memok-ai installer] run manually for full output: openclaw memok setup"
  exit $SETUP_STATUS
fi

cleanup_source_dir

echo
echo "[memok-ai installer] done."
