import { describe, expect, it } from "vitest";
import { runDreamFeedbackPipelineFromDb } from "../src/dreaming-pipeline/runDreamFeedbackPipelineFromDb.js";

describe("runDreamFeedbackPipelineFromDb", () => {
  it("orchestrates story, feedback and orphan merge in order", async () => {
    const calls: string[] = [];
    const out = await runDreamFeedbackPipelineFromDb("/tmp/fake.sqlite", {
      runStorySentenceBucketsFromDbFn: async () => {
        calls.push("story");
        return {
          story: "dream text",
          words: ["a", "b"],
          relevance: { sentences: [{ id: 1, score: 90 }] },
          buckets: {
            words: ["a", "b"],
            id_ge_60: [1],
            id_ge_40_lt_60: [],
            id_lt_40: [],
          },
        };
      },
      applyResultLinkFeedbackFn: () => {
        calls.push("feedback");
        return {
          matchedNormalIds: 2,
          updatedSentenceRows: 1,
          updatedPlus: 1,
          updatedMinus: 0,
          deleted: 0,
          skippedConflicts: 0,
          targetedPlusSentences: 1,
          targetedMinusSentences: 0,
        };
      },
      mergeOrphanSentencesIntoTopScoredFn: async (_db, resultJsonPath) => {
        calls.push(`orphan:${resultJsonPath.endsWith("result.json")}`);
        return {
          topSentenceId: 1,
          orphansFound: 0,
          mergedCount: 0,
          deletedCount: 0,
        };
      },
    });

    expect(calls[0]).toBe("story");
    expect(calls[1]).toBe("feedback");
    expect(calls[2]).toBe("orphan:true");
    expect(out.story).toBe("dream text");
    expect(out.feedback.updatedSentenceRows).toBe(1);
    expect(out.orphanMerge.topSentenceId).toBe(1);
  });
});
