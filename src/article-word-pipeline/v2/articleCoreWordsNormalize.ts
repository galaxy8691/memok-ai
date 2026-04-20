import type OpenAI from "openai";
import {
  isDeepseekCompatibleBaseUrl,
  isDeepseekCompatibleBaseUrlFromUrl,
  preferJsonObjectOnlyFromConfig,
  runParseOrJson,
} from "../../llm/openaiCompat.js";
import {
  createOpenAIClient,
  type MemokPipelineConfig,
} from "../../memokPipeline.js";
import {
  type ArticleCoreWordsData,
  type ArticleCoreWordsNomalizedData,
  ArticleCoreWordsNomalizedDataSchema,
} from "./schemas.js";

const DEEPSEEK_CHAT_MAX_TOKENS_CAP = 8192;

export const SYSTEM_PROMPT_ARTICLE_CORE_WORDS_NORMALIZE = `你是「记忆锚点」同义归一助手。用户会提供 JSON，顶层键 \`\`core_words\`\`，值为**已去重且保序**的字符串数组（每个字符串是一条原子锚点）。

你的任务：识别**语义相同、别称、极近义**的条目，将它们映射到**同一规范词形** \`\`new_text\`\`（优先更短、更常用、更利于检索的写法；勿编造与输入无关的新实体）。

\`\`new_text\`\` 规范化要求（非常重要）：
- 输出应为**简洁规范词**，尽量是名词/短语，不要保留装饰符号、代码样式、编号细节。
- 不要输出包含 \`\`+ - : / * # @ _\`\` 等符号的词形；不要输出 markdown/代码片段。
- 不要把具体数字留在 \`\`new_text\`\`（数字细节留在 \`\`original_text\`\` 即可）。
- 时间日期请归一为概念词：如 \`\`UTC+02:00\`\` → \`\`时间\`\`，\`\`2017年12月28日\`\` → \`\`日期\`\`。
- 带评分/星号等装饰请去装饰并语义化：如 \`\`技巧★★★\`\` → \`\`技巧\`\`。
- 百分比/纯数值可归一为 \`\`比例\`\` / \`\`数值\`\`；年份可归一为 \`\`年份\`\`。

硬性规则：
1) 输出**恰好一个**顶层键 \`\`nomalized\`\`（数组）。数组元素对象**仅**含键 \`\`original_text\`\` 与 \`\`new_text\`\`（均为字符串）。
2) 对输入 \`\`core_words\`\` 中**每一个**字符串 \`\`w\`\`，必须**恰好出现一次**作为某元素的 \`\`original_text\`\`，且该元素的 \`\`new_text\`\` 为 \`\`w\`\` 所属等价类的规范词。
3) 若 \`\`w\`\` 无需与任何其他词合并，则输出 \`\`{ "original_text": "w", "new_text": "w" }\`\` 或 \`\`new_text\`\` 为轻微字形规范（勿改专名事实）。
4) 不要输出 markdown 围栏；不要输出除上述 JSON 以外的文字。`;

export const JSON_MODE_USER_SUFFIX_ARTICLE_CORE_WORDS_NORMALIZE =
  '\n\n请只输出一个 JSON 对象，且仅包含一个键 "nomalized"（数组）；数组元素每个为对象，仅含键 "original_text" 与 "new_text"（字符串）。不要使用 markdown 代码围栏。';

function effectiveNormalizeOutputBudget(
  forDeepseek: boolean,
  capOverride?: number,
): number {
  if (capOverride === undefined) {
    throw new Error("effectiveNormalizeOutputBudget: token cap is required");
  }
  const cap = capOverride;
  if (forDeepseek) {
    return Math.max(1, Math.min(cap, DEEPSEEK_CHAT_MAX_TOKENS_CAP));
  }
  return cap;
}

function uniqueCoreWordsOrdered(coreWords: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w0 of coreWords) {
    const w = w0.trim();
    if (!w || seen.has(w)) {
      continue;
    }
    seen.add(w);
    out.push(w);
  }
  return out;
}

function canonicalizeNewText(newText: string, originalText: string): string {
  let nt = newText.trim();
  if (!nt) {
    nt = originalText.trim();
  }
  if (!nt) {
    return nt;
  }
  const src = originalText.trim();
  const probe = nt || src;
  if (/(utc|gmt|[01]?\d:[0-5]\d)/i.test(probe)) {
    return "时间";
  }
  if (/(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日)/.test(probe)) {
    return "日期";
  }
  if (/\d{4}年/.test(probe)) {
    return "年份";
  }
  if (probe.includes("%") || probe.includes("％")) {
    return "比例";
  }
  if (/^[0-9]+([.,][0-9]+)?$/.test(probe)) {
    return "数值";
  }
  nt = nt
    .replace(
      /[`~!@#$%^&*()+=[\]{}\\|;:'",.<>/?·！￥…（）【】《》、，。；：‘’“”\-★☆]/g,
      "",
    )
    .replace(/\d+/g, "")
    .replaceAll("_", "")
    .replace(/\s+/g, " ")
    .trim();
  if (nt) {
    return nt;
  }
  const cleanedSrc = src
    .replace(/\d+/g, "")
    .replace(
      /[`~!@#$%^&*()+=[\]{}\\|;:'",.<>/?·！￥…（）【】《》、，。；：‘’“”\-★☆]/g,
      "",
    )
    .replaceAll("_", "")
    .replace(/\s+/g, " ")
    .trim();
  return cleanedSrc || src || newText;
}

function mergeLlmWithCoverage(
  llm: ArticleCoreWordsNomalizedData,
  orderedUniques: string[],
): ArticleCoreWordsNomalizedData {
  const byOrig = new Map<string, string>();
  for (const row of llm.nomalized) {
    const ot = row.original_text.trim();
    if (!ot) {
      continue;
    }
    const nt = canonicalizeNewText(row.new_text, ot);
    if (!byOrig.has(ot)) {
      byOrig.set(ot, nt);
    }
  }
  const rows = orderedUniques.map((w) => ({
    original_text: w,
    new_text: canonicalizeNewText(byOrig.get(w) ?? w, w),
  }));
  return ArticleCoreWordsNomalizedDataSchema.parse({ nomalized: rows });
}

async function articleCoreWordsNormalizeLlm(
  oc: OpenAI,
  payload: { core_words: string[] },
  resolvedModel: string,
  routing?: {
    deepseek: boolean;
    preferJsonObjectOnly?: boolean;
    tokenCap?: number;
  },
): Promise<ArticleCoreWordsNomalizedData> {
  const userBody = `以下为 core_words（JSON，已按首次出现顺序去重）。请输出 nomalized，规则见系统提示。\n${JSON.stringify(payload, null, 0)}`;
  const messagesParse = [
    {
      role: "system" as const,
      content: SYSTEM_PROMPT_ARTICLE_CORE_WORDS_NORMALIZE,
    },
    { role: "user" as const, content: userBody },
  ];
  const messagesJson = [
    {
      role: "system" as const,
      content: `${SYSTEM_PROMPT_ARTICLE_CORE_WORDS_NORMALIZE}\n\n你必须只输出一个合法 JSON 对象。`,
    },
    {
      role: "user" as const,
      content: userBody + JSON_MODE_USER_SUFFIX_ARTICLE_CORE_WORDS_NORMALIZE,
    },
  ];
  const deepseek = routing?.deepseek ?? isDeepseekCompatibleBaseUrl();
  const budget = effectiveNormalizeOutputBudget(deepseek, routing?.tokenCap);
  return runParseOrJson({
    client: oc,
    model: resolvedModel,
    messagesParse,
    messagesJson,
    schema: ArticleCoreWordsNomalizedDataSchema,
    responseName: "ArticleCoreWordsNomalizedData",
    ...(deepseek ? { maxTokens: budget } : { maxCompletionTokens: budget }),
    ...(routing?.preferJsonObjectOnly !== undefined
      ? { preferJsonObjectOnly: routing.preferJsonObjectOnly }
      : {}),
  });
}

export async function normalizeArticleCoreWordsSynonyms(
  data: ArticleCoreWordsData,
  opts: {
    config: MemokPipelineConfig;
    model?: string;
    client?: OpenAI;
  },
): Promise<ArticleCoreWordsNomalizedData> {
  const ordered = uniqueCoreWordsOrdered([...data.core_words]);
  if (ordered.length === 0) {
    return { nomalized: [] };
  }
  const payload = { core_words: ordered };
  const { config } = opts;
  const resolvedModel = (opts.model?.trim() || config.llmModel).trim();
  const client = opts.client ?? createOpenAIClient(config);
  const deepseek = isDeepseekCompatibleBaseUrlFromUrl(config.openaiBaseUrl);
  const tokenCap = Math.max(
    256,
    Math.min(config.coreWordsNormalizeMaxOutputTokens, 128_000),
  );
  const raw = await articleCoreWordsNormalizeLlm(
    client,
    payload,
    resolvedModel,
    {
      deepseek,
      preferJsonObjectOnly: preferJsonObjectOnlyFromConfig(config),
      tokenCap,
    },
  );
  return mergeLlmWithCoverage(raw, ordered);
}

export const _internalArticleCoreWordsNormalize = {
  uniqueCoreWordsOrdered,
  canonicalizeNewText,
  mergeLlmWithCoverage,
};
