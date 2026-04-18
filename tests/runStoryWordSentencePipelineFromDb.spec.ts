import { describe, expect, it } from "vitest";
import {
  runStoryWordSentencePipelineFromDb,
  type StoryWordSentenceBucketsResult,
} from "../src/dreaming-pipeline/story-word-sentence-pipeline/index.js";

function stubRound(
  overrides: Partial<StoryWordSentenceBucketsResult> = {},
): StoryWordSentenceBucketsResult {
  const base: StoryWordSentenceBucketsResult = {
    story: "x",
    words: ["a"],
    relevance: { sentences: [{ id: 1, score: 50 }] },
    buckets: { words: ["a"], id_ge_60: [], id_ge_40_lt_60: [1], id_lt_40: [] },
    sentenceLinkFeedback: {
      matchedNormalIds: 0,
      updatedSentenceRows: 0,
      updatedPlus: 0,
      insertedPlusSentenceLinks: 0,
      updatedMinus: 0,
      deleted: 0,
      skippedConflicts: 0,
      targetedPlusSentences: 0,
      targetedMinusSentences: 0,
    },
    normalWordRelevance: { normalWords: [] },
    normalWordBuckets: { id_ge_60: [], id_ge_40_lt_60: [], id_lt_40: [] },
    normalWordLinkFeedback: {
      matchedWordIds: 0,
      updatedPlus: 0,
      insertedPlusLinks: 0,
      updatedMinus: 0,
      deleted: 0,
      skippedConflicts: 0,
      targetedPlusNormalWords: 0,
      targetedMinusNormalWords: 0,
    },
    orphanNormalWordsDeleted: { count: 0, ids: [] },
    orphanSentenceMerge: {
      topSentenceId: 1,
      orphansFound: 0,
      mergedCount: 0,
      deletedCount: 0,
    },
  };
  return { ...base, ...overrides };
}

describe("runStoryWordSentencePipelineFromDb", () => {
  it("returns only aggregated stats across plannedRuns", async () => {
    let calls = 0;
    const out = await runStoryWordSentencePipelineFromDb("/tmp/x.sqlite", {
      minRuns: 3,
      maxRuns: 5,
      pickRunCount: () => 3,
      runStoryWordSentenceBucketsFromDbFn: async () => {
        calls += 1;
        return stubRound({
          sentenceLinkFeedback: {
            matchedNormalIds: 1,
            updatedSentenceRows: 2,
            updatedPlus: calls,
            insertedPlusSentenceLinks: 0,
            updatedMinus: 0,
            deleted: 0,
            skippedConflicts: 0,
            targetedPlusSentences: 0,
            targetedMinusSentences: 0,
          },
          normalWordLinkFeedback: {
            matchedWordIds: 10,
            updatedPlus: 0,
            insertedPlusLinks: calls * 2,
            updatedMinus: 0,
            deleted: 0,
            skippedConflicts: 0,
            targetedPlusNormalWords: 0,
            targetedMinusNormalWords: 0,
          },
          orphanNormalWordsDeleted: {
            count: 1,
            ids: [calls],
          },
          orphanSentenceMerge: {
            topSentenceId: 99,
            orphansFound: 1,
            mergedCount: 0,
            deletedCount: calls,
          },
        });
      },
    });
    expect(calls).toBe(3);
    expect(out.plannedRuns).toBe(3);
    expect(out.minRuns).toBe(3);
    expect(out.maxRuns).toBe(5);
    expect("rounds" in out).toBe(false);
    expect(out.sentenceLinkFeedback.updatedPlus).toBe(1 + 2 + 3);
    expect(out.sentenceLinkFeedback.matchedNormalIds).toBe(3);
    expect(out.normalWordLinkFeedback.insertedPlusLinks).toBe(2 + 4 + 6);
    expect(out.normalWordLinkFeedback.matchedWordIds).toBe(30);
    expect(out.orphanNormalWordsDeleted.count).toBe(3);
    expect(out.orphanNormalWordsDeleted.ids).toEqual([1, 2, 3]);
    expect(out.orphanSentenceMerge).toEqual({
      orphansFound: 3,
      mergedCount: 0,
      deletedCount: 6,
    });
  });

  it("honors pickRunCount of 5 for call count and aggregation", async () => {
    let calls = 0;
    const out = await runStoryWordSentencePipelineFromDb("/tmp/x.sqlite", {
      pickRunCount: () => 5,
      runStoryWordSentenceBucketsFromDbFn: async () => {
        calls += 1;
        return stubRound();
      },
    });
    expect(calls).toBe(5);
    expect(out.plannedRuns).toBe(5);
    expect(out.sentenceLinkFeedback.matchedNormalIds).toBe(0);
  });

  it("throws when minRuns > maxRuns", async () => {
    await expect(
      runStoryWordSentencePipelineFromDb("/tmp/x.sqlite", {
        minRuns: 5,
        maxRuns: 3,
        runStoryWordSentenceBucketsFromDbFn: async () => stubRound(),
      }),
    ).rejects.toThrow(/minRuns/);
  });

  it("throws when pickRunCount returns out of range", async () => {
    await expect(
      runStoryWordSentencePipelineFromDb("/tmp/x.sqlite", {
        minRuns: 3,
        maxRuns: 5,
        pickRunCount: () => 10,
        runStoryWordSentenceBucketsFromDbFn: async () => stubRound(),
      }),
    ).rejects.toThrow(/pickRunCount/);
  });
});
