/** 对外导出 dreaming 编排（predream + story-word-sentence）及子模块入口。 */
export {
  runDreamingPipelineFromDb,
  type DreamingPipelineResult,
  type RunDreamingPipelineFromDbOpts,
} from "./runDreamingPipelineFromDb.js";
export {
  runStoryWordSentenceBucketsFromDb,
  runStoryWordSentencePipelineFromDb,
  type RunStoryWordSentenceBucketsFromDbOpts,
  type RunStoryWordSentencePipelineFromDbOpts,
  type StoryWordSentenceBucketsResult,
  type StoryWordSentencePipelineOrphanMergeTotals,
  type StoryWordSentencePipelineResult,
} from "./story-word-sentence-pipeline/index.js";
export {
  runPredreamDecayFromDb,
  type PredreamDecayResult,
} from "./predream-pipeline/index.js";
