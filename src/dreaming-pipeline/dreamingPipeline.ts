import {
  buildPipelineContext,
  type MemokPipelineConfig,
  type PipelineLlmContext,
} from "../config/memokPipelineConfig.js";
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

/** dreaming 单次运行入参：SQLite + LLM 配置 + 必填日志告警 + story 阶段可选参数 */
export type DreamingPipelineConfig = MemokPipelineConfig & {
  dreamLogWarn: (msg: string) => void;
  maxWords?: number;
  fraction?: number;
  minRuns?: number;
  maxRuns?: number;
  pickRunCount?: (min: number, max: number) => number;
};

/** `predream` + `story-word-sentence-pipeline` 两段报告合并为一份 JSON。 */
export type DreamingPipelineResult = {
  predream: PredreamDecayResult;
  storyWordSentencePipeline: StoryWordSentencePipelineResult;
};

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

function storyOptsFromDreamingInput(
  input: DreamingPipelineConfig,
  ctx: PipelineLlmContext,
): RunStoryWordSentencePipelineFromDbOpts {
  const o: RunStoryWordSentencePipelineFromDbOpts = { ctx };
  if (input.maxWords !== undefined) {
    o.maxWords = input.maxWords;
  }
  if (input.fraction !== undefined) {
    o.fraction = input.fraction;
  }
  if (input.minRuns !== undefined) {
    o.minRuns = input.minRuns;
  }
  if (input.maxRuns !== undefined) {
    o.maxRuns = input.maxRuns;
  }
  if (input.pickRunCount !== undefined) {
    o.pickRunCount = input.pickRunCount;
  }
  return o;
}

/**
 * 顺序执行：`runPredreamDecayFromDb` → `runStoryWordSentencePipelineFromDb`（同一 `input.dbPath`）。
 * 成功或失败后均写入 `dream_logs`；写库失败时调用 `dreamLogWarn`。
 */
export async function dreamingPipeline(
  input: DreamingPipelineConfig,
): Promise<DreamingPipelineResult> {
  const dreamLogWarn = input.dreamLogWarn;
  const memokCfg: MemokPipelineConfig = {
    dbPath: input.dbPath,
    openaiApiKey: input.openaiApiKey,
    openaiBaseUrl: input.openaiBaseUrl,
    llmModel: input.llmModel,
    llmMaxWorkers: input.llmMaxWorkers,
    articleSentencesMaxOutputTokens: input.articleSentencesMaxOutputTokens,
    coreWordsNormalizeMaxOutputTokens: input.coreWordsNormalizeMaxOutputTokens,
    sentenceMergeMaxCompletionTokens: input.sentenceMergeMaxCompletionTokens,
    skipLlmStructuredParse: input.skipLlmStructuredParse,
  };
  const dbPath = memokCfg.dbPath;
  const startedAt = new Date().toISOString();
  const dreamDate = startedAt.slice(0, 10);
  const ctx = buildPipelineContext(memokCfg);
  const storyOpts = storyOptsFromDreamingInput(input, ctx);

  try {
    const predream = runPredreamDecayFromDb(dbPath);
    const storyWordSentencePipeline = await runStoryWordSentencePipelineFromDb(
      dbPath,
      storyOpts,
    );
    const result = { predream, storyWordSentencePipeline };
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
    return result;
  } catch (e) {
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
    throw e;
  }
}
