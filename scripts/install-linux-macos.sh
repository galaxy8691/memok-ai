#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${MEMOK_REPO_URL:-https://github.com/galaxy8691/memok-ai.git}"
TARGET_DIR="${MEMOK_INSTALL_DIR:-$HOME/.openclaw/extensions/memok-ai-src}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[memok-ai installer] missing required command: $1" >&2
    exit 1
  fi
}

need_cmd git
need_cmd openclaw
need_cmd npm

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

echo "[memok-ai installer] running interactive setup..."
set +e
SETUP_OUTPUT="$(openclaw memok setup 2>&1)"
SETUP_STATUS=$?
set -e
printf '%s\n' "$SETUP_OUTPUT"

if [ $SETUP_STATUS -ne 0 ]; then
  if printf '%s' "$SETUP_OUTPUT" | grep -q 'plugins\.allow excludes "memok"'; then
    echo "[memok-ai installer] setup blocked by plugins.allow."
    echo "[memok-ai installer] add \"memok\" to ~/.openclaw/openclaw.json -> plugins.allow, then run: openclaw memok setup"
  else
    echo "[memok-ai installer] setup command failed. Please run manually: openclaw memok setup"
  fi
  exit $SETUP_STATUS
fi

echo
echo "[memok-ai installer] done. Please restart OpenClaw gateway."
