#!/usr/bin/env bash
set -euo pipefail

# Long-running `openclaw` subprocesses may wait on stdin; when stdin is not a real TTY (or is inherited oddly),
# `openclaw plugins install` can appear stuck after "Installed plugin". Prefer the controlling terminal.
if [ -r /dev/tty ]; then
  exec < /dev/tty || true
fi

# China-optimized installer:
# - Default to GitHub repo source
# - Optional custom repo mirror via MEMOK_REPO_URL_CN
# - Use npm mirror registry by default

REPO_URL_CN="${MEMOK_REPO_URL_CN:-https://github.com/galaxy8691/memok-ai.git}"
REPO_URL_FALLBACK="${MEMOK_REPO_URL_FALLBACK:-https://github.com/galaxy8691/memok-ai.git}"
TARGET_DIR="${MEMOK_INSTALL_DIR:-$HOME/.openclaw/extensions/memok-ai-src}"
NPM_REGISTRY="${MEMOK_NPM_REGISTRY:-https://registry.npmmirror.com}"

# Optional bounded runtime for commands that may block on RPC/systemd (Linux `timeout` from coreutils).
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
    echo "[memok-ai cn installer] missing required command: $1" >&2
    exit 1
  fi
}

cleanup_source_dir() {
  if [ "${MEMOK_KEEP_SOURCE:-0}" = "1" ]; then
    echo "[memok-ai cn installer] keeping source dir: $TARGET_DIR (MEMOK_KEEP_SOURCE=1)"
    return
  fi
  if [ -d "$TARGET_DIR" ]; then
    rm -rf "$TARGET_DIR"
    echo "[memok-ai cn installer] removed source dir: $TARGET_DIR"
  fi
}

clone_or_update_repo() {
  local primary="$1"
  local fallback="$2"

  if [ -d "$TARGET_DIR/.git" ]; then
    echo "[memok-ai cn installer] updating source from configured remotes..."
    if ! git -C "$TARGET_DIR" fetch --depth=1 "$primary" main; then
      echo "[memok-ai cn installer] primary update failed, trying fallback..."
      git -C "$TARGET_DIR" fetch --depth=1 "$fallback" main
    fi
    git -C "$TARGET_DIR" checkout -f FETCH_HEAD
    return
  fi

  rm -rf "$TARGET_DIR"
  mkdir -p "$(dirname "$TARGET_DIR")"
  echo "[memok-ai cn installer] cloning from primary source..."
  if ! git clone --depth=1 "$primary" "$TARGET_DIR"; then
    echo "[memok-ai cn installer] primary clone failed, cloning from fallback..."
    git clone --depth=1 "$fallback" "$TARGET_DIR"
  fi
}

need_cmd git
need_cmd openclaw
need_cmd npm

echo "[memok-ai cn installer] clone/update source..."
clone_or_update_repo "$REPO_URL_CN" "$REPO_URL_FALLBACK"

echo "[memok-ai cn installer] building plugin dist (registry: $NPM_REGISTRY)..."
npm --prefix "$TARGET_DIR" install --registry "$NPM_REGISTRY" --prefer-offline --no-audit --progress=false
npm --prefix "$TARGET_DIR" run build

echo "[memok-ai cn installer] installing plugin via OpenClaw (may take a while; do not confuse with the next installer lines)..."
plugins_to="${MEMOK_PLUGINS_INSTALL_TIMEOUT_SECONDS:-0}"
if [ "$plugins_to" -gt 0 ] 2>/dev/null; then
  echo "[memok-ai cn installer] plugins install bounded by ${plugins_to}s (MEMOK_PLUGINS_INSTALL_TIMEOUT_SECONDS); unset or 0 = no limit."
  if ! run_with_timeout "$plugins_to" openclaw plugins install "$TARGET_DIR"; then
    echo "[memok-ai cn installer] error: openclaw plugins install failed or timed out." >&2
    echo "[memok-ai cn installer] try: openclaw plugins install \"$TARGET_DIR\"  # or raise MEMOK_PLUGINS_INSTALL_TIMEOUT_SECONDS" >&2
    exit 1
  fi
else
  openclaw plugins install "$TARGET_DIR"
fi

echo "[memok-ai cn installer] install step finished; next: memok setup (restart the gateway yourself when you want new plugins loaded)."

echo "[memok-ai cn installer] running interactive setup..."
# Do NOT capture stdout/stderr: `openclaw memok setup` uses readline prompts; command substitution
# would hide all questions and look like a hang while still waiting for stdin.
set +e
openclaw memok setup
SETUP_STATUS=$?
set -e

if [ $SETUP_STATUS -ne 0 ]; then
  echo "[memok-ai cn installer] setup exited with status ${SETUP_STATUS}."
  echo "[memok-ai cn installer] hints: upgrade OpenClaw (>= 2026.3.24) if 'memok' is unknown;"
  echo "[memok-ai cn installer] add \"memok\" to plugins.allow in ~/.openclaw/openclaw.json if blocked."
  echo "[memok-ai cn installer] run manually for full output: openclaw memok setup"
  exit $SETUP_STATUS
fi

cleanup_source_dir

echo
echo "[memok-ai cn installer] done."
