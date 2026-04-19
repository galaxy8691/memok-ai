import { persistDreamPipelineLogToDb } from "../sqlite/persistDreamPipelineLog.js";
import {
  type PredreamDecayResult,
  runPredreamDecayFromDb,
} from "./predream-pipeline/runPredreamDecayFromDb.js";
import {
  type RunStoryWordSentencePipelineFromDbOpts,
  runStoryWordSentencePipelineFromDb,
  type StoryWordSentencePipelineResult,
} from "./story-word-sentence-pipeline/runStoryWordSentencePipelineFromDb.js";

export type RunDreamingPipelineFromDbOpts =
  RunStoryWordSentencePipelineFromDbOpts & {
    runPredreamDecayFromDbFn?: typeof runPredreamDecayFromDb;
    /** 编排层单测：替换整段 story pipeline，不会传入内层 `runStoryWordSentencePipelineFromDb`。 */
    runStoryWordSentencePipelineFromDbFn?: typeof runStoryWordSentencePipelineFromDb;
    /** 为单测等跳过写入 SQLite `dream_logs`（默认每次跑完仍会写入）。 */
    skipDreamLog?: boolean;
    /** 写入 `dream_logs` 失败时回调（默认静默）。 */
    dreamLogWarn?: (msg: string) => void;
  };

/** `predream` + `story-word-sentence-pipeline` 两段报告合并为一份 JSON。 */
export type DreamingPipelineResult = {
  predream: PredreamDecayResult;
  storyWordSentencePipeline: StoryWordSentencePipelineResult;
};

function toStoryPipelineOpts(
  opts?: RunDreamingPipelineFromDbOpts,
): RunStoryWordSentencePipelineFromDbOpts | undefined {
  if (opts === undefined) return undefined;
  const {
    runPredreamDecayFromDbFn: _p,
    runStoryWordSentencePipelineFromDbFn: _s,
    skipDreamLog: _l,
    dreamLogWarn: _w,
    ...rest
  } = opts;
  return rest;
}

function dreamLogPayloadOk(
  dbPath: string,
  startedAt: string,
  predream: PredreamDecayResult,
  storyWordSentencePipeline: StoryWordSentencePipelineResult,
): Record<string, unknown> {
  const s = storyWordSentencePipeline;
  return {
    ts: startedAt,
    status: "ok",
    dbPath,
    predream,
    storyWordSentencePipeline: {
      minRuns: s.minRuns,
      maxRuns: s.maxRuns,
      plannedRuns: s.plannedRuns,
      orphanNormalWordsDeleted: s.orphanNormalWordsDeleted,
      orphanSentenceMerge: s.orphanSentenceMerge,
      sentenceLinkFeedback: s.sentenceLinkFeedback,
      normalWordLinkFeedback: s.normalWordLinkFeedback,
    },
  };
}

/**
 * 顺序执行：先 `runPredreamDecayFromDb`，再 `runStoryWordSentencePipelineFromDb`（同一 `dbPath`）。
 */
export async function runDreamingPipelineFromDb(
  dbPath: string,
  opts?: RunDreamingPipelineFromDbOpts,
): Promise<DreamingPipelineResult> {
  const startedAt = new Date().toISOString();
  const dreamDate = startedAt.slice(0, 10);
  const skipDreamLog = opts?.skipDreamLog === true;
  const dreamLogWarn = opts?.dreamLogWarn;

  const predreamFn = opts?.runPredreamDecayFromDbFn ?? runPredreamDecayFromDb;
  const storyFn =
    opts?.runStoryWordSentencePipelineFromDbFn ??
    runStoryWordSentencePipelineFromDb;
  try {
    const predream = predreamFn(dbPath);
    const storyWordSentencePipeline = await storyFn(
      dbPath,
      toStoryPipelineOpts(opts),
    );
    const result = { predream, storyWordSentencePipeline };
    if (!skipDreamLog) {
      persistDreamPipelineLogToDb({
        dbPath,
        dreamDate,
        ts: startedAt,
        status: "ok",
        logPayload: dreamLogPayloadOk(
          dbPath,
          startedAt,
          predream,
          storyWordSentencePipeline,
        ),
        warn: dreamLogWarn,
      });
    }
    return result;
  } catch (e) {
    if (!skipDreamLog) {
      const msg = e instanceof Error ? e.message : String(e);
      persistDreamPipelineLogToDb({
        dbPath,
        dreamDate,
        ts: startedAt,
        status: "error",
        logPayload: {
          ts: startedAt,
          status: "error",
          dbPath,
          error: msg,
        },
        warn: dreamLogWarn,
      });
    }
    throw e;
  }
}
