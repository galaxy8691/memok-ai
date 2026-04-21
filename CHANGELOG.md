# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.3] - 2026-04-21

### Added

- **`MemokPipelineConfig.articleWordImportInitialWeight`** and **`articleWordImportInitialDuration`** (defaults **1** and **7**) for new `sentences` rows when **`articleWordPipeline`** → **`importAwpV2Tuple`** runs.
- **`MemokPipelineConfig.dreamShortTermToLongTermWeightThreshold`** (default **7**) for predream: short-term rows with **`weight >= threshold`** become long-term; short-term rows with **`duration <= 0`** and **`weight < threshold`** are removed (and their `sentence_to_normal_link` rows first, when that table exists).
- **`RunPredreamDecayFromDbOpts`** / **`ImportAwpV2TupleOpts`** types for the new options; predream SQL binds the threshold as a parameter.
- Tests for custom import defaults, custom predream threshold, and promotion at a lower threshold.

## [0.2.2] - 2026-04-20

### Added

- **`createFreshMemokSqliteFile`** (and **`CreateFreshMemokSqliteFileOptions`**) to create an on-disk SQLite database with the full memok schema (including **`dream_logs`**), foreign keys on link tables, and link-table dedupe + indexes in one call; the **default public** entry for “new DB” is this function on **`memok-ai`** and **`memok-ai/bridge`**.
- Internal **`memokSqliteDdl.ts`**: single source for DDL + link hardening SQL used by init, **`hardenDb`**, and **`persistDreamPipelineLog`**.

### Changed

- **`applyMemokSqliteSchema`** runs one combined script; **`hardenDb`** executes the same fragments behind **`sqlite_master`** existence checks for older/partial databases.

## [0.2.1] - 2026-04-20

### Changed

- **Host-owned configuration:** **`MemokPipelineConfig`** + **`buildPipelineContext`** / **`createOpenAIClient`**; removed the in-repo **CLI**, **batch / import scripts**, and the legacy **`memokPipelineConfig`** module so libraries pass config explicitly.

## [0.2.0] - 2026-04-19

### Added

- **`dreamingPipeline`** as the stable orchestration name (replacing older “run dreaming from DB” naming in docs/usage).

### Changed

- **`MemokPipelineConfig`** is the single shape for DB path, OpenAI settings, token ceilings, and optional flags; **`articleWordPipeline`** (persist to SQLite) lives under **`article-word-pipeline/v2/articleWordPipeline.ts`**.
- **`extractMemorySentencesByWordSample`** and **`applySentenceUsageFeedback`** take **`MemokPipelineConfig`-compatible** inputs (only **`dbPath`** is read for DB access; other fields stay for typing / future use).
- **Bridge** trimmed to gateway-oriented exports only: article pipeline, dreaming, recall, sentence feedback, and types — **`PipelineLlmContext`**, **`buildPipelineContext`**, **`createOpenAIClient`**, and parallel LLM helpers are **not** re-exported from **`memok-ai/bridge`** (they remain on the main **`memok-ai`** entry).
- README / tests updated for the above; some tests adjusted for parallel CI timing.

## [0.1.5] - 2026-04-19

### Added

- **`dream_logs`** table creation (if needed) and **`persistDreamPipelineLogToDb`**: each **`dreamingPipeline`** run appends a JSON log row after success or failure; hosts supply **`dreamLogWarn`** for non-fatal persist errors.

### Changed

- README / npm metadata touch-ups (**`f975fb6`**, **`9bd7ebc`**) around the dreaming log work.

## [0.1.4] - 2026-04-19

### Changed

- Stable consumer entry renamed from **`openclaw-bridge`** to **`memok-ai/bridge`** (documented as **`memok-ai-core/bridge`** for the OpenClaw plugin alias).
- **`articleWordPipeline`** naming aligned for the “save article to DB” path; redundant package export removed where bridge already re-exports.
- **OpenClaw-specific scrubbing** (heartbeat / transcript inject stripping) removed from core so the **plugin** owns pre/post processing; core no longer wraps **`articleWordPipelineV2`** with heartbeat tuple scrubbing.

## [0.1.2] - 2026-04-19

### Changed

- **Dreaming relevance (normal words & sentences):** after **`MEMOK_RELEVANCE_SCORE_MAX_LLM_ATTEMPTS`** (default **5**), scores are **coerced** so returned IDs align with sampled inputs, so dreaming can complete when the model repeatedly returns invalid structured scores.
- Tests pin relevance attempt counts where needed to avoid CI timeouts.

## [0.1.1] - 2026-04-19

### Added

- **`.npmignore`** so published tarballs exclude dev-only paths explicitly.

### Changed

- **Relevance scoring** retries LLM structured output until validation passes, up to **`MEMOK_RELEVANCE_SCORE_MAX_LLM_ATTEMPTS`** (default **8**), with clearer handling between attempts.

## [0.1.0] - 2026-04-18

First **library-shaped** release line published from this repository (git tag **`v0.1.0`**). The following summarizes development from the initial TypeScript port up to that tag (including the move of the OpenClaw **gateway plugin** out of this repo).

### Added

- **Article word pipeline (v2):** core-word analysis, synonym / normalization pass, memory-sentence extraction, **`combineArticleSentenceCoreV2`**, and **SQLite import** compatible with the v2 tuple (`words`, `normal_words`, `sentences`, **`word_to_normal_link`**, **`sentence_to_normal_link`**).
- **Read memory:** **`extractMemorySentencesByWordSample`** — word-driven sampling over the graph for recall-style responses (short-term vs. long-term pools documented in source).
- **Dreaming subsystem:**
  - **Predream:** global **`duration`** decay; promote “heavy” short-term rows; delete exhausted low-weight short-term rows.
  - **Story–word–sentence pipeline:** normal-word and sentence relevance, bucketing, orphan merge, link feedback, and related DB utilities used by scheduled / batch dreaming flows.
- **SQLite:** **`openSqlite`** (WAL, busy timeout), **`hardenDb`** (dedupe + indexes on link tables), feedback helpers, JSON/tuple parsing for imports.
- **Distribution & docs:** **`memok-ai`** / **`memok-ai/bridge`** package layout, **MIT** license, English README (default) + **Chinese README** and **Gitee** mirror install hints, **memok-ai.com** link, contribution guide, CI (Biome, Vitest, Dependabot bumps).

### Changed

- **Monorepo split:** OpenClaw **plugin implementation** removed from this repository; it ships as **`memok-ai-openclaw`** (and similar) while this package stays **core + bridge**. READMEs link the external plugin.

### Removed

- **In-repo OpenClaw plugin** and gateway-specific binaries from **`memok-ai`** core (consumers use the separate plugin repo).

---

**Git tags note:** **`v1.1.0`** marks the **bridge export layout** commit used by the external OpenClaw plugin; it does **not** track the **`memok-ai`** npm semver line (which follows **`0.x.y`** in `package.json`).
