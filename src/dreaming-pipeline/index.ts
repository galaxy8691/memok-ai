/** 对外导出 dreaming 编排（predream + story-word-sentence）及子模块入口。 */

export {
  type PredreamDecayResult,
  runPredreamDecayFromDb,
} from "./predream-pipeline/index.js";
export {
  type DreamingPipelineResult,
  type RunDreamingPipelineFromDbOpts,
  runDreamingPipelineFromDb,
} from "./runDreamingPipelineFromDb.js";
export {
  type RunStoryWordSentenceBucketsFromDbOpts,
  type RunStoryWordSentencePipelineFromDbOpts,
  runStoryWordSentenceBucketsFromDb,
  runStoryWordSentencePipelineFromDb,
  type StoryWordSentenceBucketsResult,
  type StoryWordSentencePipelineOrphanMergeTotals,
  type StoryWordSentencePipelineResult,
} from "./story-word-sentence-pipeline/index.js";
