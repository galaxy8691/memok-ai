import type OpenAI from "openai";
import { z } from "zod";
import {
  isDeepseekCompatibleBaseUrlFromUrl,
  preferJsonObjectOnlyFromConfig,
} from "../../llm/openaiCompat.js";
import {
  createOpenAIClient,
  type MemokPipelineConfig,
} from "../../memokPipeline.js";
import {
  clampScore0to100,
  computeFallbackScore,
  DEFAULT_MAX_LLM_ATTEMPTS,
  effectiveOutputBudget,
  MAX_ITEMS_PER_BATCH,
  repairRelevanceScores,
  scoreOneBatchWithRetry,
  validateRelevanceIds,
} from "./relevanceScoreShared.js";

export const NormalWordRelevanceInputSchema = z
  .object({
    story: z.string().min(1),
    normalWords: z.array(
      z.object({ id: z.number().int(), word: z.string() }).strict(),
    ),
  })
  .strict();

export const NormalWordRelevanceOutputSchema = z
  .object({
    // 不用 .strict()：部分模型会在每项里回显 word，strip 掉即可
    normalWords: z.array(
      z.object({
        id: z.number().int(),
        score: z.number().int().min(0).max(100),
      }),
    ),
  })
  .strict();

export type NormalWordRelevanceInput = z.infer<
  typeof NormalWordRelevanceInputSchema
>;
export type NormalWordRelevanceOutput = z.infer<
  typeof NormalWordRelevanceOutputSchema
>;

export function repairNormalWordRelevanceOutput(
  input: NormalWordRelevanceInput,
  output: NormalWordRelevanceOutput,
): NormalWordRelevanceOutput {
  const byId = new Map<number, number>();
  for (const row of output.normalWords) {
    if (Number.isFinite(row.id)) {
      byId.set(row.id, clampScore0to100(row.score));
    }
  }
  const fallback = computeFallbackScore(byId);
  const normalWords = repairRelevanceScores(
    input.normalWords.map((s) => s.id),
    byId,
    fallback,
  );
  return { normalWords };
}

export const SYSTEM_PROMPT_NORMAL_WORD_RELEVANCE = `你是相关性评分器。用户会给你一个 JSON 对象，形状为：
{ "story": string, "normalWords": [{ "id": number, "word": string }] }

任务：对每个规范化词（word）与 story 的语义相关性评分，0-100 的整数。
评分规则（建议，偏宽松）：
- 80-100：高度相关，核心语义直接匹配
- 55-79：明显相关，有实质交集
- 30-54：部分相关，有主题/术语/场景上的关联
- 10-29：弱相关，只有少量关联线索
- 0-9：基本无关
注意：只要词与 story 在主题、术语、场景、任务背景任一方面有可解释关联，就不要给 0 分。

硬性要求：
1) 必须只输出 JSON 对象，且仅有顶层键 "normalWords"。
2) 每个输入 id 必须且仅出现一次；不允许新增或缺失 id。
3) score 必须是 0-100 整数。`;

export function validateNormalWordRelevanceOutput(
  input: NormalWordRelevanceInput,
  output: NormalWordRelevanceOutput,
): NormalWordRelevanceOutput {
  validateRelevanceIds(input.normalWords, output.normalWords, "normal_words");
  return output;
}

async function scoreOneBatch(
  parsedInput: NormalWordRelevanceInput,
  opts: {
    client: OpenAI;
    model: string;
    budget: number;
    deepseek: boolean;
    preferJsonObjectOnly?: boolean;
    maxAttempts: number;
  },
): Promise<NormalWordRelevanceOutput> {
  const userBody = `请对以下输入逐词评分并按指定 JSON 输出：\n${JSON.stringify(parsedInput)}`;
  const messages = {
    messagesParse: [
      { role: "system" as const, content: SYSTEM_PROMPT_NORMAL_WORD_RELEVANCE },
      { role: "user" as const, content: userBody },
    ],
    messagesJson: [
      {
        role: "system" as const,
        content: `${SYSTEM_PROMPT_NORMAL_WORD_RELEVANCE}\n\n你必须只输出一个合法 JSON 对象。`,
      },
      {
        role: "user" as const,
        content: `${userBody}\n\n只输出 JSON，不要代码围栏。`,
      },
    ],
  };

  return scoreOneBatchWithRetry({
    client: opts.client,
    model: opts.model,
    budget: opts.budget,
    deepseek: opts.deepseek,
    preferJsonObjectOnly: opts.preferJsonObjectOnly,
    messages,
    schema: NormalWordRelevanceOutputSchema,
    responseName: "NormalWordRelevanceOutput",
    validate: (raw) => validateNormalWordRelevanceOutput(parsedInput, raw),
    repair: (raw) => repairNormalWordRelevanceOutput(parsedInput, raw),
    maxAttempts: opts.maxAttempts,
  });
}

export async function scoreNormalWordRelevance(
  input: NormalWordRelevanceInput,
  opts: {
    config: MemokPipelineConfig;
    client?: OpenAI;
    model?: string;
    maxTokens?: number;
  },
): Promise<NormalWordRelevanceOutput> {
  const parsedInput = NormalWordRelevanceInputSchema.parse(input);
  const { config } = opts;
  const model = (opts.model?.trim() || config.llmModel).trim();
  const client = opts.client ?? createOpenAIClient(config);
  const deepseek = isDeepseekCompatibleBaseUrlFromUrl(config.openaiBaseUrl);
  const budget = effectiveOutputBudget(
    deepseek,
    opts.maxTokens ?? config.articleSentencesMaxOutputTokens,
  );
  const preferJson = preferJsonObjectOnlyFromConfig(config);
  const maxAttempts =
    config.relevanceScoreMaxLlmAttempts ?? DEFAULT_MAX_LLM_ATTEMPTS;
  if (parsedInput.normalWords.length <= MAX_ITEMS_PER_BATCH) {
    return scoreOneBatch(parsedInput, {
      client,
      model,
      budget,
      deepseek,
      preferJsonObjectOnly: preferJson,
      maxAttempts,
    });
  }

  const merged: NormalWordRelevanceOutput["normalWords"] = [];
  for (
    let i = 0;
    i < parsedInput.normalWords.length;
    i += MAX_ITEMS_PER_BATCH
  ) {
    const chunkInput: NormalWordRelevanceInput = {
      story: parsedInput.story,
      normalWords: parsedInput.normalWords.slice(i, i + MAX_ITEMS_PER_BATCH),
    };
    const chunkOut = await scoreOneBatch(chunkInput, {
      client,
      model,
      budget,
      deepseek,
      preferJsonObjectOnly: preferJson,
      maxAttempts,
    });
    merged.push(...chunkOut.normalWords);
  }

  return validateNormalWordRelevanceOutput(parsedInput, {
    normalWords: merged,
  });
}
