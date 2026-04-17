import { describe, expect, it } from "vitest";
import { runStoryWordSentenceBucketsFromDb } from "../src/dreaming-pipeline/story-word-sentence-pipeline/index.js";

describe("runStoryWordSentenceBucketsFromDb", () => {
  it("runs both branches in parallel then orphan cleanup", async () => {
    const order: string[] = [];
    const out = await runStoryWordSentenceBucketsFromDb("/tmp/x.sqlite", {
      sampleWordStringsFn: () => {
        order.push("words");
        return ["a"];
      },
      generateDreamTextFn: async () => {
        order.push("story");
        return "dream";
      },
      runSentenceRelevanceFromDbFn: async () => {
        order.push("sent-start");
        await new Promise((r) => setTimeout(r, 5));
        order.push("sent-end");
        return { sentences: [{ id: 1, score: 80 }] };
      },
      runNormalWordRelevanceFromDbFn: async () => {
        order.push("nw-start");
        await new Promise((r) => setTimeout(r, 5));
        order.push("nw-end");
        return { normalWords: [{ id: 10, score: 40 }] };
      },
      applyResultLinkFeedbackFn: () => {
        order.push("sent-fb");
        return {
          matchedNormalIds: 0,
          updatedSentenceRows: 0,
          updatedPlus: 0,
          insertedPlusSentenceLinks: 0,
          updatedMinus: 0,
          deleted: 0,
          skippedConflicts: 0,
          targetedPlusSentences: 0,
          targetedMinusSentences: 0,
        };
      },
      applyNormalWordLinkFeedbackFn: () => {
        order.push("nw-fb");
        return {
          matchedWordIds: 0,
          updatedPlus: 0,
          insertedPlusLinks: 0,
          updatedMinus: 0,
          deleted: 0,
          skippedConflicts: 0,
          targetedPlusNormalWords: 0,
          targetedMinusNormalWords: 0,
        };
      },
      deleteOrphanNormalWordsFn: () => {
        order.push("delete");
        return { count: 0, ids: [] };
      },
      mergeOrphanSentencesIntoTopScoredFn: async (_db, path) => {
        order.push(`orphan-sent:${path.endsWith("result.json")}`);
        return {
          topSentenceId: 1,
          orphansFound: 0,
          mergedCount: 0,
          deletedCount: 0,
        };
      },
    });

    expect(out.story).toBe("dream");
    expect(out.words).toEqual(["a"]);
    expect(out.relevance.sentences).toEqual([{ id: 1, score: 80 }]);
    expect(out.normalWordRelevance.normalWords).toEqual([
      { id: 10, score: 40 },
    ]);
    expect(out.buckets.id_ge_60).toEqual([1]);
    expect(out.normalWordBuckets).toEqual({
      id_ge_60: [],
      id_ge_40_lt_60: [10],
      id_lt_40: [],
    });
    expect(out.sentenceLinkFeedback.skippedConflicts).toBe(0);
    expect(out.normalWordLinkFeedback.skippedConflicts).toBe(0);
    expect(out.orphanNormalWordsDeleted).toEqual({ count: 0, ids: [] });
    expect(out.orphanSentenceMerge.topSentenceId).toBe(1);

    expect(order[0]).toBe("words");
    expect(order[1]).toBe("story");
    const parallel = order.slice(2, 6).sort();
    expect(parallel).toEqual(["nw-end", "nw-start", "sent-end", "sent-start"]);
    expect(order[6]).toBe("sent-fb");
    expect(order[7]).toBe("nw-fb");
    expect(order[8]).toBe("delete");
    expect(order[9]).toBe("orphan-sent:true");
  });
});
