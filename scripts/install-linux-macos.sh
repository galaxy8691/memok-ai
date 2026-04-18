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

run_openclaw_plugins_install() {
  local dir="$1"
  if [ "${MEMOK_PLUGINS_INSTALL_NO_PTY:-0}" != "1" ] && [ "$(uname -s)" = Linux ] && command -v script >/dev/null 2>&1; then
    echo "[memok-ai installer] running plugins install inside a pseudo-TTY (Linux)."
    script -qec "openclaw plugins install $(printf %q "$dir")" /dev/null
  else
    openclaw plugins install "$dir"
  fi
}

# Second `plugins install` fails if ~/.openclaw/extensions/memok-ai already exists.
# Copy dist + manifest (+ skills) only; keep sqlite, .env, node_modules.
sync_memok_installed_plugin_from_source() {
  local src="$1"
  local name dest
  name="$(cd "$src" && node -p "require('./package.json').name")"
  dest="$(dirname "$src")/$name"
  if [ ! -d "$dest" ] || [ ! -f "$dest/package.json" ]; then
    echo "[memok-ai installer] installed dir missing at $dest; running openclaw plugins install..."
    run_openclaw_plugins_install "$src"
    return
  fi
  echo "[memok-ai installer] syncing dist/, openclaw.plugin.json, skills/ into $dest ..."
  rm -rf "$dest/dist"
  cp -a "$src/dist" "$dest/"
  cp -f "$src/openclaw.plugin.json" "$dest/"
  if [ -d "$src/skills" ]; then
    rm -rf "$dest/skills"
    cp -a "$src/skills" "$dest/"
  fi
  if [ -f "$src/LICENSE" ]; then
    cp -f "$src/LICENSE" "$dest/"
  fi
}

restart_gateway_end() {
  if [ "${MEMOK_SKIP_GATEWAY_RESTART:-0}" = "1" ]; then
    echo "[memok-ai installer] skipping gateway restart (MEMOK_SKIP_GATEWAY_RESTART=1). Run: openclaw gateway restart"
    return 0
  fi
  local gw_timeout="${MEMOK_GATEWAY_RESTART_TIMEOUT_SECONDS:-120}"
  echo "[memok-ai installer] restarting OpenClaw gateway to apply configuration..."
  if run_with_timeout "$gw_timeout" openclaw gateway restart; then
    return 0
  fi
  if run_with_timeout "$gw_timeout" openclaw restart; then
    return 0
  fi
  echo "[memok-ai installer] warning: gateway restart failed or timed out (${gw_timeout}s). Run manually: openclaw gateway restart" >&2
  return 1
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
need_cmd node

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
echo "[memok-ai installer] if stuck after OpenClaw's last line, try MEMOK_PLUGINS_INSTALL_NO_PTY=1 or Ctrl+C then: openclaw memok setup"
plugins_to="${MEMOK_PLUGINS_INSTALL_TIMEOUT_SECONDS:-0}"
if [ "$plugins_to" -gt 0 ] 2>/dev/null; then
  echo "[memok-ai installer] plugins install bounded by ${plugins_to}s (MEMOK_PLUGINS_INSTALL_TIMEOUT_SECONDS)."
  if ! run_with_timeout "$plugins_to" bash -c "$(declare -f run_openclaw_plugins_install); run_openclaw_plugins_install \"\$1\"" _ "$TARGET_DIR"; then
    echo "[memok-ai installer] error: openclaw plugins install failed or timed out." >&2
    echo "[memok-ai installer] try: openclaw plugins install \"$TARGET_DIR\"" >&2
    exit 1
  fi
else
  run_openclaw_plugins_install "$TARGET_DIR"
fi

echo "[memok-ai installer] plugin install finished; next: interactive memok setup (gateway will be restarted at the end on success)."

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

echo "[memok-ai installer] setup done; rebuilding and syncing built artifacts into the installed extension dir."
npm --prefix "$TARGET_DIR" run build
sync_memok_installed_plugin_from_source "$TARGET_DIR"

cleanup_source_dir

set +e
restart_gateway_end
set -e

echo
echo "[memok-ai installer] done."
