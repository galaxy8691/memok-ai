import OpenAI from "openai";
import {
  scoreSentenceRelevance,
  type SentenceRelevanceOutput,
} from "./scoreSentenceRelevance.js";
import {
  sampleSentencesForRelevance,
  type SampleSentencesForRelevanceOpts,
} from "./sampleSentencesForRelevance.js";

export type RunSentenceRelevanceFromDbOpts = SampleSentencesForRelevanceOpts & {
  client?: OpenAI;
  model?: string;
  maxTokens?: number;
};

export async function runSentenceRelevanceFromDb(
  dbPath: string,
  story: string,
  opts?: RunSentenceRelevanceFromDbOpts,
): Promise<SentenceRelevanceOutput> {
  const { client, model, maxTokens, ...sampleOpts } = opts ?? {};
  const sentences = sampleSentencesForRelevance(dbPath, sampleOpts);
  return scoreSentenceRelevance(
    {
      story,
      sentences,
    },
    { client, model, maxTokens },
  );
}
