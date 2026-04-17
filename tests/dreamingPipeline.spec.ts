import { describe, expect, it } from "vitest";
import type { PredreamDecayResult } from "../src/dreaming-pipeline/predream-pipeline/runPredreamDecayFromDb.js";
import { runDreamingPipelineFromDb } from "../src/dreaming-pipeline/runDreamingPipelineFromDb.js";
import type { StoryWordSentencePipelineResult } from "../src/dreaming-pipeline/story-word-sentence-pipeline/runStoryWordSentencePipelineFromDb.js";

describe("runDreamingPipelineFromDb", () => {
  it("runs predream then story-word-sentence-pipeline and merges reports", async () => {
    const order: string[] = [];
    const predream: PredreamDecayResult = {
      sentencesDurationDecremented: 2,
      promotedToLongTerm: 0,
      deletedSentences: 0,
    };
    const storyWordSentencePipeline: StoryWordSentencePipelineResult = {
      minRuns: 3,
      maxRuns: 5,
      plannedRuns: 1,
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
      orphanSentenceMerge: { orphansFound: 0, mergedCount: 0, deletedCount: 0 },
    };
    const out = await runDreamingPipelineFromDb("/tmp/x.sqlite", {
      pickRunCount: () => 1,
      runPredreamDecayFromDbFn: () => {
        order.push("predream");
        return predream;
      },
      runStoryWordSentencePipelineFromDbFn: async () => {
        order.push("story");
        return storyWordSentencePipeline;
      },
    });
    expect(order).toEqual(["predream", "story"]);
    expect(out.predream).toBe(predream);
    expect(out.storyWordSentencePipeline).toBe(storyWordSentencePipeline);
  });
});
