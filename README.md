# memok-ai

English | [简体中文](./README.zh-CN.md) · Website: [memok-ai.com](https://www.memok-ai.com/) · Mirror (Chinese README / clone): [Gitee](https://gitee.com/wik20/memok-ai)

**OpenClaw plugin (separate repo):** [galaxy8691/memok-ai-openclaw](https://github.com/galaxy8691/memok-ai-openclaw) — depends on this package (often as the npm alias `memok-ai-core`) and ships the gateway extension; use **`memok-ai-core/openclaw-bridge`** from that setup to import the stable bridge module.

`memok-ai` is a Node.js + TypeScript memory pipeline for long text and conversations.
It extracts structured memory units with OpenAI-compatible LLM APIs and stores them in SQLite for recall, reinforcement, and dreaming workflows.

## What It Does

- End-to-end article pipeline (`article-word-pipeline`) that outputs stable JSON tuples
- SQLite import tools for `words`, `normal_words`, `sentences`, and link tables
- Dreaming pipeline (`dreaming-pipeline`) that runs `predream` + story-word-sentence loops
- Stable import path **`memok-ai-core/openclaw-bridge`** (re-exported from this package) for the OpenClaw plugin to call pipelines and SQLite helpers inside the gateway

Gateway install, recall injection, reinforcement hooks, scheduled dreaming, and `openclaw memok setup` live in **[memok-ai-openclaw](https://github.com/galaxy8691/memok-ai-openclaw)**—not in this repository.

### How this differs from embedding-only stacks

| | memok (this core) | Typical hosted vector DB |
| --- | --- | --- |
| Deployment | SQLite on your machine | Cloud API + billing |
| Recall signal | Word / normalized-word graph, weights, sampling | Embedding similarity |
| Explainability | Structured rows you can inspect | Mostly similarity scores |
| Privacy | Data stays local by default | Usually leaves your host |

That is a trade-off, not a universal “better/worse” on retrieval quality.

In short: memok targets an associative, reinforceable, optionally forgetful loop without managing embedding models or a separate vector service—closer to a structured “notebook graph” than a generic semantic index.

## Requirements

- Node.js **≥20** (LTS recommended)
- npm

Install dependencies:

```bash
npm install
```

**First-time install note:** A cold `npm install` is dominated by **`better-sqlite3`** (native prebuild/compile) plus normal JS deps—often **a few minutes**, depending on network and disk. Avoid `--loglevel verbose` for day-to-day installs (it floods the terminal). The repo `.npmrc` points at **npmmirror** and disables audit calls that Chinese mirrors do not implement. Repeat installs are much faster with a warm npm cache.

## Installation

### 1) Use as CLI (local development)

```bash
cp .env.example .env
npm run build
npm run dev -- --help
```

### 2) Use with OpenClaw

Install and configure the gateway plugin from **[memok-ai-openclaw](https://github.com/galaxy8691/memok-ai-openclaw)** (scripts, `openclaw plugins install`, setup wizard, and troubleshooting live there—not in this core repo).

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

The `dreaming-pipeline` CLI command prints a merged JSON report to stdout; this core package does not define or write a `dream_logs` table. If you use the OpenClaw plugin, optional persistence of scheduled runs (including any `dream_logs` schema) is described in the plugin repository.

## Configuration Priority (Important)

For `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `MEMOK_LLM_MODEL`:

1. Existing process environment variables win
2. **OpenClaw plugin only:** config from `openclaw memok setup` fills missing values (see [memok-ai-openclaw](https://github.com/galaxy8691/memok-ai-openclaw))
3. `.env` is mainly for development and CLI usage

## Contributing

Contributions are welcome. See the full guide: [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

Released under the [MIT License](LICENSE).
