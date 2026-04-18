/**
 * Stable surface for the OpenClaw plugin package (`memok-ai-openclaw`).
 * Import only from `memok-ai-core/openclaw-bridge` (or published `memok-ai/openclaw-bridge`).
 */

export {
  type DreamingPipelineResult,
  type RunDreamingPipelineFromDbOpts,
  runDreamingPipelineFromDb,
} from "./dreaming-pipeline/runDreamingPipelineFromDb.js";
export { loadProjectEnv } from "./llm/openaiCompat.js";
export type { SaveTextToMemoryDbOptions } from "./memory/saveTextToMemoryDb.js";
export { saveTextToMemoryDb } from "./memory/saveTextToMemoryDb.js";
export {
  type ExtractMemorySentencesOpts,
  extractMemorySentencesByWordSample,
  type MemoryExtractedSentence,
  type MemoryExtractResponse,
} from "./read-memory-pipeline/extractMemorySentencesByWordSample.js";
export { applySentenceUsageFeedback } from "./sqlite/applySentenceUsageFeedback.js";
export {
  applyRecommendedSqlitePragmas,
  openSqlite,
  SQLITE_BUSY_TIMEOUT_MS,
} from "./sqlite/openSqlite.js";

export { scrubOpenclawHeartbeatArtifacts } from "./utils/scrubOpenclawHeartbeatArtifacts.js";
export {
  MEMOK_INJECT_END,
  MEMOK_INJECT_START,
  MEMOK_MEMORY_INJECT_MARKER,
  stripMemokInjectEchoFromTranscript,
} from "./utils/stripMemokInjectEchoFromTranscript.js";
