#!/usr/bin/env bash
set -euo pipefail

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

restart_gateway() {
  local reason="$1"
  local wait_seconds="${MEMOK_RESTART_WAIT_SECONDS:-20}"
  local gw_timeout="${MEMOK_GATEWAY_RESTART_TIMEOUT_SECONDS:-120}"
  if [ "${MEMOK_SKIP_GATEWAY_RESTART:-0}" = "1" ]; then
    echo "[memok-ai installer] skipping gateway restart (MEMOK_SKIP_GATEWAY_RESTART=1). Restart the gateway yourself if needed."
    return 0
  fi
  echo "[memok-ai installer] restarting OpenClaw gateway (${reason})..."
  if run_with_timeout "$gw_timeout" openclaw gateway restart; then
    echo "[memok-ai installer] waiting ${wait_seconds}s for gateway to come back..."
    sleep "${wait_seconds}"
  elif run_with_timeout "$gw_timeout" openclaw restart; then
    echo "[memok-ai installer] waiting ${wait_seconds}s for gateway to come back..."
    sleep "${wait_seconds}"
  else
    echo "[memok-ai installer] warning: gateway restart failed or timed out after ${gw_timeout}s; continuing."
  fi
}

wait_memok_command_ready() {
  local max_attempts="${MEMOK_SETUP_WAIT_ATTEMPTS:-10}"
  local delay_seconds="${MEMOK_SETUP_WAIT_INTERVAL_SECONDS:-2}"
  local cli_timeout="${MEMOK_CLI_TIMEOUT_SECONDS:-15}"
  local i=1
  while [ "$i" -le "$max_attempts" ]; do
    echo "[memok-ai installer] checking memok CLI (${i}/${max_attempts}, ${cli_timeout}s timeout per check)..."
    if run_with_timeout "$cli_timeout" openclaw memok --help >/dev/null 2>&1; then
      return 0
    fi
    sleep "${delay_seconds}"
    i=$((i + 1))
  done
  return 1
}

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

echo "[memok-ai installer] installing plugin..."
openclaw plugins install "$TARGET_DIR"

echo "[memok-ai installer] install step finished; next: gateway restart then memok setup."
restart_gateway "load newly installed plugin"
if ! wait_memok_command_ready; then
  echo "[memok-ai installer] warning: memok CLI is not ready yet; setup may fail."
fi

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

restart_gateway "apply setup config"
cleanup_source_dir

echo
echo "[memok-ai installer] done."
