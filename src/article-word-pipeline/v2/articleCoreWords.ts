import OpenAI from "openai";
import { loadProjectEnv, runParseOrJson } from "../../llm/openaiCompat.js";
import {
  type ArticleCoreWordsData,
  ArticleCoreWordsDataSchema,
} from "./schemas.js";

const ENV_V2_ARTICLE_CORE_WORDS = "MEMOK_V2_ARTICLE_CORE_WORDS_LLM_MODEL";
/** 全流水线共用的默认模型；未设各阶段专有变量时使用 */
const ENV_MEMOK_LLM_MODEL = "MEMOK_LLM_MODEL";
const ENV_ARTICLE_MODEL = "MEMOK_ARTICLE_LLM_MODEL";
const ENV_SENTENCE_CORE_MODEL = "MEMOK_SENTENCE_CORE_LLM_MODEL";
const ENV_SEGMENT_CORE_MODEL = "MEMOK_SEGMENT_CORE_LLM_MODEL";
const DEFAULT_MODEL = "gpt-4o-mini";

export const SYSTEM_PROMPT_ARTICLE_CORE_WORDS = `你是中文文本分析助手。用户会给你**一整篇文章**的正文（可能含多段、多句）。
请通读全文，抽取适合作为**长期记忆锚点**的**原子级**词条（每条应是**可单独检索的一个概念**，不是整段复述）。

**优先覆盖**（原文凡出现、且可拆为单条的，应尽量收录，与「大词」同等重要）：
- **专名**：天体名、作品/计划名、别称、学科术语、英语专名在文中的中文称呼等；
- **数据**：百分比、倍数、测量值、**数字+单位**（如年、日、小时、公里等，可单独成条）；
- **日子/年代/地质纪**：具体纪年、「约××亿年前」等可拆成短条；
- **人物/机构/国别**：国家、航天机构、科学家称谓（若原文点名）；
- **时间/周期**：公转、自转、季节、纪之间的先后等表述中的可检索短词；
- **地点与区位**：半球、两极、平原/高地、轨道位置等。

硬性规则（必须遵守）：
1) **一条数组元素 = 一个词或一个固定专名/一条数据**，不要把多个概念用顿号「、」或逗号拼在同一条里。
2) **禁止长句描述**：不要输出对文意的总结性长串；只抽硬锚点（上列类型 + 普通实体名词）。
3) 每条长度以 **2～8 个汉字**为主；含阿拉伯数字与单位的条目可到约 **14** 个字符。
4) 词组须能在原文中找到依据；去重；不要编造文中不存在的实体。
5) **总输出体量（硬要求）**：所有 \`\`core_words\`\` 条目的**字符数之和**必须接近用户消息中的 **字数区间下限～上限**（约全文 **20%**）。若只抽大概念会导致总长过短，**必须增加条目数**（多抽数据、地名、年代、专名等），直到接近目标区间；不得以「宁少勿滥」为由明显低于下限。
6) 只输出 JSON 对象且**仅含键** \`\`core_words\`\`（字符串数组）；不要 markdown 代码围栏；不要输出其它键。`;

export const JSON_MODE_USER_SUFFIX_ARTICLE_CORE_WORDS =
  '\n\n请只输出一个 JSON 对象，且仅包含一个键 "core_words"（字符串数组）；数组中每个字符串必须是**单个**锚点词/专名/数据条，**不得**用顿号连接多个词；须充分覆盖专名、数据与百分比、日期年代、人物机构、时间周期、地点区位；各条字符数相加须达到用户上文给出的字数区间（约全文 20%）。不得输出概括性长句。不要使用 markdown 代码围栏。';

function resolveModel(explicit?: string): string {
  if (explicit?.trim()) {
    return explicit.trim();
  }
  for (const key of [
    ENV_V2_ARTICLE_CORE_WORDS,
    ENV_MEMOK_LLM_MODEL,
    ENV_ARTICLE_MODEL,
    ENV_SENTENCE_CORE_MODEL,
    ENV_SEGMENT_CORE_MODEL,
  ]) {
    const v = (process.env[key] ?? "").trim();
    if (v) {
      return v;
    }
  }
  return DEFAULT_MODEL;
}

function splitCompoundCoreWords(words: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    const piece = w.trim();
    if (!piece) {
      continue;
    }
    const parts = piece.split(/[、，,]+/g);
    for (const p0 of parts) {
      const p = p0.trim();
      if (!p || seen.has(p)) {
        continue;
      }
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

function budgetUserNote(articleChars: number): string {
  if (articleChars <= 0) {
    return "全文为空，无需输出锚点。";
  }
  const target = Math.max(1, Math.round(0.2 * articleChars));
  const lo = Math.max(1, Math.round(0.18 * articleChars));
  const hi = Math.max(lo, Math.round(0.22 * articleChars));
  return `【字数预算】全文约 ${articleChars} 个字符；所有 core_words 字符串的**字符长度之和**须尽量落在 **${lo}～${hi}** 之间，并以 **${target}** 字左右为目标（约全文 20%）。**禁止**总长明显低于下限（例如不足下限的七成）：若会偏短，须在全文范围内**增加更多条目**，尤其补足专名、数据与百分比、日期与年代、人物或机构、时间周期、地点与区位等原子锚点；每条仍须短小、原子化，勿用长句凑字数。`;
}

async function articleCoreWordsLlmFields(
  oc: OpenAI,
  strippedArticle: string,
  resolvedModel: string,
): Promise<ArticleCoreWordsData> {
  const budget = budgetUserNote(strippedArticle.length);
  const userBody = `${budget}\n\n--- 正文如下 ---\n\n${strippedArticle}`;
  const messagesParse = [
    { role: "system" as const, content: SYSTEM_PROMPT_ARTICLE_CORE_WORDS },
    { role: "user" as const, content: userBody },
  ];
  const messagesJson = [
    {
      role: "system" as const,
      content: `${SYSTEM_PROMPT_ARTICLE_CORE_WORDS}\n\n你必须只输出一个合法 JSON 对象。`,
    },
    {
      role: "user" as const,
      content: userBody + JSON_MODE_USER_SUFFIX_ARTICLE_CORE_WORDS,
    },
  ];
  return runParseOrJson({
    client: oc,
    model: resolvedModel,
    messagesParse,
    messagesJson,
    schema: ArticleCoreWordsDataSchema,
    responseName: "ArticleCoreWordsLLMFields",
  });
}

export async function analyzeArticleCoreWords(
  text: string,
  opts?: { model?: string; client?: OpenAI },
): Promise<ArticleCoreWordsData> {
  loadProjectEnv();
  const stripped = text.trim();
  if (!stripped) {
    throw new Error("text must be non-empty after stripping whitespace");
  }
  const model = resolveModel(opts?.model);
  const client = opts?.client ?? new OpenAI();
  const fields = await articleCoreWordsLlmFields(client, stripped, model);
  const words = splitCompoundCoreWords([...fields.core_words]);
  return ArticleCoreWordsDataSchema.parse({ core_words: words });
}
