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
  /**
   * `importAwpV2Tuple` / `articleWordPipeline` 新插入 `sentences` 行的初始 `weight`；缺省为 **1**。
   */
  articleWordImportInitialWeight?: number;
  /**
   * 同上路径新插入行的初始 `duration`；缺省为 **7**。
   */
  articleWordImportInitialDuration?: number;
  /**
   * `predream`（`runPredreamDecayFromDb`）中：短期句当 `weight >=` 该值时升格为长期（`is_short_term = 0`）；
   * 低于该值且 `duration` 耗尽则删除。缺省为 **7**（与历史硬编码一致）。
   */
  dreamShortTermToLongTermWeightThreshold?: number;
  /**
   * 相关性评分（sentence / normal_word）LLM 调用失败时的最大重试次数；
   * 缺省为 **5**，上限 **32**。
   */
  relevanceScoreMaxLlmAttempts?: number;
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
