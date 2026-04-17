import OpenAI from "openai";
import {
  isDeepseekCompatibleBaseUrl,
  loadProjectEnv,
} from "../../llm/openaiCompat.js";

const ENV_DREAMING_MODEL = "MEMOK_DREAMING_LLM_MODEL";
const ENV_MEMOK_LLM_MODEL = "MEMOK_LLM_MODEL";
const DEFAULT_MODEL = "gpt-4o-mini";
/** 与 SYSTEM_PROMPT 中「约 1000～3000 字」相称，避免长文被截断 */
const DEFAULT_MAX_OUTPUT = 8192;
const DEEPSEEK_CHAT_MAX_TOKENS_CAP = 8192;

function resolveDreamingModel(explicit?: string): string {
  if (explicit?.trim()) {
    return explicit.trim();
  }
  for (const key of [ENV_DREAMING_MODEL, ENV_MEMOK_LLM_MODEL]) {
    const v = (process.env[key] ?? "").trim();
    if (v) {
      return v;
    }
  }
  return DEFAULT_MODEL;
}

function effectiveMaxTokens(forDeepseek: boolean, explicit?: number): number {
  const cap = explicit ?? DEFAULT_MAX_OUTPUT;
  if (forDeepseek) {
    return Math.max(1, Math.min(cap, DEEPSEEK_CHAT_MAX_TOKENS_CAP));
  }
  return Math.max(256, Math.min(cap, 128_000));
}

export const SYSTEM_PROMPT_DREAM = `你是梦幻叙事作者。用户会给你一组**关键词**（JSON 数组字符串）。
任务：写一段**中文**故事，风格**光怪陆离、如梦似幻**，像一场荒诞又连贯的梦。
硬性要求：
1) 叙事中须**自然融入**下列**全部**关键词，不要简单罗列成清单；可微调语序或轻量修辞，但读者应能辨认出这些词或所指。
2) 不要输出任何解释、标题前缀或 markdown 代码围栏；**只输出正文**。
3) 篇幅适中（约 1000～2000 字为宜，可略浮动）。`;

/**
 * 根据关键词调用 LLM 生成一段梦幻叙事纯文本。
 */
export async function generateDreamText(
  keywords: string[],
  opts?: { client?: OpenAI; model?: string; maxTokens?: number },
): Promise<string> {
  loadProjectEnv();
  if (keywords.length === 0) {
    throw new Error("keywords must be non-empty");
  }
  const model = resolveDreamingModel(opts?.model);
  const client = opts?.client ?? new OpenAI();
  const deepseek = isDeepseekCompatibleBaseUrl();
  const maxTok = effectiveMaxTokens(deepseek, opts?.maxTokens);
  const userBody = `以下为关键词（JSON 数组），请按要求写一段梦幻叙事正文：\n${JSON.stringify(keywords)}`;
  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT_DREAM },
      { role: "user", content: userBody },
    ],
    ...(deepseek ? { max_tokens: maxTok } : { max_completion_tokens: maxTok }),
  });
  const raw = completion.choices[0]?.message?.content;
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("LLM returned empty dream text");
  }
  return raw.trim();
}
