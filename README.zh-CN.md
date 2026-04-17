# memok-ai

[English](./README.md) | 简体中文

`memok-ai` 是一个基于 Node.js + TypeScript 的记忆流水线项目，用 OpenAI 兼容接口提取长文/对话记忆并写入 SQLite，支持召回、强化和 dreaming 流程。

## 功能概览

- 一步式文章流水线（`article-word-pipeline`），输出稳定 JSON 二元组
- SQLite 导入工具（`words` / `normal_words` / `sentences` 及关联表）
- dreaming 编排（`dreaming-pipeline` = `predream` + story-word-sentence 多轮）
- OpenClaw 插件：对话增量落库 + 记忆召回
- 交互式插件配置（`openclaw memok setup`）

## 环境要求

- Node.js **≥20**（建议 LTS）
- npm

**OpenClaw 插件：**网关 **≥2026.3.24**、plugin API **≥2026.3.24**（见 [package.json](package.json) 中的 `openclaw.compat`）。

安装依赖：

```bash
npm install
```

## 安装方法

### 1）作为 CLI 本地使用

```bash
cp .env.example .env
npm run build
npm run dev -- --help
```

### 2）作为 OpenClaw 插件使用

推荐脚本安装：

```bash
# Linux / macOS
bash <(curl -fsSL https://raw.githubusercontent.com/galaxy8691/memok-ai/main/scripts/install-linux-macos.sh)
```

中国大陆网络推荐（国内镜像加速）：

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/galaxy8691/memok-ai/main/scripts/install-cn-linux-macos.sh)
```

```powershell
# Windows PowerShell
irm https://raw.githubusercontent.com/galaxy8691/memok-ai/main/scripts/install-windows.ps1 | iex
```

```cmd
:: Windows CMD（先下载再运行）
curl -L -o install-windows.cmd https://raw.githubusercontent.com/galaxy8691/memok-ai/main/scripts/install-windows.cmd
install-windows.cmd
```

脚本行为：

- 自动执行 `npm install` + `npm run build`
- 通过 `openclaw plugins install` 自动安装插件
- 运行 `openclaw memok setup`；成功后尝试执行 `openclaw gateway restart`（失败时回退为 `openclaw restart`）以使配置生效
- 安装成功后自动删除源码目录（`~/.openclaw/extensions/memok-ai-src`）

常用安装脚本环境变量：

- `MEMOK_PLUGINS_INSTALL_TIMEOUT_SECONDS`（可选；为 `openclaw plugins install` 设置超时秒数，`0` 表示不限制）
- `MEMOK_PLUGINS_INSTALL_NO_PTY=1`（Linux：跳过基于 `script` 的伪终端包装；默认包装异常时使用）
- `MEMOK_SKIP_GATEWAY_RESTART=1`（跳过脚本末尾的网关重启步骤）
- `MEMOK_GATEWAY_RESTART_TIMEOUT_SECONDS`（默认 `120`；仅 Bash 安装脚本，在可用时对重启命令使用 `timeout`）
- `MEMOK_KEEP_SOURCE=1`（调试时保留源码目录）
- `MEMOK_REPO_URL_CN`（可选自定义仓库镜像，默认 GitHub；国内安装脚本）
- `MEMOK_REPO_URL_FALLBACK`（回退仓库，默认 GitHub；国内安装脚本）
- `MEMOK_NPM_REGISTRY`（默认 `https://registry.npmmirror.com`；国内安装脚本）

若 `openclaw plugins install` 已显示成功但进程迟迟不退出（安装脚本停在下一行提示之前），多为 OpenClaw CLI 未结束；在 Linux 上安装脚本会在 `script` 下运行该命令以减轻此问题。也可 `Ctrl+C` 后若插件文件已就绪，直接执行 `openclaw memok setup`。避免同一插件注册两次（例如同时配置 `memok-ai` 与 `memok-ai-src` 路径）——在 `openclaw.json` 中删除重复项可消除「duplicate plugin id」警告。

如果 setup 报错 `plugins.allow excludes "memok"`，请在 `~/.openclaw/openclaw.json` 的 `plugins.allow` 增加 `"memok"`，然后重试：

```bash
openclaw memok setup
```

手动安装备用方案：

```bash
git clone https://github.com/galaxy8691/memok-ai.git
openclaw plugins install ./memok-ai
openclaw memok setup
```

向导可配置：

- LLM 供应商 / API Key / 模型预设（可手填覆盖）
- 是否独占 memory 槽位（默认不独占）
- dreaming 定时（dailyAt / cron / timezone）

若在安装脚本之外修改插件或配置，请自行重启网关以便运行中的进程加载新配置（例如 `openclaw gateway restart`）。

## 快速示例（CLI）

执行文章流水线：

```bash
npm run dev -- article-word-pipeline ./articles/article1.txt > out/awp_v2_tuple.json
```

导入 SQLite：

```bash
npm run dev -- import-awp-v2-tuple --from-json out/awp_v2_tuple.json --db ./memok.sqlite
```

抽样记忆句：

```bash
npm run dev -- extract-memory-sentences --db ./memok.sqlite
```

## Dreaming

一键运行并输出合并报告：

```bash
npm run dev -- dreaming-pipeline --db ./memok.sqlite
```

插件定时 dreaming 开启后，每次执行结果会写入 SQLite 的 `dream_logs` 表，字段包括：

- `dream_date`
- `ts`
- `status`（`ok` / `error`）
- `log_json`（完整 JSON 结果）

## 配置优先级说明（重要）

对 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`MEMOK_LLM_MODEL`：

1. 进程已有环境变量优先
2. 插件配置仅补齐缺失值，不覆盖已有值
3. `.env` 主要用于本地开发与 CLI 调试

因此纯插件用户可直接用 `openclaw memok setup`，不强制要求本地 `.env`。

## 贡献指南

欢迎提交贡献。详细规范请见：[CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可证

ISC
