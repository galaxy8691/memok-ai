#!/usr/bin/env bash
set -euo pipefail

# China-optimized installer:
# - Prefer Gitee mirror
# - Fallback to GitHub
# - Use npm mirror registry by default

REPO_URL_CN="${MEMOK_REPO_URL_CN:-https://gitee.com/galaxy8691/memok-ai.git}"
REPO_URL_FALLBACK="${MEMOK_REPO_URL_FALLBACK:-https://github.com/galaxy8691/memok-ai.git}"
TARGET_DIR="${MEMOK_INSTALL_DIR:-$HOME/.openclaw/extensions/memok-ai-src}"
NPM_REGISTRY="${MEMOK_NPM_REGISTRY:-https://registry.npmmirror.com}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[memok-ai cn installer] missing required command: $1" >&2
    exit 1
  fi
}

restart_gateway() {
  local reason="$1"
  local wait_seconds="${MEMOK_RESTART_WAIT_SECONDS:-20}"
  echo "[memok-ai cn installer] restarting OpenClaw gateway (${reason})..."
  if openclaw gateway restart; then
    echo "[memok-ai cn installer] waiting ${wait_seconds}s for gateway to come back..."
    sleep "${wait_seconds}"
  elif openclaw restart; then
    echo "[memok-ai cn installer] waiting ${wait_seconds}s for gateway to come back..."
    sleep "${wait_seconds}"
  else
    echo "[memok-ai cn installer] warning: gateway restart command failed, continuing."
  fi
}

wait_memok_command_ready() {
  local max_attempts="${MEMOK_SETUP_WAIT_ATTEMPTS:-10}"
  local delay_seconds="${MEMOK_SETUP_WAIT_INTERVAL_SECONDS:-2}"
  local i=1
  while [ "$i" -le "$max_attempts" ]; do
    if openclaw memok --help >/dev/null 2>&1; then
      return 0
    fi
    sleep "${delay_seconds}"
    i=$((i + 1))
  done
  return 1
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
  echo "[memok-ai cn installer] cloning from primary mirror..."
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

echo "[memok-ai cn installer] installing plugin..."
openclaw plugins install "$TARGET_DIR"

restart_gateway "load newly installed plugin"
if ! wait_memok_command_ready; then
  echo "[memok-ai cn installer] warning: memok CLI is not ready yet; setup may fail."
fi

echo "[memok-ai cn installer] running interactive setup..."
set +e
SETUP_OUTPUT="$(openclaw memok setup 2>&1)"
SETUP_STATUS=$?
set -e
printf '%s\n' "$SETUP_OUTPUT"

if [ $SETUP_STATUS -ne 0 ]; then
  if printf '%s' "$SETUP_OUTPUT" | grep -q "unknown command 'memok'"; then
    echo "[memok-ai cn installer] memok command unavailable. Please upgrade OpenClaw (>= 2026.3.24)."
  elif printf '%s' "$SETUP_OUTPUT" | grep -q 'plugins\.allow excludes "memok"'; then
    echo "[memok-ai cn installer] setup blocked by plugins.allow."
    echo "[memok-ai cn installer] add \"memok\" to ~/.openclaw/openclaw.json -> plugins.allow, then run: openclaw memok setup"
  else
    echo "[memok-ai cn installer] setup command failed. Please run manually: openclaw memok setup"
  fi
  exit $SETUP_STATUS
fi

restart_gateway "apply setup config"
cleanup_source_dir

echo
echo "[memok-ai cn installer] done."
