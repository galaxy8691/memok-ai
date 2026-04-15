#!/usr/bin/env node
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { analyzeArticleCoreWords } from "./article-word-pipeline/v2/articleCoreWords.js";
import { normalizeArticleCoreWordsSynonyms } from "./article-word-pipeline/v2/articleCoreWordsNormalize.js";
import { analyzeArticleMemorySentences } from "./article-word-pipeline/v2/articleSentences.js";
import {
  combineArticleSentenceCoreV2,
  dumpArticleSentenceCoreCombineTupleV2Json,
} from "./article-word-pipeline/v2/articleSentenceCoreCombine.js";
import {
  ArticleCoreWordsDataSchema,
  ArticleCoreWordsNomalizedDataSchema,
  ArticleMemorySentencesDataSchema,
} from "./article-word-pipeline/v2/schemas.js";
import { articleWordPipelineV2 } from "./article-word-pipeline/v2/articleWordPipeline.js";
import { importAwpV2TupleFromPaths } from "./sqlite/awpV2Import.js";
import { extractMemorySentencesByWordSample } from "./read-memory-pipeline/extractMemorySentencesByWordSample.js";

function resolvePath(p: string): string {
  return resolve(process.cwd(), p);
}

function readUtf8(path: string): string {
  return readFileSync(resolvePath(path), "utf-8");
}

function printJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

function exitValidation(e: unknown, msg: string): never {
  if (e instanceof z.ZodError) {
    process.stderr.write(`${msg}: ${e.message}\n`);
  } else if (e instanceof Error) {
    process.stderr.write(`${msg}: ${e.message}\n`);
  } else {
    process.stderr.write(`${msg}\n`);
  }
  process.exit(1);
}

const program = new Command();
program
  .name("memok-ai")
  .description("memok v2 in Node/TypeScript")
  .version("1.0.0");

program
  .command("article-core-words")
  .argument("<article>", "文章文件路径")
  .action(async (articlePath: string) => {
    const text = readUtf8(articlePath);
    const out = await analyzeArticleCoreWords(text);
    printJson(out);
  });

program
  .command("article-core-words-normalize")
  .requiredOption("--from-json <path>", "core_words json 文件")
  .action(async (opts: { fromJson: string }) => {
    const raw = readUtf8(opts.fromJson);
    let data;
    try {
      data = ArticleCoreWordsDataSchema.parse(JSON.parse(raw));
    } catch (e) {
      exitValidation(e, "无法解析 ArticleCoreWordsData（须仅含 core_words 字符串数组）");
    }
    const out = await normalizeArticleCoreWordsSynonyms(data);
    printJson(out);
  });

program
  .command("article-sentences")
  .argument("<article>", "文章文件路径")
  .action(async (articlePath: string) => {
    const text = readUtf8(articlePath);
    const out = await analyzeArticleMemorySentences(text);
    printJson(out);
  });

program
  .command("article-sentence-core-combine")
  .requiredOption("--from-sentences-json <path>", "article-sentences JSON")
  .requiredOption("--from-normalized-json <path>", "article-core-words-normalize JSON")
  .action((opts: { fromSentencesJson: string; fromNormalizedJson: string }) => {
    let sentences;
    let normalized;
    try {
      sentences = ArticleMemorySentencesDataSchema.parse(JSON.parse(readUtf8(opts.fromSentencesJson)));
    } catch (e) {
      exitValidation(e, "无法解析 ArticleMemorySentencesData（须仅含 sentences: [{sentence}]）");
    }
    try {
      normalized = ArticleCoreWordsNomalizedDataSchema.parse(JSON.parse(readUtf8(opts.fromNormalizedJson)));
    } catch (e) {
      exitValidation(e, "无法解析 ArticleCoreWordsNomalizedData（须仅含 nomalized 数组）");
    }
    const [combined, normOut] = combineArticleSentenceCoreV2(sentences, normalized);
    process.stdout.write(`${dumpArticleSentenceCoreCombineTupleV2Json(combined, normOut)}\n`);
  });

program
  .command("article-word-pipeline")
  .argument("<article>", "文章文件路径")
  .action(async (articlePath: string) => {
    const text = readUtf8(articlePath);
    const [combined, normalized] = await articleWordPipelineV2(text);
    process.stdout.write(`${dumpArticleSentenceCoreCombineTupleV2Json(combined, normalized)}\n`);
  });

program
  .command("extract-memory-sentences")
  .description(
    "从 words 随机抽样→关联 sentences；输出单一 sentences：先短期全量，后非短期加权抽样",
  )
  .requiredOption("--db <path>", "sqlite 数据库路径")
  .option("--fraction <n>", "对 words 表的抽样比例（默认 0.2）")
  .option("--long-term-fraction <n>", "非短期句池抽样比例（默认与 --fraction 相同）")
  .action((opts: { db: string; fraction?: string; longTermFraction?: string }) => {
    try {
      const fraction =
        opts.fraction !== undefined && opts.fraction !== ""
          ? Number.parseFloat(opts.fraction)
          : 0.2;
      const longTermFraction =
        opts.longTermFraction !== undefined && opts.longTermFraction !== ""
          ? Number.parseFloat(opts.longTermFraction)
          : undefined;
      const out = extractMemorySentencesByWordSample(resolvePath(opts.db), {
        fraction: Number.isFinite(fraction) ? fraction : 0.2,
        longTermFraction:
          longTermFraction !== undefined && Number.isFinite(longTermFraction)
            ? longTermFraction
            : undefined,
      });
      printJson(out);
    } catch (e) {
      exitValidation(e, "extract-memory-sentences 失败");
    }
  });

program
  .command("import-awp-v2-tuple")
  .requiredOption("--from-json <path>", "article-word-pipeline tuple JSON")
  .requiredOption("--db <path>", "sqlite 数据库路径")
  .option("--as-of <YYYY-MM-DD>", "日期")
  .action((opts: { fromJson: string; db: string; asOf?: string }) => {
    try {
      importAwpV2TupleFromPaths(resolvePath(opts.fromJson), resolvePath(opts.db), {
        today: opts.asOf,
      });
    } catch (e) {
      exitValidation(e, "导入 awp v2 tuple 失败");
    }
  });

program.parseAsync(process.argv);
