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

- Node.js 18+
- npm

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

安装插件：

```bash
openclaw plugins install /path/to/memok-ai
```

运行交互式向导：

```bash
openclaw memok setup
```

向导可配置：

- LLM 供应商 / API Key / 模型预设（可手填覆盖）
- 是否独占 memory 槽位（默认不独占）
- dreaming 定时（dailyAt / cron / timezone）

配置完成后请重启 gateway。

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
