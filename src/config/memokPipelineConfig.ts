import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";
import OpenAI from "openai";

function findProjectRoot(startDir: string): string {
  let current = startDir;
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(current, "package.json");
    if (existsSync(candidate)) {
      return current;
    }
    const next = dirname(current);
    if (next === current) {
      break;
    }
    current = next;
  }
  return startDir;
}

const CONFIG_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = findProjectRoot(join(CONFIG_DIR, "..", ".."));

/** 将仓库根 `.env` 合并进 `process.env`（不覆盖已有变量）；仅供本模块从 env 组装配置时使用。 */
function mergeProjectDotenv(): void {
  dotenvConfig({ path: join(PROJECT_ROOT, ".env"), override: false });
}

const DEFAULT_LLM_MODEL = "gpt-4o-mini";
const DEFAULT_ARTICLE_SENTENCES_MAX_OUTPUT = 8192;
const DEFAULT_CORE_WORDS_NORMALIZE_MAX_OUTPUT = 32768;
const DEFAULT_SENTENCE_MERGE_MAX_COMPLETION = 2048;
const MAX_LLM_WORKERS_CAP = 64;

/**
 * 显式流水线运行时配置（替代在各模块内读 `process.env`）。
 * 宿主（Nest / OpenClaw / CLI）在进程入口组装后传入 `ctx`。
 */
export type MemokPipelineConfig = {
  /** SQLite 路径；`memokPipelineConfigFromProcessEnv` 未设 `MEMOK_DB_PATH` 时默认为 `./memok.sqlite` */
  dbPath: string;
  openaiApiKey: string;
  openaiBaseUrl?: string;
  /** 对应原 `MEMOK_LLM_MODEL` 及各阶段未单独覆盖时的默认模型 */
  llmModel: string;
  /** 对应 `MEMOK_LLM_MAX_WORKERS`（<=1 表示串行） */
  llmMaxWorkers: number;
  /** `MEMOK_V2_ARTICLE_SENTENCES_MAX_OUTPUT_TOKENS` */
  articleSentencesMaxOutputTokens: number;
  /** `MEMOK_CORE_WORDS_NORMALIZE_MAX_OUTPUT_TOKENS` */
  coreWordsNormalizeMaxOutputTokens: number;
  /** 句子合并 LLM 输出预算（原 merge 内部默认 2048） */
  sentenceMergeMaxCompletionTokens: number;
  /** 对应 `MEMOK_SKIP_LLM_STRUCTURED_PARSE` */
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

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const t = (raw ?? "").trim();
  if (!t) {
    return fallback;
  }
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseLlmMaxWorkersEnv(raw: string | undefined): number {
  const t = (raw ?? "").trim();
  if (!t) {
    return 1;
  }
  const n = Number.parseInt(t, 10);
  if (!Number.isFinite(n) || n <= 1) {
    return 1;
  }
  return Math.min(n, MAX_LLM_WORKERS_CAP);
}

function parseBoolEnv(raw: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((raw ?? "").trim().toLowerCase());
}

/**
 * 先合并仓库根 `.env`（`override: false`），再从 `process.env` 构造 {@link MemokPipelineConfig}。
 * `dbPath`：`MEMOK_DB_PATH`（trim 后非空则用之），否则为 `./memok.sqlite`。
 * @throws 若缺少 `OPENAI_API_KEY`
 */
export function memokPipelineConfigFromProcessEnv(): MemokPipelineConfig {
  mergeProjectDotenv();
  const openaiApiKey = (process.env.OPENAI_API_KEY ?? "").trim();
  if (!openaiApiKey) {
    throw new Error(
      "OPENAI_API_KEY is required (set in environment or project root .env)",
    );
  }
  const dbPath = (process.env.MEMOK_DB_PATH ?? "").trim() || "./memok.sqlite";
  const llmModel =
    (process.env.MEMOK_LLM_MODEL ?? "").trim() || DEFAULT_LLM_MODEL;
  return {
    dbPath,
    openaiApiKey,
    openaiBaseUrl: (process.env.OPENAI_BASE_URL ?? "").trim() || undefined,
    llmModel,
    llmMaxWorkers: parseLlmMaxWorkersEnv(process.env.MEMOK_LLM_MAX_WORKERS),
    articleSentencesMaxOutputTokens: Math.max(
      512,
      Math.min(
        parsePositiveInt(
          process.env.MEMOK_V2_ARTICLE_SENTENCES_MAX_OUTPUT_TOKENS,
          DEFAULT_ARTICLE_SENTENCES_MAX_OUTPUT,
        ),
        128_000,
      ),
    ),
    coreWordsNormalizeMaxOutputTokens: Math.max(
      256,
      Math.min(
        parsePositiveInt(
          process.env.MEMOK_CORE_WORDS_NORMALIZE_MAX_OUTPUT_TOKENS,
          DEFAULT_CORE_WORDS_NORMALIZE_MAX_OUTPUT,
        ),
        128_000,
      ),
    ),
    sentenceMergeMaxCompletionTokens: Math.max(
      256,
      Math.min(
        parsePositiveInt(
          process.env.MEMOK_SENTENCE_MERGE_MAX_COMPLETION_TOKENS,
          DEFAULT_SENTENCE_MERGE_MAX_COMPLETION,
        ),
        128_000,
      ),
    ),
    skipLlmStructuredParse: parseBoolEnv(
      process.env.MEMOK_SKIP_LLM_STRUCTURED_PARSE,
    ),
  };
}
