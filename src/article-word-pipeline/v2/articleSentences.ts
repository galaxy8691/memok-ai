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
import { isEnglishDominantText } from "../../utils/sentenceTextLimits.js";
import {
  type ArticleMemorySentencesData,
  ArticleMemorySentencesDataSchema,
} from "./schemas.js";

const DEEPSEEK_CHAT_MAX_TOKENS_CAP = 8192;
const MAX_ARTICLE_MEMORY_SENTENCE_CHARS = 100;
const MAX_ARTICLE_MEMORY_SENTENCE_WORDS_EN = 40;

export const SYSTEM_PROMPT_ARTICLE_SENTENCES = `你是「记忆稿」编辑。用户会给你**一整篇文章**的正文（可能多段）。

任务：通读全文，输出多条**记忆简述**，要求：
1) **一事一句**：每条 \`\`sentence\`\` 尽量只对应文中的一个独立事实、步骤、论点或一块信息，不要把多件不相关的事挤在同一条里。
2) **数据优先**（勿用空话替代概括）：凡文中出现且可核对者，尽量写入对应条——**数据**与统计、**代码**与标识符/API 名、**算式**与公式、**专名**、**时间与日期**、**地点**、**人物与机构**、**事件经过**（因果、步骤、结果）。
3) **代码与算式**：若文中出现需逐字保留的代码块、多行程序或重要算式，请**单独**作为一条 \`\`sentence\`\`，**完整抄写**原文（可明显长于 100 字）；勿在一条里混写大段代码与无关叙述（代码一条、叙述另分条）。
4) **叙述性句子**：普通中文记忆句控制在约 **100 个汉字以内**（含标点）；英文为主的句子控制在约 **40 个英文词**以内（按词计）。
5) **禁止编造**：只根据原文可支持的内容写；原文没有的信息不要补。
6) **输出 JSON 形状（硬性）**：只输出一个 JSON 对象，**唯一**顶层键为 \`\`sentences\`\`，值为数组；数组中每个元素为对象，且**仅**含一个键 \`\`sentence\`\`（字符串）。不要其它键；不要 markdown 代码围栏；不要输出数组外的解释文字。`;

export const JSON_MODE_USER_SUFFIX_ARTICLE_SENTENCES =
  '\n\n请只输出一个 JSON 对象：唯一键 "sentences"（数组）；数组中每个元素为对象，且仅含键 "sentence"（字符串）。不要使用 markdown 代码围栏。';

function effectiveOutputBudget(
  forDeepseek: boolean,
  capOverride?: number,
): number {
  if (capOverride === undefined) {
    throw new Error("effectiveOutputBudget: token cap is required");
  }
  const cap = capOverride;
  if (forDeepseek) {
    return Math.max(1, Math.min(cap, DEEPSEEK_CHAT_MAX_TOKENS_CAP));
  }
  return cap;
}

function clampWords(s: string, maxWords: number): string {
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length <= maxWords) {
    return s;
  }
  return parts.slice(0, maxWords).join(" ");
}

function clampArticleMemorySentence(s: string): string {
  const t = s.trim();
  if (!t) {
    return t;
  }
  if (isEnglishDominantText(t)) {
    return clampWords(t, MAX_ARTICLE_MEMORY_SENTENCE_WORDS_EN);
  }
  if (t.length <= MAX_ARTICLE_MEMORY_SENTENCE_CHARS) {
    return t;
  }
  return t.slice(0, MAX_ARTICLE_MEMORY_SENTENCE_CHARS);
}

const CODE_LINE_START =
  /^\s*(def\b|class\b|import\b|from\b|#|\/\/|\/\*|\*\/|public\b|private\b|SELECT\b|INSERT\b|UPDATE\b|function\b)/im;

export function sentenceLooksLikeVerbatimTechnical(s: string): boolean {
  if (!s?.trim()) {
    return false;
  }
  if (s.includes("```")) {
    return true;
  }
  if (s.includes("\\frac") || s.includes("\\begin{") || s.includes("$$")) {
    return true;
  }
  const stripped = s.trim();
  if (!stripped.includes("\n")) {
    if (stripped.length > 120 && /^[\u0020-\u007e\s]+$/.test(stripped)) {
      if (
        /\b(def|class|import|return|function|const|let|var)\b/.test(stripped)
      ) {
        return true;
      }
    }
    return false;
  }
  const lines = stripped.split("\n").filter((ln) => ln.trim());
  if (lines.length < 2) {
    return false;
  }
  let hits = 0;
  for (const ln of lines.slice(0, 24)) {
    if (CODE_LINE_START.test(ln)) {
      hits += 1;
    }
  }
  if (hits >= 2) {
    return true;
  }
  const letters = (stripped.match(/[A-Za-z]/g) ?? []).length;
  const cjk = (stripped.match(/[\u4e00-\u9fff]/g) ?? []).length;
  if (cjk >= 8 && letters / Math.max(letters + cjk, 1) < 0.35) {
    return false;
  }
  const sym = (stripped.match(/[{}()[\]=<>;+\-*/\\|`~_^]/g) ?? []).length;
  if (
    letters >= 20 &&
    sym >= 12 &&
    sym / Math.max(stripped.length, 1) >= 0.06
  ) {
    return true;
  }
  return false;
}

function postProcessClamp(
  data: ArticleMemorySentencesData,
): ArticleMemorySentencesData {
  const out = [];
  for (const item of data.sentences) {
    const raw = item.sentence;
    if (!raw.trim()) {
      continue;
    }
    if (sentenceLooksLikeVerbatimTechnical(raw)) {
      out.push({ sentence: raw });
    } else {
      out.push({ sentence: clampArticleMemorySentence(raw) });
    }
  }
  return ArticleMemorySentencesDataSchema.parse({ sentences: out });
}

async function articleMemorySentencesLlm(
  oc: OpenAI,
  strippedArticle: string,
  resolvedModel: string,
  routing?: {
    deepseek: boolean;
    preferJsonObjectOnly?: boolean;
    tokenCap?: number;
  },
): Promise<ArticleMemorySentencesData> {
  const userBody = `--- 正文如下 ---\n\n${strippedArticle}`;
  const messagesParse = [
    { role: "system" as const, content: SYSTEM_PROMPT_ARTICLE_SENTENCES },
    { role: "user" as const, content: userBody },
  ];
  const messagesJson = [
    {
      role: "system" as const,
      content: `${SYSTEM_PROMPT_ARTICLE_SENTENCES}\n\n你必须只输出一个合法 JSON 对象。`,
    },
    {
      role: "user" as const,
      content: userBody + JSON_MODE_USER_SUFFIX_ARTICLE_SENTENCES,
    },
  ];
  const deepseek = routing?.deepseek ?? isDeepseekCompatibleBaseUrl();
  const budget = effectiveOutputBudget(deepseek, routing?.tokenCap);
  const raw = await runParseOrJson({
    client: oc,
    model: resolvedModel,
    messagesParse,
    messagesJson,
    schema: ArticleMemorySentencesDataSchema,
    responseName: "ArticleMemorySentencesData",
    ...(deepseek ? { maxTokens: budget } : { maxCompletionTokens: budget }),
    ...(routing?.preferJsonObjectOnly !== undefined
      ? { preferJsonObjectOnly: routing.preferJsonObjectOnly }
      : {}),
  });
  return postProcessClamp(raw);
}

export async function analyzeArticleMemorySentences(
  text: string,
  opts: {
    config: MemokPipelineConfig;
    model?: string;
    client?: OpenAI;
  },
): Promise<ArticleMemorySentencesData> {
  const stripped = text.trim();
  if (!stripped) {
    throw new Error("text must be non-empty after stripping whitespace");
  }
  const { config } = opts;
  const resolvedModel = (opts.model?.trim() || config.llmModel).trim();
  const client = opts.client ?? createOpenAIClient(config);
  const tokenCap = Math.max(
    512,
    Math.min(config.articleSentencesMaxOutputTokens, 128_000),
  );
  return articleMemorySentencesLlm(client, stripped, resolvedModel, {
    deepseek: isDeepseekCompatibleBaseUrlFromUrl(config.openaiBaseUrl),
    preferJsonObjectOnly: preferJsonObjectOnlyFromConfig(config),
    tokenCap,
  });
}

export const _internalArticleSentences = {
  clampArticleMemorySentence,
  sentenceLooksLikeVerbatimTechnical,
  postProcessClamp,
};
