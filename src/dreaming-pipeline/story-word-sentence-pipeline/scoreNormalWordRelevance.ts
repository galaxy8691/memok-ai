import type OpenAI from "openai";
import { z } from "zod";
import {
  createOpenAIClient,
  memokPipelineConfigFromProcessEnv,
  type PipelineLlmContext,
} from "../../config/memokPipelineConfig.js";
import {
  isDeepseekCompatibleBaseUrlFromUrl,
  preferJsonObjectOnlyFromConfig,
  runParseOrJson,
} from "../../llm/openaiCompat.js";

const ENV_NORMAL_WORD_RELEVANCE_MODEL = "MEMOK_NORMAL_WORD_RELEVANCE_LLM_MODEL";
const ENV_SENTENCE_RELEVANCE_MODEL = "MEMOK_SENTENCE_RELEVANCE_LLM_MODEL";
const ENV_MEMOK_LLM_MODEL = "MEMOK_LLM_MODEL";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_MAX_OUTPUT = 4096;
const DEEPSEEK_CHAT_MAX_TOKENS_CAP = 8192;
const MAX_ITEMS_PER_BATCH = 50;
/** Strict LLM attempts before coercing output to match input ids (default 5). */
const DEFAULT_MAX_LLM_ATTEMPTS = 5;
const HARD_CAP_LLM_ATTEMPTS = 32;

function maxLlmAttempts(): number {
  const raw = (process.env.MEMOK_RELEVANCE_SCORE_MAX_LLM_ATTEMPTS ?? "").trim();
  if (!raw) {
    return DEFAULT_MAX_LLM_ATTEMPTS;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_MAX_LLM_ATTEMPTS;
  }
  return Math.min(n, HARD_CAP_LLM_ATTEMPTS);
}

function clampScore0to100(n: number): number {
  const r = Math.round(Number(n));
  if (!Number.isFinite(r)) {
    return 50;
  }
  return Math.max(0, Math.min(100, r));
}

/** Align model output to input ids; missing ids get the mean of returned scores or 50. */
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
  let fallback = 50;
  if (byId.size > 0) {
    let sum = 0;
    for (const v of byId.values()) {
      sum += v;
    }
    fallback = Math.round(sum / byId.size);
  }
  const normalWords = input.normalWords.map(({ id }) => ({
    id,
    score: byId.has(id) ? (byId.get(id) as number) : fallback,
  }));
  return { normalWords };
}

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

function resolveModel(explicit?: string): string {
  if (explicit?.trim()) {
    return explicit.trim();
  }
  for (const key of [
    ENV_NORMAL_WORD_RELEVANCE_MODEL,
    ENV_SENTENCE_RELEVANCE_MODEL,
    ENV_MEMOK_LLM_MODEL,
  ]) {
    const v = (process.env[key] ?? "").trim();
    if (v) {
      return v;
    }
  }
  return DEFAULT_MODEL;
}

function effectiveOutputBudget(
  forDeepseek: boolean,
  explicit?: number,
): number {
  const cap = explicit ?? DEFAULT_MAX_OUTPUT;
  if (forDeepseek) {
    return Math.max(1, Math.min(cap, DEEPSEEK_CHAT_MAX_TOKENS_CAP));
  }
  return Math.max(256, Math.min(cap, 128_000));
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
  if (output.normalWords.length !== input.normalWords.length) {
    throw new Error(
      `normal_words 相关性评分条数不一致: input=${input.normalWords.length}, output=${output.normalWords.length}`,
    );
  }
  const inIds = new Set(input.normalWords.map((s) => s.id));
  const outIds = new Set(output.normalWords.map((s) => s.id));
  if (inIds.size !== outIds.size) {
    throw new Error("normal_words 相关性评分 id 数量不一致");
  }
  for (const id of inIds) {
    if (!outIds.has(id)) {
      throw new Error(`normal_words 相关性评分缺少输入 id=${id}`);
    }
  }
  for (const id of outIds) {
    if (!inIds.has(id)) {
      throw new Error(`normal_words 相关性评分出现未输入 id=${id}`);
    }
  }
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
  },
): Promise<NormalWordRelevanceOutput> {
  const userBody = `请对以下输入逐词评分并按指定 JSON 输出：\n${JSON.stringify(parsedInput)}`;
  const parseArgs = {
    client: opts.client,
    model: opts.model,
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
    schema: NormalWordRelevanceOutputSchema,
    responseName: "NormalWordRelevanceOutput",
    ...(opts.deepseek
      ? { maxTokens: opts.budget }
      : { maxCompletionTokens: opts.budget }),
    ...(opts.preferJsonObjectOnly !== undefined
      ? { preferJsonObjectOnly: opts.preferJsonObjectOnly }
      : {}),
  };

  const attempts = maxLlmAttempts();
  let lastError: unknown;
  let lastRaw: NormalWordRelevanceOutput | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const raw = await runParseOrJson(parseArgs);
    lastRaw = raw;
    try {
      return validateNormalWordRelevanceOutput(parsedInput, raw);
    } catch (e) {
      lastError = e;
    }
  }
  if (lastRaw) {
    return validateNormalWordRelevanceOutput(
      parsedInput,
      repairNormalWordRelevanceOutput(parsedInput, lastRaw),
    );
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function scoreNormalWordRelevance(
  input: NormalWordRelevanceInput,
  opts?: {
    client?: OpenAI;
    model?: string;
    maxTokens?: number;
    ctx?: PipelineLlmContext;
  },
): Promise<NormalWordRelevanceOutput> {
  const parsedInput = NormalWordRelevanceInputSchema.parse(input);
  if (opts?.ctx) {
    const model = (opts.model?.trim() || opts.ctx.config.llmModel).trim();
    const client = opts.ctx.client;
    const deepseek = isDeepseekCompatibleBaseUrlFromUrl(
      opts.ctx.config.openaiBaseUrl,
    );
    const budget = effectiveOutputBudget(
      deepseek,
      opts.maxTokens ?? opts.ctx.config.articleSentencesMaxOutputTokens,
    );
    const preferJson = preferJsonObjectOnlyFromConfig(opts.ctx.config);
    if (parsedInput.normalWords.length <= MAX_ITEMS_PER_BATCH) {
      return scoreOneBatch(parsedInput, {
        client,
        model,
        budget,
        deepseek,
        preferJsonObjectOnly: preferJson,
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
      });
      merged.push(...chunkOut.normalWords);
    }
    return validateNormalWordRelevanceOutput(parsedInput, {
      normalWords: merged,
    });
  }
  const cfg = memokPipelineConfigFromProcessEnv();
  const model = resolveModel(opts?.model);
  const client = opts?.client ?? createOpenAIClient(cfg);
  const deepseek = isDeepseekCompatibleBaseUrlFromUrl(cfg.openaiBaseUrl);
  const budget = effectiveOutputBudget(
    deepseek,
    opts?.maxTokens ?? cfg.articleSentencesMaxOutputTokens,
  );
  const preferJson = preferJsonObjectOnlyFromConfig(cfg);
  if (parsedInput.normalWords.length <= MAX_ITEMS_PER_BATCH) {
    return scoreOneBatch(parsedInput, {
      client,
      model,
      budget,
      deepseek,
      preferJsonObjectOnly: preferJson,
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
    });
    merged.push(...chunkOut.normalWords);
  }

  return validateNormalWordRelevanceOutput(parsedInput, {
    normalWords: merged,
  });
}
