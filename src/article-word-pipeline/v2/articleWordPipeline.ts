import OpenAI from "openai";
import {
  effectiveParallelLlmWorkers,
  llmMaxWorkers,
} from "../../llm/openaiCompat.js";
import {
  buildPipelineContext,
  type MemokPipelineConfig,
  type PipelineLlmContext,
} from "../../memokPipeline.js";
import { importAwpV2Tuple } from "../../sqlite/awpV2Import.js";
import { openSqlite } from "../../sqlite/openSqlite.js";
import { analyzeArticleCoreWords } from "./articleCoreWords.js";
import { normalizeArticleCoreWordsSynonyms } from "./articleCoreWordsNormalize.js";
import { combineArticleSentenceCoreV2 } from "./articleSentenceCoreCombine.js";
import { analyzeArticleMemorySentences } from "./articleSentences.js";
import type {
  ArticleCoreWordsNomalizedData,
  ArticleSentenceCoreCombinedData,
} from "./schemas.js";

export async function articleWordPipelineV2(
  text: string,
  opts?: {
    client?: OpenAI;
    ctx?: PipelineLlmContext;
    /** 无 `ctx` 时 LLM 阶段必填（与 `client` 等并用） */
    config?: MemokPipelineConfig;
  },
): Promise<[ArticleSentenceCoreCombinedData, ArticleCoreWordsNomalizedData]> {
  const stripped = text.trim();
  if (!stripped) {
    throw new Error("text must be non-empty after stripping whitespace");
  }

  const maxParallel = opts?.ctx
    ? effectiveParallelLlmWorkers(opts.ctx.config.llmMaxWorkers)
    : llmMaxWorkers();

  if (opts?.ctx?.client || opts?.client || maxParallel <= 1) {
    if (opts?.ctx) {
      const core = await analyzeArticleCoreWords(text, {
        config: opts.ctx.config,
        client: opts.ctx.client,
      });
      const normalized = await normalizeArticleCoreWordsSynonyms(core, {
        config: opts.ctx.config,
        client: opts.ctx.client,
      });
      const memorySentences = await analyzeArticleMemorySentences(text, {
        config: opts.ctx.config,
        client: opts.ctx.client,
      });
      return combineArticleSentenceCoreV2(memorySentences, normalized);
    }
    if (!opts?.config) {
      throw new Error(
        "articleWordPipelineV2: without ctx, pass config (MemokPipelineConfig)",
      );
    }
    const cfg = opts.config;
    const client = opts?.client ?? new OpenAI();
    const core = await analyzeArticleCoreWords(text, {
      config: cfg,
      client,
    });
    const normalized = await normalizeArticleCoreWordsSynonyms(core, {
      config: cfg,
      client,
    });
    const memorySentences = await analyzeArticleMemorySentences(text, {
      config: cfg,
      client,
    });
    return combineArticleSentenceCoreV2(memorySentences, normalized);
  }

  if (opts?.ctx) {
    const ctx = opts.ctx;
    const branchCoreNormalize =
      async (): Promise<ArticleCoreWordsNomalizedData> => {
        const core = await analyzeArticleCoreWords(text, {
          config: ctx.config,
          client: ctx.client,
        });
        return normalizeArticleCoreWordsSynonyms(core, {
          config: ctx.config,
          client: ctx.client,
        });
      };
    const branchMemory = async () =>
      analyzeArticleMemorySentences(text, {
        config: ctx.config,
        client: ctx.client,
      });
    const [normalized, memorySentences] = await Promise.all([
      branchCoreNormalize(),
      branchMemory(),
    ]);
    return combineArticleSentenceCoreV2(memorySentences, normalized);
  }

  if (!opts?.config) {
    throw new Error(
      "articleWordPipelineV2: without ctx, pass config (MemokPipelineConfig)",
    );
  }
  const cfgParallel = opts.config;
  const branchCoreNormalize =
    async (): Promise<ArticleCoreWordsNomalizedData> => {
      const core = await analyzeArticleCoreWords(text, {
        config: cfgParallel,
      });
      return normalizeArticleCoreWordsSynonyms(core, {
        config: cfgParallel,
      });
    };
  const branchMemory = async () =>
    analyzeArticleMemorySentences(text, {
      config: cfgParallel,
    });

  const [normalized, memorySentences] = await Promise.all([
    branchCoreNormalize(),
    branchMemory(),
  ]);
  return combineArticleSentenceCoreV2(memorySentences, normalized);
}

export type ArticleWordPipelineSaveDbOptions = MemokPipelineConfig & {
  today?: string;
};

/**
 * 输入任意文本，走 article-word-pipeline(v2) 后直接写入 SQLite。
 * 不落地任何中间 JSON 文件。
 */
export async function articleWordPipeline(
  text: string,
  options: ArticleWordPipelineSaveDbOptions,
): Promise<void> {
  const stripped = text.trim();
  if (!stripped) {
    throw new Error("text must be non-empty after stripping whitespace");
  }

  const ctx = buildPipelineContext(options);
  const [combined, normalized] = await articleWordPipelineV2(stripped, {
    ctx,
  });
  const db = openSqlite(options.dbPath);
  try {
    const tx = db.transaction(() => {
      importAwpV2Tuple(db, combined, normalized, { today: options.today });
    });
    tx();
  } finally {
    db.close();
  }
}
