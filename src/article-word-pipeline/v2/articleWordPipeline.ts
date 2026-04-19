import OpenAI from "openai";
import {
  buildPipelineContext,
  type MemokPipelineConfig,
  type PipelineLlmContext,
} from "../../config/memokPipelineConfig.js";
import {
  effectiveParallelLlmWorkers,
  llmMaxWorkers,
} from "../../llm/openaiCompat.js";
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
  opts?: { client?: OpenAI; ctx?: PipelineLlmContext },
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
      const core = await analyzeArticleCoreWords(text, { ctx: opts.ctx });
      const normalized = await normalizeArticleCoreWordsSynonyms(core, {
        ctx: opts.ctx,
      });
      const memorySentences = await analyzeArticleMemorySentences(text, {
        ctx: opts.ctx,
      });
      return combineArticleSentenceCoreV2(memorySentences, normalized);
    }
    const client = opts?.client ?? new OpenAI();
    const core = await analyzeArticleCoreWords(text, { client });
    const normalized = await normalizeArticleCoreWordsSynonyms(core, {
      client,
    });
    const memorySentences = await analyzeArticleMemorySentences(text, {
      client,
    });
    return combineArticleSentenceCoreV2(memorySentences, normalized);
  }

  if (opts?.ctx) {
    const branchCoreNormalize =
      async (): Promise<ArticleCoreWordsNomalizedData> => {
        const core = await analyzeArticleCoreWords(text, { ctx: opts.ctx });
        return normalizeArticleCoreWordsSynonyms(core, { ctx: opts.ctx });
      };
    const branchMemory = async () =>
      analyzeArticleMemorySentences(text, { ctx: opts.ctx });
    const [normalized, memorySentences] = await Promise.all([
      branchCoreNormalize(),
      branchMemory(),
    ]);
    return combineArticleSentenceCoreV2(memorySentences, normalized);
  }

  const branchCoreNormalize =
    async (): Promise<ArticleCoreWordsNomalizedData> => {
      const core = await analyzeArticleCoreWords(text);
      return normalizeArticleCoreWordsSynonyms(core);
    };
  const branchMemory = async () => analyzeArticleMemorySentences(text);

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
