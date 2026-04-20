import type OpenAI from "openai";
import type {
  MemokPipelineConfig,
  PipelineLlmContext,
} from "../../memokPipeline.js";
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
  /** 与 `ctx` 二选一或同时提供；优先使用 `ctx.config` */
  config?: MemokPipelineConfig;
};

export async function runSentenceRelevanceFromDb(
  dbPath: string,
  story: string,
  opts?: RunSentenceRelevanceFromDbOpts,
): Promise<SentenceRelevanceOutput> {
  const {
    client,
    model,
    maxTokens,
    ctx,
    config: explicitConfig,
    ...sampleOpts
  } = opts ?? {};
  const config = ctx?.config ?? explicitConfig;
  if (!config) {
    throw new Error(
      "runSentenceRelevanceFromDb: pass ctx (PipelineLlmContext) or config (MemokPipelineConfig)",
    );
  }
  const sentences = sampleSentencesForRelevance(dbPath, sampleOpts);
  return scoreSentenceRelevance(
    {
      story,
      sentences,
    },
    { config, client: client ?? ctx?.client, model, maxTokens },
  );
}
