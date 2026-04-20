# memok-ai

English | [简体中文](./README.zh-CN.md) · Website: [memok-ai.com](https://www.memok-ai.com/) · Mirror (中文文档 / 境内安装): [Gitee](https://gitee.com/wik20/memok-ai)

**OpenClaw plugin (separate repo):** [galaxy8691/memok-ai-openclaw](https://github.com/galaxy8691/memok-ai-openclaw) — installs this package as `memok-ai-core`, imports the stable surface from **`memok-ai-core/bridge`**, and loads only the thin gateway extension.

`memok-ai` is a Node.js + TypeScript memory pipeline for long text and conversations.
It extracts structured memory units with OpenAI-compatible LLM APIs and stores them in SQLite for recall, reinforcement, and dreaming workflows.

## What It Does

- End-to-end article pipeline (`article-word-pipeline`) that outputs stable JSON tuples
- SQLite import tools for `words`, `normal_words`, `sentences`, and link tables
- Dreaming pipeline (`dreaming-pipeline`) that runs `predream` + story-word-sentence loops
- OpenClaw plugin for incremental conversation persistence and memory recall
- Interactive plugin setup (`openclaw memok setup`) for provider/model/schedule configuration

**Evaluation (tested):** With the OpenClaw plugin recall/report flow, effective memory utilization (candidate memories that were actually reflected in assistant replies) **exceeded 95%** in our runs. Your results will depend on model, task, and sampling settings.

### What the OpenClaw plugin does for you

- Per-turn recall: sampled candidates can be injected before each reply, so long threads stay on track without pasting full history every time.
- Reinforcement: calling `memok_report_used_memory_ids` bumps weights for memories you actually used, so frequent facts stay warm.
- Dreaming / predream: optional scheduled jobs run decay, merges, and cleanup—more like maintenance passes over a graph than a pure append-only log.

### How this differs from embedding-only stacks

| | memok-ai | Typical hosted vector DB |
| --- | --- | --- |
| Deployment | SQLite on your machine | Cloud API + billing |
| Recall signal | Word / normalized-word graph, weights, sampling | Embedding similarity |
| Explainability | Structured rows you can inspect | Mostly similarity scores |
| Privacy | Data stays local by default | Usually leaves your host |

That is a trade-off, not a universal “better/worse” on retrieval quality.

### Notes from real OpenClaw use

Heavy users report coherent follow-up across sessions (e.g. performance work, architecture, release tooling), stable feedback when citing memories, and predream/dreaming behaving as expected once scheduled. Active databases in the wild have reached on the order of ~1k sentences and 100k+ link rows—enough to exercise recall at non-trivial scale; your numbers will differ.

Informal timing on typical local setups (SSD, modest DB size) is often on the order of ~10² ms to persist a turn and sub-100 ms for recall queries—indicative only, not a SLA. Informal “recall accuracy %” figures from the community are anecdotes unless you reproduce them on your workload.

In short: memok targets an associative, reinforceable, optionally forgetful loop without managing embedding models or a separate vector service—closer to a structured “notebook graph” than a generic semantic index.

## Requirements

- Node.js **≥20** (LTS recommended)
- npm

**OpenClaw plugin:** gateway **≥2026.3.24** and plugin API **≥2026.3.24** (see `openclaw.compat` in [package.json](package.json)).

Install dependencies:

```bash
npm install
```

**First-time install note:** `openclaw` is **not** listed in this repo’s npm dependencies (the gateway supplies it at plugin runtime). A cold `npm install` is dominated by **`better-sqlite3`** (native prebuild/compile) plus normal JS deps—often **a few minutes**, depending on network and disk. Avoid `--loglevel verbose` for day-to-day installs (it floods the terminal). The repo `.npmrc` points at **npmmirror** and disables audit calls that Chinese mirrors do not implement. Repeat installs are much faster with a warm npm cache.

## Installation

### 1) Work from a clone (library development)

```bash
npm install
npm run build
npm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for lint/CI and for setting `OPENAI_API_KEY` when running tests that hit LLMs. This package does **not** read `.env` files.

### 2) Install from npm (use as a library)

Published package: [`memok-ai` on npm](https://www.npmjs.com/package/memok-ai).

```bash
npm install memok-ai
```

```ts
// Full API surface (pipelines, SQLite helpers, types)
import {
  articleWordPipelineV2,
  buildPipelineContext,
} from "memok-ai";

// Stable subset for gateways / OpenClaw-style hosts
import {
  articleWordPipeline,
  dreamingPipeline,
} from "memok-ai/bridge";
```

Bridge entrypoints (`articleWordPipeline`, `dreamingPipeline`, etc.) take a full `MemokPipelineConfig` (or extended types such as `DreamingPipelineConfig`). For low-level pipelines that accept `{ ctx }`, import `buildPipelineContext` from the main `memok-ai` package and pass the resulting `PipelineLlmContext`.

```ts
import { articleWordPipeline } from "memok-ai/bridge";

await articleWordPipeline(longText, {
  dbPath: "/path/to/memok.sqlite",
  openaiApiKey: process.env.OPENAI_API_KEY!,
  openaiBaseUrl: process.env.OPENAI_BASE_URL,
  llmModel: "gpt-4o-mini",
  llmMaxWorkers: 4,
  articleSentencesMaxOutputTokens: 8192,
  coreWordsNormalizeMaxOutputTokens: 32768,
  sentenceMergeMaxCompletionTokens: 2048,
});
```

- Requires **Node.js ≥20** (same as this repo).
- **`better-sqlite3`** is a native dependency: first install may compile or download prebuilds (similar to cloning this repo and running `npm install`).
- **Libraries**: construct `MemokPipelineConfig` yourself (TOML, `ConfigService`, etc.) and pass it into bridge APIs.

The OpenClaw plugin repo may list this package under an alias such as `memok-ai-core`; the registry name remains **`memok-ai`**.

### 3) Use as OpenClaw plugin

Install via script (recommended):

```bash
# Linux / macOS
bash <(curl -fsSL https://raw.githubusercontent.com/galaxy8691/memok-ai/main/scripts/install-linux-macos.sh)
```

```powershell
# Windows PowerShell
irm https://raw.githubusercontent.com/galaxy8691/memok-ai/main/scripts/install-windows.ps1 | iex
```

```cmd
:: Windows CMD (download then run)
curl -L -o install-windows.cmd https://raw.githubusercontent.com/galaxy8691/memok-ai/main/scripts/install-windows.cmd
install-windows.cmd
```

Installer behavior:

- Auto runs `npm install` + `npm run build`
- Auto installs plugin via `openclaw plugins install`
- Runs `openclaw memok setup`, then on success attempts `openclaw gateway restart` (fallback: `openclaw restart`) so changes apply
- Auto removes install source directory (`~/.openclaw/extensions/memok-ai-src`) after success

Useful installer env vars:

- `MEMOK_PLUGINS_INSTALL_TIMEOUT_SECONDS` (optional; seconds cap for `openclaw plugins install`, `0` = no limit)
- `MEMOK_PLUGINS_INSTALL_NO_PTY=1` (Linux: skip `script`-based pseudo-TTY wrapper; use if the default wrapper misbehaves)
- `MEMOK_SKIP_GATEWAY_RESTART=1` (skip the final gateway restart step)
- `MEMOK_GATEWAY_RESTART_TIMEOUT_SECONDS` (default `120`; Bash uses `timeout` when available; PowerShell uses `Start-Process` + `WaitForExit` for the same cap on gateway restart)
- `MEMOK_KEEP_SOURCE=1` (keep source directory for debugging)

If `openclaw plugins install` prints success but never returns (so the installer never reaches the next line), that is usually OpenClaw’s CLI not exiting; on **Linux**, the Bash installer can run the command inside `script` (pseudo-TTY) unless `MEMOK_PLUGINS_INSTALL_NO_PTY=1`. The **PowerShell** installer calls `openclaw` directly (no PTY wrapper). You can `Ctrl+C` and run `openclaw memok setup` if the plugin files are already installed. Avoid registering the same plugin twice (e.g. both `memok-ai` and `memok-ai-src` paths) — remove the duplicate entry in `openclaw.json` to silence “duplicate plugin id” warnings.

If setup fails with `plugins.allow excludes "memok"`, add `"memok"` to `~/.openclaw/openclaw.json` under `plugins.allow`, then rerun:

```bash
openclaw memok setup
```

Manual fallback:

```bash
git clone https://github.com/galaxy8691/memok-ai.git
openclaw plugins install ./memok-ai
openclaw memok setup
```

The setup wizard lets you configure:

- LLM provider / API key / model preset (with manual model override)
- Optional memory-slot exclusivity (default: non-exclusive)
- Dreaming schedule (`dailyAt` / cron / timezone)

If you change plugins or config outside the installer, restart the gateway so the running process picks them up (for example `openclaw gateway restart`).

## Dreaming

Call `dreamingPipeline` from `memok-ai/bridge` with a `DreamingPipelineConfig` (see exported types). The OpenClaw plugin wires cron scheduling on top of the same core function.

Each `dreamingPipeline` completion (success or failure) appends a row to SQLite table `dream_logs`. Pass a single `DreamingPipelineConfig` object: `MemokPipelineConfig` plus required `dreamLogWarn`, plus optional story tuning (`maxWords` / `fraction` / `minRuns` / `maxRuns`). When the OpenClaw plugin uses dreaming cron, it relies on this core behavior. Columns:

- `dream_date`
- `ts`
- `status` (`ok` / `error`)
- `log_json` (full run payload)

## Configuration priority (OpenClaw plugin)

For `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `MEMOK_LLM_MODEL` when using the separate OpenClaw plugin:

1. Existing process environment variables win.
2. Plugin config only fills missing values.

This core library never loads `.env` files; inject secrets via your process manager or gateway.

## Environment variables

Used by tests and by legacy no-`ctx` code paths that still read `process.env` for per-stage overrides. Library callers should assemble `MemokPipelineConfig` explicitly.

| Variable | Required | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | **Yes** (for env-based config) | OpenAI-compatible API key |
| `OPENAI_BASE_URL` | No | Gateway / proxy base URL |
| `MEMOK_LLM_MODEL` | No | Default `gpt-4o-mini` |
| `MEMOK_DB_PATH` | No | Default `./memok.sqlite` |
| `MEMOK_LLM_MAX_WORKERS` | No | `<=1` serial; cap 64 |
| `MEMOK_V2_ARTICLE_SENTENCES_MAX_OUTPUT_TOKENS` | No | Default 8192 (clamped) |
| `MEMOK_CORE_WORDS_NORMALIZE_MAX_OUTPUT_TOKENS` | No | Default 32768 (clamped) |
| `MEMOK_SENTENCE_MERGE_MAX_COMPLETION_TOKENS` | No | Default 2048 (clamped) |
| `MEMOK_SKIP_LLM_STRUCTURED_PARSE` | No | `1` / `true` / `yes` / `on` |

Per-stage model env names (e.g. `MEMOK_V2_ARTICLE_CORE_WORDS_LLM_MODEL`) are documented in source `resolveModel` helpers.

## Contributing

Contributions are welcome. See the full guide: [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Released under the [MIT License](LICENSE).
