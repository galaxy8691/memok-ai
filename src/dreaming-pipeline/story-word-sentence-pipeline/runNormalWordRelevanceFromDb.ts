import type OpenAI from "openai";
import type {
  MemokPipelineConfig,
  PipelineLlmContext,
} from "../../memokPipeline.js";
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
    /** 与 `ctx` 二选一或同时提供；优先使用 `ctx.config` */
    config?: MemokPipelineConfig;
  };

export async function runNormalWordRelevanceFromDb(
  dbPath: string,
  story: string,
  opts?: RunNormalWordRelevanceFromDbOpts,
): Promise<NormalWordRelevanceOutput> {
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
      "runNormalWordRelevanceFromDb: pass ctx (PipelineLlmContext) or config (MemokPipelineConfig)",
    );
  }
  const normalWords = sampleNormalWordsForRelevance(dbPath, sampleOpts);
  return scoreNormalWordRelevance(
    {
      story,
      normalWords,
    },
    { config, client: client ?? ctx?.client, model, maxTokens },
  );
}
