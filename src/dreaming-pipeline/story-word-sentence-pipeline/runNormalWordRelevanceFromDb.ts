import OpenAI from "openai";
import {
  scoreNormalWordRelevance,
  type NormalWordRelevanceOutput,
} from "./scoreNormalWordRelevance.js";
import {
  sampleNormalWordsForRelevance,
  type SampleNormalWordsForRelevanceOpts,
} from "./sampleNormalWordsForRelevance.js";

export type RunNormalWordRelevanceFromDbOpts = SampleNormalWordsForRelevanceOpts & {
  client?: OpenAI;
  model?: string;
  maxTokens?: number;
};

export async function runNormalWordRelevanceFromDb(
  dbPath: string,
  story: string,
  opts?: RunNormalWordRelevanceFromDbOpts,
): Promise<NormalWordRelevanceOutput> {
  const { client, model, maxTokens, ...sampleOpts } = opts ?? {};
  const normalWords = sampleNormalWordsForRelevance(dbPath, sampleOpts);
  return scoreNormalWordRelevance(
    {
      story,
      normalWords,
    },
    { client, model, maxTokens },
  );
}
