import type OpenAI from "openai";
import type { PipelineLlmContext } from "../../config/memokPipelineConfig.js";
import {
  type SampleSentencesForRelevanceOpts,
  sampleSentencesForRelevance,
} from "./sampleSentencesForRelevance.js";
import {
  type SentenceRelevanceOutput,
  scoreSentenceRelevance,
} from "./scoreSentenceRelevance.js";

export type RunSentenceRelevanceFromDbOpts = SampleSentencesForRelevanceOpts & {
  client?: OpenAI;
  model?: string;
  maxTokens?: number;
  ctx?: PipelineLlmContext;
};

export async function runSentenceRelevanceFromDb(
  dbPath: string,
  story: string,
  opts?: RunSentenceRelevanceFromDbOpts,
): Promise<SentenceRelevanceOutput> {
  const { client, model, maxTokens, ctx, ...sampleOpts } = opts ?? {};
  const sentences = sampleSentencesForRelevance(dbPath, sampleOpts);
  return scoreSentenceRelevance(
    {
      story,
      sentences,
    },
    { client, model, maxTokens, ctx },
  );
}
