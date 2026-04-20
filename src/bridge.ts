/**
 * Stable surface for the OpenClaw plugin package (`memok-ai-openclaw`).
 * Import only from `memok-ai-core/bridge` (or published `memok-ai/bridge`).
 * This core package does not ship plugin gateway code; the plugin lives in the separate repo.
 * {@link createFreshMemokSqliteFile} creates an empty memok SQLite file (schema + indexes) in one call.
 * {@link dreamingPipeline} always writes `dream_logs` after success or failure; `dreamLogWarn` on {@link DreamingPipelineConfig} is required for persist failures.
 * Transcript recall-marker stripping (`@@@MEMOK_RECALL_*@@@` / 旧版标题) lives in the OpenClaw plugin, not here.
 * OpenClaw heartbeat / reminder template scrubbing is also plugin-owned (before calling core or after consuming pipeline output).
 */

export type { ArticleWordPipelineSaveDbOptions } from "./article-word-pipeline/v2/articleWordPipeline.js";
export { articleWordPipeline } from "./article-word-pipeline/v2/articleWordPipeline.js";
export {
  type DreamingPipelineConfig,
  type DreamingPipelineResult,
  dreamingPipeline,
} from "./dreaming-pipeline/dreamingPipeline.js";
export type { MemokPipelineConfig } from "./memokPipeline.js";
export {
  type ExtractMemorySentencesByWordSampleInput,
  extractMemorySentencesByWordSample,
  type MemoryExtractedSentence,
  type MemoryExtractResponse,
} from "./read-memory-pipeline/extractMemorySentencesByWordSample.js";
export {
  type ApplySentenceUsageFeedbackInput,
  applySentenceUsageFeedback,
} from "./sqlite/applySentenceUsageFeedback.js";
export {
  type CreateFreshMemokSqliteFileOptions,
  createFreshMemokSqliteFile,
} from "./sqlite/memokSchema.js";
