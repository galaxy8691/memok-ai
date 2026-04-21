# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.3] - 2026-04-21

### Added

- `MemokPipelineConfig.articleWordImportInitialWeight` and `articleWordImportInitialDuration` (defaults **1** and **7**) for new `sentences` rows in `importAwpV2Tuple` / `articleWordPipeline`.
- `MemokPipelineConfig.dreamShortTermToLongTermWeightThreshold` (default **7**) for predream short-term → long-term promotion by `weight`; `runPredreamDecayFromDb` accepts `RunPredreamDecayFromDbOpts` with `shortTermToLongTermWeightThreshold`.

## [0.2.2] - 2026-04-20

### Added

- `createFreshMemokSqliteFile` (and `CreateFreshMemokSqliteFileOptions`) to create an empty SQLite database with full schema and link-table hardening in one call; exported from `memok-ai` and `memok-ai/bridge`.
- Internal `memokSqliteDdl.ts` holding DDL and hardening SQL shared with `hardenDb` and `persistDreamPipelineLog`.

### Changed

- `applyMemokSqliteSchema` runs a single init script (tables + `dream_logs` + indexes / dedupe); `hardenDb` reuses the same SQL with table-existence guards for legacy databases.

## [0.2.1] - 2026-04-20

### Changed

- Pipeline configuration is explicit `MemokPipelineConfig` plus `buildPipelineContext` / `createOpenAIClient`; removed in-repo CLI, batch import scripts, and the old `memokPipelineConfig` module (hosts assemble config).

## [0.2.0] - 2026-04-19

### Changed

- Bridge and APIs oriented around `MemokPipelineConfig`-first usage; narrower default export surface for gateway-style consumers.
