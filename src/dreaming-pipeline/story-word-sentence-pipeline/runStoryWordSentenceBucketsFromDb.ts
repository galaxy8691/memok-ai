import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type OpenAI from "openai";
import {
  type ApplyNormalWordLinkFeedbackResult,
  applyNormalWordLinkFeedback,
} from "./applyNormalWordLinkFeedback.js";
import {
  type ApplyResultLinkFeedbackResult,
  applyResultLinkFeedback,
} from "./applyResultLinkFeedback.js";
import {
  buildNormalWordRelevanceBuckets,
  buildRelevanceBuckets,
  type NormalWordRelevanceBuckets,
  type RelevanceBuckets,
} from "./buildRelevanceBuckets.js";
import {
  type DeleteOrphanNormalWordsResult,
  deleteOrphanNormalWords,
} from "./deleteOrphanNormalWords.js";
import { generateDreamText } from "./generateDreamText.js";
import {
  type MergeOrphanResult,
  mergeOrphanSentencesIntoTopScored,
} from "./mergeOrphanSentencesIntoTopScored.js";
import { runNormalWordRelevanceFromDb } from "./runNormalWordRelevanceFromDb.js";
import { runSentenceRelevanceFromDb } from "./runSentenceRelevanceFromDb.js";
import { sampleWordStrings } from "./sampleWordStrings.js";
import type { NormalWordRelevanceOutput } from "./scoreNormalWordRelevance.js";
import type { SentenceRelevanceOutput } from "./scoreSentenceRelevance.js";

export type RunStoryWordSentenceBucketsFromDbOpts = {
  maxWords?: number;
  fraction?: number;
  client?: OpenAI;
  model?: string;
  maxTokens?: number;
  /** 测试注入 */
  sampleWordStringsFn?: typeof sampleWordStrings;
  generateDreamTextFn?: typeof generateDreamText;
  runSentenceRelevanceFromDbFn?: typeof runSentenceRelevanceFromDb;
  runNormalWordRelevanceFromDbFn?: typeof runNormalWordRelevanceFromDb;
  deleteOrphanNormalWordsFn?: typeof deleteOrphanNormalWords;
  applyNormalWordLinkFeedbackFn?: typeof applyNormalWordLinkFeedback;
  applyResultLinkFeedbackFn?: typeof applyResultLinkFeedback;
  mergeOrphanSentencesIntoTopScoredFn?: typeof mergeOrphanSentencesIntoTopScored;
};

/** `story-word-sentence-buckets` / 库函数 `runStoryWordSentenceBucketsFromDb` 的完整 stdout 形状；字段缺一不可（含末尾 `orphanSentenceMerge`）。 */
export type StoryWordSentenceBucketsResult = {
  story: string;
  words: string[];
  relevance: SentenceRelevanceOutput;
  buckets: RelevanceBuckets;
  /** 句子分桶对 `sentences` / `sentence_to_normal_link` 的回写统计（与 `apply-result-link-feedback` 同源） */
  sentenceLinkFeedback: ApplyResultLinkFeedbackResult;
  normalWordRelevance: NormalWordRelevanceOutput;
  normalWordBuckets: NormalWordRelevanceBuckets;
  normalWordLinkFeedback: ApplyNormalWordLinkFeedbackResult;
  orphanNormalWordsDeleted: DeleteOrphanNormalWordsResult;
  /** 无 `sentence_to_normal_link` 的孤儿句并入本轮最高分句后删除；与 `merge-orphan-sentences` 同源；为完整 dreaming 的最后一步统计 */
  orphanSentenceMerge: MergeOrphanResult;
};

/**
 * 一次完整 dreaming：故事 + 双分支评分与分桶；回写句子/词语 link；删孤立 `normal_words`；再合并删孤立 `sentences`（`orphanSentenceMerge`）。
 */
export async function runStoryWordSentenceBucketsFromDb(
  dbPath: string,
  opts?: RunStoryWordSentenceBucketsFromDbOpts,
): Promise<StoryWordSentenceBucketsResult> {
  const sampleWordsFn = opts?.sampleWordStringsFn ?? sampleWordStrings;
  const genStoryFn = opts?.generateDreamTextFn ?? generateDreamText;
  const runSentFn =
    opts?.runSentenceRelevanceFromDbFn ?? runSentenceRelevanceFromDb;
  const runNwFn =
    opts?.runNormalWordRelevanceFromDbFn ?? runNormalWordRelevanceFromDb;
  const delOrphanFn =
    opts?.deleteOrphanNormalWordsFn ?? deleteOrphanNormalWords;
  const applyNwFbFn =
    opts?.applyNormalWordLinkFeedbackFn ?? applyNormalWordLinkFeedback;
  const applySentFbFn =
    opts?.applyResultLinkFeedbackFn ?? applyResultLinkFeedback;
  const mergeOrphanFn =
    opts?.mergeOrphanSentencesIntoTopScoredFn ??
    mergeOrphanSentencesIntoTopScored;

  const words = sampleWordsFn(dbPath, { maxWords: opts?.maxWords });
  const story = await genStoryFn(words, {
    client: opts?.client,
    model: opts?.model,
    maxTokens: opts?.maxTokens,
  });
  const fraction = opts?.fraction ?? 0.2;
  const llmOpts = {
    client: opts?.client,
    model: opts?.model,
    maxTokens: opts?.maxTokens,
  };
  const [relevance, normalWordRelevance] = await Promise.all([
    runSentFn(dbPath, story, { fraction, ...llmOpts }),
    runNwFn(dbPath, story, { fraction, ...llmOpts }),
  ]);
  const buckets = buildRelevanceBuckets(words, relevance);
  const sentenceLinkFeedback = applySentFbFn(dbPath, {
    words,
    buckets,
  });
  const normalWordBuckets =
    buildNormalWordRelevanceBuckets(normalWordRelevance);
  const normalWordLinkFeedback = applyNwFbFn(dbPath, {
    words,
    normalWordBuckets,
  });
  const orphanNormalWordsDeleted = delOrphanFn(dbPath);
  const payload: Omit<StoryWordSentenceBucketsResult, "orphanSentenceMerge"> = {
    story,
    words,
    relevance,
    buckets,
    sentenceLinkFeedback,
    normalWordRelevance,
    normalWordBuckets,
    normalWordLinkFeedback,
    orphanNormalWordsDeleted,
  };
  const tempDir = mkdtempSync(join(tmpdir(), "memok-story-buckets-"));
  const tempResultPath = join(tempDir, "result.json");
  let orphanSentenceMerge: MergeOrphanResult;
  try {
    writeFileSync(tempResultPath, JSON.stringify(payload), "utf-8");
    orphanSentenceMerge = await mergeOrphanFn(dbPath, tempResultPath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
  return { ...payload, orphanSentenceMerge };
}
