/**
 * Stable surface for the OpenClaw plugin package (`memok-ai-openclaw`).
 * Import only from `memok-ai-core/bridge` (or published `memok-ai/bridge`).
 * This core package does not ship plugin gateway code; the plugin lives in the separate repo.
 * SQLite open helpers are exported for the plugin (e.g. dreaming `dream_logs` writes); prefer path-based APIs for memory pipelines when possible.
 * Transcript recall-marker stripping (`@@@MEMOK_RECALL_*@@@` / 旧版标题) lives in the OpenClaw plugin, not here.
 * OpenClaw heartbeat / reminder template scrubbing is also plugin-owned (before calling core or after consuming pipeline output).
 */

export {
  type DreamingPipelineResult,
  type RunDreamingPipelineFromDbOpts,
  runDreamingPipelineFromDb,
} from "./dreaming-pipeline/runDreamingPipelineFromDb.js";
export { loadProjectEnv } from "./llm/openaiCompat.js";
export type { ArticleWordPipelineSaveDbOptions } from "./memory/articleWordPipelineSaveDb.js";
export { articleWordPipelineSaveDb } from "./memory/articleWordPipelineSaveDb.js";
export {
  type ExtractMemorySentencesOpts,
  extractMemorySentencesByWordSample,
  type MemoryExtractedSentence,
  type MemoryExtractResponse,
} from "./read-memory-pipeline/extractMemorySentencesByWordSample.js";
export { applySentenceUsageFeedback } from "./sqlite/applySentenceUsageFeedback.js";
