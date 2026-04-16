import OpenAI from "openai";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyResultLinkFeedback, type ApplyResultLinkFeedbackResult } from "./applyResultLinkFeedback.js";
import {
  mergeOrphanSentencesIntoTopScored,
  type MergeOrphanResult,
} from "./mergeOrphanSentencesIntoTopScored.js";
import {
  runStorySentenceBucketsFromDb,
  type StorySentenceBucketsResult,
} from "./runStorySentenceBucketsFromDb.js";

export type RunDreamFeedbackPipelineFromDbOpts = {
  maxWords?: number;
  fraction?: number;
  client?: OpenAI;
  model?: string;
  maxTokens?: number;
  runStorySentenceBucketsFromDbFn?: typeof runStorySentenceBucketsFromDb;
  applyResultLinkFeedbackFn?: typeof applyResultLinkFeedback;
  mergeOrphanSentencesIntoTopScoredFn?: typeof mergeOrphanSentencesIntoTopScored;
};

export type DreamFeedbackPipelineResult = StorySentenceBucketsResult & {
  feedback: ApplyResultLinkFeedbackResult;
  orphanMerge: MergeOrphanResult;
};

export async function runDreamFeedbackPipelineFromDb(
  dbPath: string,
  opts?: RunDreamFeedbackPipelineFromDbOpts,
): Promise<DreamFeedbackPipelineResult> {
  const runStoryFn = opts?.runStorySentenceBucketsFromDbFn ?? runStorySentenceBucketsFromDb;
  const applyFeedbackFn = opts?.applyResultLinkFeedbackFn ?? applyResultLinkFeedback;
  const mergeOrphanFn = opts?.mergeOrphanSentencesIntoTopScoredFn ?? mergeOrphanSentencesIntoTopScored;
  const storyResult = await runStoryFn(dbPath, opts);
  const feedback = applyFeedbackFn(dbPath, {
    words: storyResult.words,
    buckets: storyResult.buckets,
  });

  const tempDir = mkdtempSync(join(tmpdir(), "memok-dream-feedback-"));
  const tempResultPath = join(tempDir, "result.json");
  try {
    writeFileSync(tempResultPath, JSON.stringify(storyResult), "utf-8");
    const orphanMerge = await mergeOrphanFn(dbPath, tempResultPath);
    return {
      ...storyResult,
      feedback,
      orphanMerge,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
