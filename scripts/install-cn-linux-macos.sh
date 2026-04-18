#!/usr/bin/env bash
set -euo pipefail

# 部分环境下 openclaw 子进程会等 stdin；将 stdin 接到控制终端可减少「已显示 Installed plugin 却仍卡住」。
if [ -r /dev/tty ]; then
  exec < /dev/tty || true
fi

# China-optimized installer:
# - Default clone source: Gitee (中文镜像与境内线路)
# - Override with MEMOK_REPO_URL_CN; fallback with MEMOK_REPO_URL_FALLBACK (default GitHub)
# - Use npm mirror registry by default

REPO_URL_CN="${MEMOK_REPO_URL_CN:-https://gitee.com/wik20/memok-ai.git}"
REPO_URL_FALLBACK="${MEMOK_REPO_URL_FALLBACK:-https://github.com/galaxy8691/memok-ai.git}"
TARGET_DIR="${MEMOK_INSTALL_DIR:-$HOME/.openclaw/extensions/memok-ai-src}"
NPM_REGISTRY="${MEMOK_NPM_REGISTRY:-https://registry.npmmirror.com}"

# 可选：用 coreutils 的 timeout 限制命令运行时间（若已安装）。
run_with_timeout() {
  local seconds="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$seconds" "$@"
  else
    "$@"
  fi
}

# OpenClaw 可能已打印 Installed plugin 仍未退出；Linux 下用 script 提供伪终端。MEMOK_PLUGINS_INSTALL_NO_PTY=1 则直接执行 openclaw。
run_openclaw_plugins_install() {
  local dir="$1"
  if [ "${MEMOK_PLUGINS_INSTALL_NO_PTY:-0}" != "1" ] && [ "$(uname -s)" = Linux ] && command -v script >/dev/null 2>&1; then
    echo "[memok-ai cn installer] 正在通过伪终端安装插件（Linux，可减轻最后一行日志后卡住）…"
    script -qec "openclaw plugins install $(printf %q "$dir")" /dev/null
  else
    openclaw plugins install "$dir"
  fi
}

# setup 之后目录里已有 memok-ai；再次 `plugins install` 会报 plugin already exists。
# 只同步构建产物与清单，保留 memok.sqlite、.env、node_modules。
sync_memok_installed_plugin_from_source() {
  local src="$1"
  local name dest
  name="$(cd "$src" && node -p "require('./package.json').name")"
  dest="$(dirname "$src")/$name"
  if [ ! -d "$dest" ] || [ ! -f "$dest/package.json" ]; then
    echo "[memok-ai cn installer] 未找到已安装目录 $dest ，改为执行 openclaw plugins install…"
    run_openclaw_plugins_install "$src"
    return
  fi
  echo "[memok-ai cn installer] 正在将 dist/、openclaw.plugin.json、skills/ 同步到 $dest …"
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
    echo "[memok-ai cn installer] 已跳过网关重启（MEMOK_SKIP_GATEWAY_RESTART=1）；需要时请自行执行: openclaw gateway restart"
    return 0
  fi
  local gw_timeout="${MEMOK_GATEWAY_RESTART_TIMEOUT_SECONDS:-120}"
  echo "[memok-ai cn installer] 正在重启 OpenClaw 网关以使配置生效…"
  if run_with_timeout "$gw_timeout" openclaw gateway restart; then
    return 0
  fi
  if run_with_timeout "$gw_timeout" openclaw restart; then
    return 0
  fi
  echo "[memok-ai cn installer] 警告：网关重启失败或超时（${gw_timeout}s），请手动执行: openclaw gateway restart" >&2
  return 1
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[memok-ai cn installer] 缺少必要命令: $1" >&2
    exit 1
  fi
}

cleanup_source_dir() {
  if [ "${MEMOK_KEEP_SOURCE:-0}" = "1" ]; then
    echo "[memok-ai cn installer] 保留源码目录: $TARGET_DIR（MEMOK_KEEP_SOURCE=1）"
    return
  fi
  if [ -d "$TARGET_DIR" ]; then
    rm -rf "$TARGET_DIR"
    echo "[memok-ai cn installer] 已删除源码目录: $TARGET_DIR"
  fi
}

clone_or_update_repo() {
  local primary="$1"
  local fallback="$2"

  if [ -d "$TARGET_DIR/.git" ]; then
    echo "[memok-ai cn installer] 正在从已配置的远程更新源码…"
    if ! git -C "$TARGET_DIR" fetch --depth=1 "$primary" main; then
      echo "[memok-ai cn installer] 主源更新失败，尝试备用源…"
      git -C "$TARGET_DIR" fetch --depth=1 "$fallback" main
    fi
    git -C "$TARGET_DIR" checkout -f FETCH_HEAD
    return
  fi

  rm -rf "$TARGET_DIR"
  mkdir -p "$(dirname "$TARGET_DIR")"
  echo "[memok-ai cn installer] 正在从主源克隆…"
  if ! git clone --depth=1 "$primary" "$TARGET_DIR"; then
    echo "[memok-ai cn installer] 主源克隆失败，改用备用源…"
    git clone --depth=1 "$fallback" "$TARGET_DIR"
  fi
}

need_cmd git
need_cmd openclaw
need_cmd npm
need_cmd node

echo "[memok-ai cn installer] 克隆/更新源码…"
clone_or_update_repo "$REPO_URL_CN" "$REPO_URL_FALLBACK"

echo "[memok-ai cn installer] 正在构建插件（registry: $NPM_REGISTRY）…"
npm --prefix "$TARGET_DIR" install --registry "$NPM_REGISTRY" --prefer-offline --no-audit --progress=false
npm --prefix "$TARGET_DIR" run build

echo "[memok-ai cn installer] 正在通过 OpenClaw 安装插件（可能较久；请与下方本脚本提示区分）…"
echo "[memok-ai cn installer] 若 OpenClaw 已显示 Installed plugin，却迟迟不出现「插件安装步骤已完成」，多为 CLI 未退出；可试 MEMOK_PLUGINS_INSTALL_NO_PTY=1，或 Ctrl+C 后执行: openclaw memok setup"
plugins_to="${MEMOK_PLUGINS_INSTALL_TIMEOUT_SECONDS:-0}"
if [ "$plugins_to" -gt 0 ] 2>/dev/null; then
  echo "[memok-ai cn installer] 插件安装最长等待 ${plugins_to} 秒（MEMOK_PLUGINS_INSTALL_TIMEOUT_SECONDS；不设或为 0 表示不限制）"
  if ! run_with_timeout "$plugins_to" bash -c "$(declare -f run_openclaw_plugins_install); run_openclaw_plugins_install \"\$1\"" _ "$TARGET_DIR"; then
    echo "[memok-ai cn installer] 错误：openclaw plugins install 失败或超时。" >&2
    echo "[memok-ai cn installer] 可手动执行: openclaw plugins install \"$TARGET_DIR\"" >&2
    exit 1
  fi
else
  run_openclaw_plugins_install "$TARGET_DIR"
fi

echo "[memok-ai cn installer] 插件安装步骤已完成；接下来：memok 交互配置（完成后将尝试自动重启网关）。"

echo "[memok-ai cn installer] 正在运行交互式配置…"
# Do NOT capture stdout/stderr: `openclaw memok setup` uses readline prompts; command substitution
# would hide all questions and look like a hang while still waiting for stdin.
set +e
openclaw memok setup
SETUP_STATUS=$?
set -e

if [ $SETUP_STATUS -ne 0 ]; then
  echo "[memok-ai cn installer] 配置命令退出，状态码: ${SETUP_STATUS}"
  echo "[memok-ai cn installer] 提示：若提示未知 memok 命令，请将 OpenClaw 升级到 >= 2026.3.24；"
  echo "[memok-ai cn installer] 若被 plugins.allow 拦截，请在 ~/.openclaw/openclaw.json 的 plugins.allow 中加入 \"memok\""
  echo "[memok-ai cn installer] 请手动执行: openclaw memok setup"
  exit $SETUP_STATUS
fi

echo "[memok-ai cn installer] setup 已完成；正在再次 build 并同步到已安装扩展目录（无需再次 plugins install）…"
npm --prefix "$TARGET_DIR" run build
sync_memok_installed_plugin_from_source "$TARGET_DIR"

cleanup_source_dir

set +e
restart_gateway_end
set -e

echo
echo "[memok-ai cn installer] 全部完成。"
