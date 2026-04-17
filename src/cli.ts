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
import { runDreamingPipelineFromDb } from "./dreaming-pipeline/runDreamingPipelineFromDb.js";
import { runPredreamDecayFromDb } from "./dreaming-pipeline/predream-pipeline/index.js";
import {
  runStoryWordSentenceBucketsFromDb,
  runStoryWordSentencePipelineFromDb,
} from "./dreaming-pipeline/story-word-sentence-pipeline/index.js";
import { extractMemorySentencesByWordSample } from "./read-memory-pipeline/extractMemorySentencesByWordSample.js";
import { hardenDbFile } from "./sqlite/hardenDb.js";

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

async function runStoryWordSentenceBucketsCli(opts: {
  db: string;
  maxWords?: string;
  fraction?: string;
}): Promise<void> {
  const rawMaxWords =
    opts.maxWords !== undefined && opts.maxWords !== ""
      ? Number.parseInt(opts.maxWords, 10)
      : 10;
  const maxWords = Number.isFinite(rawMaxWords) && rawMaxWords > 0 ? rawMaxWords : 10;
  const rawFraction =
    opts.fraction !== undefined && opts.fraction !== ""
      ? Number.parseFloat(opts.fraction)
      : 0.2;
  const fraction = Number.isFinite(rawFraction) && rawFraction > 0 ? rawFraction : 0.2;
  const out = await runStoryWordSentenceBucketsFromDb(resolvePath(opts.db), {
    maxWords,
    fraction,
  });
  printJson(out);
}

async function runStoryWordSentencePipelineCli(opts: {
  db: string;
  maxWords?: string;
  fraction?: string;
  minRuns?: string;
  maxRuns?: string;
}): Promise<void> {
  const rawMaxWords =
    opts.maxWords !== undefined && opts.maxWords !== ""
      ? Number.parseInt(opts.maxWords, 10)
      : 10;
  const maxWords = Number.isFinite(rawMaxWords) && rawMaxWords > 0 ? rawMaxWords : 10;
  const rawFraction =
    opts.fraction !== undefined && opts.fraction !== ""
      ? Number.parseFloat(opts.fraction)
      : 0.2;
  const fraction = Number.isFinite(rawFraction) && rawFraction > 0 ? rawFraction : 0.2;
  const rawMinRuns =
    opts.minRuns !== undefined && opts.minRuns !== ""
      ? Number.parseInt(opts.minRuns, 10)
      : undefined;
  const minRuns =
    rawMinRuns !== undefined && Number.isFinite(rawMinRuns) && rawMinRuns > 0 ? rawMinRuns : undefined;
  const rawMaxRuns =
    opts.maxRuns !== undefined && opts.maxRuns !== ""
      ? Number.parseInt(opts.maxRuns, 10)
      : undefined;
  const maxRuns =
    rawMaxRuns !== undefined && Number.isFinite(rawMaxRuns) && rawMaxRuns > 0 ? rawMaxRuns : undefined;
  const out = await runStoryWordSentencePipelineFromDb(resolvePath(opts.db), {
    maxWords,
    fraction,
    minRuns,
    maxRuns,
  });
  process.stderr.write(
    `[memok-ai] story-word-sentence-pipeline: plannedRuns=${out.plannedRuns} (range ${out.minRuns}–${out.maxRuns})\n`,
  );
  printJson(out);
}

async function runDreamingPipelineCli(opts: {
  db: string;
  maxWords?: string;
  fraction?: string;
  minRuns?: string;
  maxRuns?: string;
}): Promise<void> {
  const rawMaxWords =
    opts.maxWords !== undefined && opts.maxWords !== ""
      ? Number.parseInt(opts.maxWords, 10)
      : 10;
  const maxWords = Number.isFinite(rawMaxWords) && rawMaxWords > 0 ? rawMaxWords : 10;
  const rawFraction =
    opts.fraction !== undefined && opts.fraction !== ""
      ? Number.parseFloat(opts.fraction)
      : 0.2;
  const fraction = Number.isFinite(rawFraction) && rawFraction > 0 ? rawFraction : 0.2;
  const rawMinRuns =
    opts.minRuns !== undefined && opts.minRuns !== ""
      ? Number.parseInt(opts.minRuns, 10)
      : undefined;
  const minRuns =
    rawMinRuns !== undefined && Number.isFinite(rawMinRuns) && rawMinRuns > 0 ? rawMinRuns : undefined;
  const rawMaxRuns =
    opts.maxRuns !== undefined && opts.maxRuns !== ""
      ? Number.parseInt(opts.maxRuns, 10)
      : undefined;
  const maxRuns =
    rawMaxRuns !== undefined && Number.isFinite(rawMaxRuns) && rawMaxRuns > 0 ? rawMaxRuns : undefined;
  const out = await runDreamingPipelineFromDb(resolvePath(opts.db), {
    maxWords,
    fraction,
    minRuns,
    maxRuns,
  });
  process.stderr.write(
    `[memok-ai] dreaming-pipeline: predream done; storyWordSentencePipeline plannedRuns=${out.storyWordSentencePipeline.plannedRuns} (${out.storyWordSentencePipeline.minRuns}–${out.storyWordSentencePipeline.maxRuns})\n`,
  );
  printJson(out);
}

program
  .command("dreaming-pipeline")
  .description(
    "先 predream-decay（duration 衰减与短期句清理），再 story-word-sentence-pipeline；stdout 为合并 JSON（predream + storyWordSentencePipeline）",
  )
  .requiredOption("--db <path>", "sqlite 数据库路径")
  .option("--max-words <n>", "story 阶段从 words 表最多抽几个词（默认 10）")
  .option("--fraction <n>", "句子与 normal_words 相关性共用抽样比例（默认 0.2）")
  .option("--min-runs <n>", "story-word-sentence-pipeline 随机轮数下限（含），默认 3")
  .option("--max-runs <n>", "story-word-sentence-pipeline 随机轮数上限（含），默认 5")
  .action(async (opts: { db: string; maxWords?: string; fraction?: string; minRuns?: string; maxRuns?: string }) => {
    try {
      await runDreamingPipelineCli(opts);
    } catch (e) {
      exitValidation(e, "dreaming-pipeline 失败");
    }
  });

program
  .command("predream-decay")
  .description(
    "predream：全表 sentences.duration 减 1；短期且 duration<=0 时 weight>=7 转长期，weight<7 删句；stdout JSON 报告",
  )
  .requiredOption("--db <path>", "sqlite 数据库路径")
  .action((opts: { db: string }) => {
    try {
      const out = runPredreamDecayFromDb(resolvePath(opts.db));
      printJson(out);
    } catch (e) {
      exitValidation(e, "predream-decay 失败");
    }
  });

program
  .command("story-word-sentence-buckets")
  .description(
    "完整 dreaming：抽词+故事+句/词评分分桶+双 link 回写+删孤立 normal_words+孤儿句合并删；stdout JSON 必含 orphanSentenceMerge 等全套字段",
  )
  .requiredOption("--db <path>", "sqlite 数据库路径")
  .option("--max-words <n>", "生成故事时从 words 表最多抽几个词（默认 10）")
  .option("--fraction <n>", "句子与 normal_words 相关性共用抽样比例（默认 0.2）")
  .action(async (opts: { db: string; maxWords?: string; fraction?: string }) => {
    try {
      await runStoryWordSentenceBucketsCli(opts);
    } catch (e) {
      exitValidation(e, "story-word-sentence-buckets 失败");
    }
  });

program
  .command("story-word-sentence-pipeline")
  .description(
    "在同一 DB 上顺序执行多轮完整 story-word-sentence-buckets；轮数在 --min-runs～--max-runs 间随机（默认 3–5）；stdout 仅输出多轮汇总 JSON",
  )
  .requiredOption("--db <path>", "sqlite 数据库路径")
  .option("--max-words <n>", "每轮生成故事时从 words 表最多抽几个词（默认 10）")
  .option("--fraction <n>", "每轮句子与 normal_words 相关性共用抽样比例（默认 0.2）")
  .option("--min-runs <n>", "随机轮数下限（含），默认 3")
  .option("--max-runs <n>", "随机轮数上限（含），默认 5")
  .action(
    async (opts: { db: string; maxWords?: string; fraction?: string; minRuns?: string; maxRuns?: string }) => {
      try {
        await runStoryWordSentencePipelineCli(opts);
      } catch (e) {
        exitValidation(e, "story-word-sentence-pipeline 失败");
      }
    },
  );

program
  .command("harden-db")
  .description("清理无效/重复 link，并补齐关系表索引与唯一约束")
  .requiredOption("--db <path>", "sqlite 数据库路径")
  .action((opts: { db: string }) => {
    try {
      hardenDbFile(resolvePath(opts.db));
      process.stdout.write("ok\n");
    } catch (e) {
      exitValidation(e, "harden-db 失败");
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
