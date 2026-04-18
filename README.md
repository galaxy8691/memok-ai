# memok-ai

English | [简体中文](./README.zh-CN.md) · Website: [memok-ai.com](https://www.memok-ai.com/) · Mirror (中文文档 / 境内安装): [Gitee](https://gitee.com/wik20/memok-ai)

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

### 1) Use as CLI (local development)

```bash
cp .env.example .env
npm run build
npm run dev -- --help
```

### 2) Use as OpenClaw plugin

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

## CLI reference

`memok-ai --help` and subcommands use **English** descriptions. For a Chinese walkthrough of each command, see [README.zh-CN.md](./README.zh-CN.md#命令行参考).

| Command | Purpose |
| --- | --- |
| `article-core-words` | Extract core words from an article file |
| `article-core-words-normalize` | Normalize synonyms from core-words JSON |
| `article-sentences` | Extract memory-oriented sentences |
| `article-sentence-core-combine` | Combine sentences + normalized words tuple |
| `article-word-pipeline` | Full article-word pipeline to tuple JSON |
| `extract-memory-sentences` | Sample memory sentences from SQLite |
| `dreaming-pipeline` | Predream + story-word-sentence pipeline |
| `predream-decay` | Predream decay pass only |
| `story-word-sentence-buckets` | One full story/word/sentence bucket pass |
| `story-word-sentence-pipeline` | Multiple bucket passes (random run count) |
| `harden-db` | Clean links and add indexes |
| `import-awp-v2-tuple` | Import AWP v2 tuple JSON into SQLite |

## Quick CLI Example

Run one-shot article pipeline:

```bash
npm run dev -- article-word-pipeline ./articles/article1.txt > out/awp_v2_tuple.json
```

Import tuple into SQLite:

```bash
npm run dev -- import-awp-v2-tuple --from-json out/awp_v2_tuple.json --db ./memok.sqlite
```

Extract sampled memory sentences:

```bash
npm run dev -- extract-memory-sentences --db ./memok.sqlite
```

## Dreaming

One-shot merged report:

```bash
npm run dev -- dreaming-pipeline --db ./memok.sqlite
```

With custom options:

```bash
npm run dev -- dreaming-pipeline --db ./memok.sqlite --max-words 10 --fraction 0.2 --min-runs 3 --max-runs 5
```

When plugin dreaming cron is enabled, each run is persisted in SQLite table `dream_logs`:

- `dream_date`
- `ts`
- `status` (`ok` / `error`)
- `log_json` (full run payload)

## Configuration Priority (Important)

For `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `MEMOK_LLM_MODEL`:

1. Existing process environment variables win
2. Plugin config only fills missing values
3. `.env` is mainly for development/CLI usage

So plugin users can rely on `openclaw memok setup` without requiring a local `.env`.

## Contributing

Contributions are welcome. See the full guide: [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Released under the [MIT License](LICENSE).
