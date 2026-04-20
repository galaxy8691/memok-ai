import type OpenAI from "openai";
import { z } from "zod";
import {
  isDeepseekCompatibleBaseUrlFromUrl,
  preferJsonObjectOnlyFromConfig,
  runParseOrJson,
} from "../../llm/openaiCompat.js";
import {
  createOpenAIClient,
  type MemokPipelineConfig,
} from "../../memokPipeline.js";

const DEFAULT_MAX_OUTPUT = 2048;
const DEEPSEEK_CHAT_MAX_TOKENS_CAP = 8192;

export const MergeSentenceOutputSchema = z
  .object({
    sentence: z.string().min(1),
  })
  .strict();

export type MergeSentenceOutput = z.infer<typeof MergeSentenceOutputSchema>;

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

export const SYSTEM_PROMPT_MERGE_SENTENCE = `你是句子合并器。输入包含两个句子：base 与 orphan。
任务：把两句合并为一句更完整、信息不丢失且不编造的新句。
规则：
1) 保留事实，不添加输入之外的新事实。
2) 合并重叠信息，避免重复赘述。
3) 输出仅一个 JSON 对象：{ "sentence": "..." }。`;

export async function mergeSentenceText(
  baseSentence: string,
  orphanSentence: string,
  opts: {
    config: MemokPipelineConfig;
    client?: OpenAI;
    model?: string;
    maxTokens?: number;
  },
): Promise<string> {
  const base = baseSentence.trim();
  const orphan = orphanSentence.trim();
  if (!base || !orphan) {
    throw new Error("baseSentence and orphanSentence must be non-empty");
  }
  const { config } = opts;
  const model = (opts.model?.trim() || config.llmModel).trim();
  const client = opts.client ?? createOpenAIClient(config);
  const deepseek = isDeepseekCompatibleBaseUrlFromUrl(config.openaiBaseUrl);
  const budget = effectiveOutputBudget(
    deepseek,
    opts.maxTokens ?? config.sentenceMergeMaxCompletionTokens,
  );
  const userBody = JSON.stringify({ base, orphan });
  const out = await runParseOrJson({
    client,
    model,
    messagesParse: [
      { role: "system", content: SYSTEM_PROMPT_MERGE_SENTENCE },
      { role: "user", content: userBody },
    ],
    messagesJson: [
      {
        role: "system",
        content: `${SYSTEM_PROMPT_MERGE_SENTENCE}\n\n你必须只输出一个合法 JSON 对象。`,
      },
      { role: "user", content: `${userBody}\n\n只输出 JSON。` },
    ],
    schema: MergeSentenceOutputSchema,
    responseName: "MergeSentenceOutput",
    preferJsonObjectOnly: preferJsonObjectOnlyFromConfig(config),
    ...(deepseek ? { maxTokens: budget } : { maxCompletionTokens: budget }),
  });
  return out.sentence.trim();
}
