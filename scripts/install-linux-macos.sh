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

echo "[memok-ai installer] cloning/updating source..."
if [ -d "$TARGET_DIR/.git" ]; then
  git -C "$TARGET_DIR" fetch --depth=1 origin main
  git -C "$TARGET_DIR" checkout -f origin/main
else
  rm -rf "$TARGET_DIR"
  mkdir -p "$(dirname "$TARGET_DIR")"
  git clone --depth=1 "$REPO_URL" "$TARGET_DIR"
fi

echo "[memok-ai installer] installing plugin..."
openclaw plugins install "$TARGET_DIR"

echo "[memok-ai installer] running interactive setup..."
openclaw memok setup

echo
echo "[memok-ai installer] done. Please restart OpenClaw gateway."
