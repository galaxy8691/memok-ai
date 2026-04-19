import type OpenAI from "openai";
import type { PipelineLlmContext } from "../../config/memokPipelineConfig.js";
import {
  type SampleNormalWordsForRelevanceOpts,
  sampleNormalWordsForRelevance,
} from "./sampleNormalWordsForRelevance.js";
import {
  type NormalWordRelevanceOutput,
  scoreNormalWordRelevance,
} from "./scoreNormalWordRelevance.js";

export type RunNormalWordRelevanceFromDbOpts =
  SampleNormalWordsForRelevanceOpts & {
    client?: OpenAI;
    model?: string;
    maxTokens?: number;
    ctx?: PipelineLlmContext;
  };

export async function runNormalWordRelevanceFromDb(
  dbPath: string,
  story: string,
  opts?: RunNormalWordRelevanceFromDbOpts,
): Promise<NormalWordRelevanceOutput> {
  const { client, model, maxTokens, ctx, ...sampleOpts } = opts ?? {};
  const normalWords = sampleNormalWordsForRelevance(dbPath, sampleOpts);
  return scoreNormalWordRelevance(
    {
      story,
      normalWords,
    },
    { client, model, maxTokens, ctx },
  );
}
