import OpenAI from "openai";

/**
 * 显式流水线运行时配置；宿主在进程入口组装后传入 `ctx` 或整对象 API。
 */
export type MemokPipelineConfig = {
  /** SQLite 路径，由宿主显式传入 */
  dbPath: string;
  openaiApiKey: string;
  openaiBaseUrl?: string;
  /** 默认模型及各阶段未单独覆盖时的回退 */
  llmModel: string;
  /** `<=1` 表示串行 */
  llmMaxWorkers: number;
  articleSentencesMaxOutputTokens: number;
  coreWordsNormalizeMaxOutputTokens: number;
  sentenceMergeMaxCompletionTokens: number;
  skipLlmStructuredParse?: boolean;
};

export type PipelineLlmContext = {
  client: OpenAI;
  config: MemokPipelineConfig;
};

export function createOpenAIClient(
  cfg: Pick<MemokPipelineConfig, "openaiApiKey" | "openaiBaseUrl">,
): OpenAI {
  const base = cfg.openaiBaseUrl?.trim();
  return new OpenAI({
    apiKey: cfg.openaiApiKey,
    ...(base ? { baseURL: base } : {}),
  });
}

export function buildPipelineContext(
  config: MemokPipelineConfig,
): PipelineLlmContext {
  return {
    client: createOpenAIClient(config),
    config,
  };
}
