# memok-ai

English | [简体中文](./README.zh-CN.md)

`memok-ai` is a Node.js + TypeScript memory pipeline for long text and conversations.
It extracts structured memory units with OpenAI-compatible LLM APIs and stores them in SQLite for recall, reinforcement, and dreaming workflows.

## What It Does

- End-to-end article pipeline (`article-word-pipeline`) that outputs stable JSON tuples
- SQLite import tools for `words`, `normal_words`, `sentences`, and link tables
- Dreaming pipeline (`dreaming-pipeline`) that runs `predream` + story-word-sentence loops
- OpenClaw plugin for incremental conversation persistence and memory recall
- Interactive plugin setup (`openclaw memok setup`) for provider/model/schedule configuration

## Requirements

- Node.js 18+
- npm

Install dependencies:

```bash
npm install
```

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
- Runs `openclaw memok setup` (restart the OpenClaw gateway yourself when you want newly installed plugins loaded)
- Auto removes install source directory (`~/.openclaw/extensions/memok-ai-src`) after success

Useful installer env vars:

- `MEMOK_PLUGINS_INSTALL_TIMEOUT_SECONDS` (optional; seconds cap for `openclaw plugins install`, `0` = no limit)
- `MEMOK_KEEP_SOURCE=1` (keep source directory for debugging)

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

After changing plugins or config, restart the gateway when you want the running process to pick them up (for example `openclaw gateway restart` if that is how you manage it).

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

ISC
