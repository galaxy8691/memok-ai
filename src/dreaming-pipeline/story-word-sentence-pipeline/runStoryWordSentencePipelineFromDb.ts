import type { ApplyNormalWordLinkFeedbackResult } from "./applyNormalWordLinkFeedback.js";
import type { ApplyResultLinkFeedbackResult } from "./applyResultLinkFeedback.js";
import {
  type RunStoryWordSentenceBucketsFromDbOpts,
  runStoryWordSentenceBucketsFromDb,
  type StoryWordSentenceBucketsResult,
} from "./runStoryWordSentenceBucketsFromDb.js";

function sumSentenceLinkFeedback(
  rows: ApplyResultLinkFeedbackResult[],
): ApplyResultLinkFeedbackResult {
  const z = (k: keyof ApplyResultLinkFeedbackResult) =>
    rows.reduce((acc, r) => acc + r[k], 0 as number);
  return {
    matchedNormalIds: z("matchedNormalIds"),
    updatedSentenceRows: z("updatedSentenceRows"),
    updatedPlus: z("updatedPlus"),
    insertedPlusSentenceLinks: z("insertedPlusSentenceLinks"),
    updatedMinus: z("updatedMinus"),
    deleted: z("deleted"),
    skippedConflicts: z("skippedConflicts"),
    targetedPlusSentences: z("targetedPlusSentences"),
    targetedMinusSentences: z("targetedMinusSentences"),
  };
}

function sumNormalWordLinkFeedback(
  rows: ApplyNormalWordLinkFeedbackResult[],
): ApplyNormalWordLinkFeedbackResult {
  const z = (k: keyof ApplyNormalWordLinkFeedbackResult) =>
    rows.reduce((acc, r) => acc + r[k], 0 as number);
  return {
    matchedWordIds: z("matchedWordIds"),
    updatedPlus: z("updatedPlus"),
    insertedPlusLinks: z("insertedPlusLinks"),
    updatedMinus: z("updatedMinus"),
    deleted: z("deleted"),
    skippedConflicts: z("skippedConflicts"),
    targetedPlusNormalWords: z("targetedPlusNormalWords"),
    targetedMinusNormalWords: z("targetedMinusNormalWords"),
  };
}

function uniqSortedPositiveIds(lists: number[][]): number[] {
  const s = new Set<number>();
  for (const list of lists) {
    for (const id of list) {
      if (Number.isInteger(id) && id > 0) s.add(id);
    }
  }
  return [...s].sort((a, b) => a - b);
}

function randomRunCountInclusive(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function normalizePositiveInt(
  n: unknown,
  fallback: number,
  label: string,
): number {
  const raw = n === undefined ? fallback : n;
  const v =
    typeof raw === "number" && Number.isFinite(raw)
      ? Math.floor(raw)
      : fallback;
  if (!Number.isFinite(v) || v < 1) {
    throw new Error(`${label} 须为 >= 1 的整数`);
  }
  return v;
}

function toBucketsOpts(
  opts?: RunStoryWordSentencePipelineFromDbOpts,
): RunStoryWordSentenceBucketsFromDbOpts | undefined {
  if (opts === undefined) return undefined;
  const {
    minRuns: _a,
    maxRuns: _b,
    pickRunCount: _c,
    runStoryWordSentenceBucketsFromDbFn: _d,
    ...rest
  } = opts;
  return rest;
}

export type RunStoryWordSentencePipelineFromDbOpts =
  RunStoryWordSentenceBucketsFromDbOpts & {
    /** 随机轮数下限（含），默认 3 */
    minRuns?: number;
    /** 随机轮数上限（含），默认 5 */
    maxRuns?: number;
    /** 单测或确定性编排：覆盖随机轮数 */
    pickRunCount?: (min: number, max: number) => number;
    runStoryWordSentenceBucketsFromDbFn?: typeof runStoryWordSentenceBucketsFromDb;
  };

/** 多轮 `orphanSentenceMerge` 的计数求和（无单轮 `topSentenceId`） */
export type StoryWordSentencePipelineOrphanMergeTotals = {
  orphansFound: number;
  mergedCount: number;
  deletedCount: number;
};

/** 仅含多轮汇总统计，不含每轮 story/relevance/buckets 等大字段 */
export type StoryWordSentencePipelineResult = {
  minRuns: number;
  maxRuns: number;
  plannedRuns: number;
  sentenceLinkFeedback: ApplyResultLinkFeedbackResult;
  normalWordLinkFeedback: ApplyNormalWordLinkFeedbackResult;
  orphanNormalWordsDeleted: { count: number; ids: number[] };
  orphanSentenceMerge: StoryWordSentencePipelineOrphanMergeTotals;
};

/**
 * 在 [minRuns, maxRuns] 内随机决定轮数，对同一 DB 顺序执行多轮完整 `runStoryWordSentenceBucketsFromDb`。
 * 任一轮抛错则整体中止并向上抛出。
 */
export async function runStoryWordSentencePipelineFromDb(
  dbPath: string,
  opts?: RunStoryWordSentencePipelineFromDbOpts,
): Promise<StoryWordSentencePipelineResult> {
  const minRuns = normalizePositiveInt(opts?.minRuns, 3, "minRuns");
  const maxRuns = normalizePositiveInt(opts?.maxRuns, 5, "maxRuns");
  if (minRuns > maxRuns) {
    throw new Error(`minRuns（${minRuns}）不能大于 maxRuns（${maxRuns}）`);
  }
  const pick = opts?.pickRunCount ?? randomRunCountInclusive;
  const plannedRuns = pick(minRuns, maxRuns);
  if (
    !Number.isInteger(plannedRuns) ||
    plannedRuns < minRuns ||
    plannedRuns > maxRuns
  ) {
    throw new Error(
      `pickRunCount 返回值须在 [${minRuns}, ${maxRuns}] 内且为整数，实际为 ${plannedRuns}`,
    );
  }

  const runBuckets =
    opts?.runStoryWordSentenceBucketsFromDbFn ??
    runStoryWordSentenceBucketsFromDb;
  const bucketsOpts = toBucketsOpts(opts);
  const rounds: StoryWordSentenceBucketsResult[] = [];
  for (let i = 0; i < plannedRuns; i += 1) {
    rounds.push(await runBuckets(dbPath, bucketsOpts));
  }

  return {
    minRuns,
    maxRuns,
    plannedRuns,
    sentenceLinkFeedback: sumSentenceLinkFeedback(
      rounds.map((r) => r.sentenceLinkFeedback),
    ),
    normalWordLinkFeedback: sumNormalWordLinkFeedback(
      rounds.map((r) => r.normalWordLinkFeedback),
    ),
    orphanNormalWordsDeleted: {
      count: rounds.reduce(
        (acc, r) => acc + r.orphanNormalWordsDeleted.count,
        0,
      ),
      ids: uniqSortedPositiveIds(
        rounds.map((r) => r.orphanNormalWordsDeleted.ids),
      ),
    },
    orphanSentenceMerge: {
      orphansFound: rounds.reduce(
        (acc, r) => acc + r.orphanSentenceMerge.orphansFound,
        0,
      ),
      mergedCount: rounds.reduce(
        (acc, r) => acc + r.orphanSentenceMerge.mergedCount,
        0,
      ),
      deletedCount: rounds.reduce(
        (acc, r) => acc + r.orphanSentenceMerge.deletedCount,
        0,
      ),
    },
  };
}
