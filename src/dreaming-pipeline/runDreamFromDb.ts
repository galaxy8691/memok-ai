import OpenAI from "openai";
import { generateDreamText } from "./generateDreamText.js";
import { sampleWordStrings, type SampleWordStringsOpts } from "./sampleWordStrings.js";

export type RunDreamFromDbOpts = SampleWordStringsOpts & {
  client?: OpenAI;
  model?: string;
  maxTokens?: number;
};

/**
 * 从数据库 `words` 表随机抽样至多若干词（默认 10），再调用 LLM 生成梦幻叙事（纯文本）。
 */
export async function runDreamFromDb(dbPath: string, opts?: RunDreamFromDbOpts): Promise<string> {
  const { client, model, maxTokens, ...sampleOpts } = opts ?? {};
  const keywords = sampleWordStrings(dbPath, sampleOpts);
  return generateDreamText(keywords, { client, model, maxTokens });
}
