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

export const SentenceRelevanceInputSchema = z
  .object({
    story: z.string().min(1),
    sentences: z.array(
      z.object({ id: z.number().int(), sentence: z.string() }).strict(),
    ),
  })
  .strict();

export const SentenceRelevanceOutputSchema = z
  .object({
    sentences: z.array(
      z
        .object({
          id: z.number().int(),
          score: z.number().int().min(0).max(100),
        })
        .strict(),
    ),
  })
  .strict();

export type SentenceRelevanceInput = z.infer<
  typeof SentenceRelevanceInputSchema
>;
export type SentenceRelevanceOutput = z.infer<
  typeof SentenceRelevanceOutputSchema
>;

export function repairSentenceRelevanceOutput(
  input: SentenceRelevanceInput,
  output: SentenceRelevanceOutput,
): SentenceRelevanceOutput {
  const byId = new Map<number, number>();
  for (const row of output.sentences) {
    if (Number.isFinite(row.id)) {
      byId.set(row.id, clampScore0to100(row.score));
    }
  }
  const fallback = computeFallbackScore(byId);
  const sentences = repairRelevanceScores(
    input.sentences.map((s) => s.id),
    byId,
    fallback,
  );
  return { sentences };
}

export const SYSTEM_PROMPT_SENTENCE_RELEVANCE = `你是相关性评分器。用户会给你一个 JSON 对象，形状为：
{ "story": string, "sentences": [{ "id": number, "sentence": string }] }

任务：对每条 sentence 与 story 的语义相关性评分，0-100 的整数。
评分规则（建议，偏宽松）：
- 80-100：高度相关，核心语义直接匹配
- 55-79：明显相关，有实质交集
- 30-54：部分相关，有主题/术语/场景上的关联
- 10-29：弱相关，只有少量关联线索
- 0-9：基本无关
注意：只要句子与 story 在主题、术语、场景、任务背景任一方面有可解释关联，就不要给 0 分。

硬性要求：
1) 必须只输出 JSON 对象，且仅有顶层键 "sentences"。
2) 每个输入 id 必须且仅出现一次；不允许新增或缺失 id。
3) score 必须是 0-100 整数。`;

export function validateSentenceRelevanceOutput(
  input: SentenceRelevanceInput,
  output: SentenceRelevanceOutput,
): SentenceRelevanceOutput {
  validateRelevanceIds(input.sentences, output.sentences, "sentences");
  return output;
}

async function scoreOneBatch(
  parsedInput: SentenceRelevanceInput,
  opts: {
    client: OpenAI;
    model: string;
    budget: number;
    deepseek: boolean;
    preferJsonObjectOnly?: boolean;
    maxAttempts: number;
  },
): Promise<SentenceRelevanceOutput> {
  const userBody = `请对以下输入逐句评分并按指定 JSON 输出：\n${JSON.stringify(parsedInput)}`;
  const messages = {
    messagesParse: [
      { role: "system" as const, content: SYSTEM_PROMPT_SENTENCE_RELEVANCE },
      { role: "user" as const, content: userBody },
    ],
    messagesJson: [
      {
        role: "system" as const,
        content: `${SYSTEM_PROMPT_SENTENCE_RELEVANCE}\n\n你必须只输出一个合法 JSON 对象。`,
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
    schema: SentenceRelevanceOutputSchema,
    responseName: "SentenceRelevanceOutput",
    validate: (raw) => validateSentenceRelevanceOutput(parsedInput, raw),
    repair: (raw) => repairSentenceRelevanceOutput(parsedInput, raw),
    maxAttempts: opts.maxAttempts,
  });
}

export async function scoreSentenceRelevance(
  input: SentenceRelevanceInput,
  opts: {
    config: MemokPipelineConfig;
    client?: OpenAI;
    model?: string;
    maxTokens?: number;
  },
): Promise<SentenceRelevanceOutput> {
  const parsedInput = SentenceRelevanceInputSchema.parse(input);
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
  if (parsedInput.sentences.length <= MAX_ITEMS_PER_BATCH) {
    return scoreOneBatch(parsedInput, {
      client,
      model,
      budget,
      deepseek,
      preferJsonObjectOnly: preferJson,
      maxAttempts,
    });
  }

  const merged: SentenceRelevanceOutput["sentences"] = [];
  for (let i = 0; i < parsedInput.sentences.length; i += MAX_ITEMS_PER_BATCH) {
    const chunkInput: SentenceRelevanceInput = {
      story: parsedInput.story,
      sentences: parsedInput.sentences.slice(i, i + MAX_ITEMS_PER_BATCH),
    };
    const chunkOut = await scoreOneBatch(chunkInput, {
      client,
      model,
      budget,
      deepseek,
      preferJsonObjectOnly: preferJson,
      maxAttempts,
    });
    merged.push(...chunkOut.sentences);
  }

  return validateSentenceRelevanceOutput(parsedInput, { sentences: merged });
}
