import OpenAI from "openai";
import { z } from "zod";
import {
  isDeepseekCompatibleBaseUrl,
  loadProjectEnv,
  runParseOrJson,
} from "../../llm/openaiCompat.js";

const ENV_NORMAL_WORD_RELEVANCE_MODEL = "MEMOK_NORMAL_WORD_RELEVANCE_LLM_MODEL";
const ENV_SENTENCE_RELEVANCE_MODEL = "MEMOK_SENTENCE_RELEVANCE_LLM_MODEL";
const ENV_MEMOK_LLM_MODEL = "MEMOK_LLM_MODEL";
const DEFAULT_MODEL = "gpt-4o-mini";
const DEFAULT_MAX_OUTPUT = 4096;
const DEEPSEEK_CHAT_MAX_TOKENS_CAP = 8192;
const MAX_ITEMS_PER_BATCH = 50;

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
  opts: { client: OpenAI; model: string; budget: number; deepseek: boolean },
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
  };

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await runParseOrJson(parseArgs);
    try {
      return validateNormalWordRelevanceOutput(parsedInput, raw);
    } catch (e) {
      lastError = e;
      const tooFew = raw.normalWords.length < parsedInput.normalWords.length;
      if (attempt === 0 && tooFew) {
        continue;
      }
      throw e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function scoreNormalWordRelevance(
  input: NormalWordRelevanceInput,
  opts?: { client?: OpenAI; model?: string; maxTokens?: number },
): Promise<NormalWordRelevanceOutput> {
  loadProjectEnv();
  const parsedInput = NormalWordRelevanceInputSchema.parse(input);
  const model = resolveModel(opts?.model);
  const client = opts?.client ?? new OpenAI();
  const deepseek = isDeepseekCompatibleBaseUrl();
  const budget = effectiveOutputBudget(deepseek, opts?.maxTokens);
  if (parsedInput.normalWords.length <= MAX_ITEMS_PER_BATCH) {
    return scoreOneBatch(parsedInput, { client, model, budget, deepseek });
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
    });
    merged.push(...chunkOut.normalWords);
  }

  return validateNormalWordRelevanceOutput(parsedInput, {
    normalWords: merged,
  });
}
