#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { z } from "zod";
import { analyzeArticleCoreWords } from "./article-word-pipeline/v2/articleCoreWords.js";
import { normalizeArticleCoreWordsSynonyms } from "./article-word-pipeline/v2/articleCoreWordsNormalize.js";
import {
  combineArticleSentenceCoreV2,
  dumpArticleSentenceCoreCombineTupleV2Json,
} from "./article-word-pipeline/v2/articleSentenceCoreCombine.js";
import { analyzeArticleMemorySentences } from "./article-word-pipeline/v2/articleSentences.js";
import { articleWordPipelineV2 } from "./article-word-pipeline/v2/articleWordPipeline.js";
import {
  ArticleCoreWordsDataSchema,
  ArticleCoreWordsNomalizedDataSchema,
  ArticleMemorySentencesDataSchema,
} from "./article-word-pipeline/v2/schemas.js";
import { runPredreamDecayFromDb } from "./dreaming-pipeline/predream-pipeline/index.js";
import { runDreamingPipelineFromDb } from "./dreaming-pipeline/runDreamingPipelineFromDb.js";
import {
  runStoryWordSentenceBucketsFromDb,
  runStoryWordSentencePipelineFromDb,
} from "./dreaming-pipeline/story-word-sentence-pipeline/index.js";
import { extractMemorySentencesByWordSample } from "./read-memory-pipeline/extractMemorySentencesByWordSample.js";
import { importAwpV2TupleFromPaths } from "./sqlite/awpV2Import.js";
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
  .argument("<article>", "Path to article text file")
  .action(async (articlePath: string) => {
    const text = readUtf8(articlePath);
    const out = await analyzeArticleCoreWords(text);
    printJson(out);
  });

program
  .command("article-core-words-normalize")
  .requiredOption("--from-json <path>", "Path to core_words JSON file")
  .action(async (opts: { fromJson: string }) => {
    const raw = readUtf8(opts.fromJson);
    let data: z.infer<typeof ArticleCoreWordsDataSchema>;
    try {
      data = ArticleCoreWordsDataSchema.parse(JSON.parse(raw));
    } catch (e) {
      exitValidation(
        e,
        "Failed to parse ArticleCoreWordsData (expected core_words string array)",
      );
    }
    const out = await normalizeArticleCoreWordsSynonyms(data);
    printJson(out);
  });

program
  .command("article-sentences")
  .argument("<article>", "Path to article text file")
  .action(async (articlePath: string) => {
    const text = readUtf8(articlePath);
    const out = await analyzeArticleMemorySentences(text);
    printJson(out);
  });

program
  .command("article-sentence-core-combine")
  .requiredOption("--from-sentences-json <path>", "article-sentences JSON path")
  .requiredOption(
    "--from-normalized-json <path>",
    "article-core-words-normalize JSON path",
  )
  .action((opts: { fromSentencesJson: string; fromNormalizedJson: string }) => {
    let sentences: z.infer<typeof ArticleMemorySentencesDataSchema>;
    let normalized: z.infer<typeof ArticleCoreWordsNomalizedDataSchema>;
    try {
      sentences = ArticleMemorySentencesDataSchema.parse(
        JSON.parse(readUtf8(opts.fromSentencesJson)),
      );
    } catch (e) {
      exitValidation(
        e,
        "Failed to parse ArticleMemorySentencesData (expected sentences: [{sentence}])",
      );
    }
    try {
      normalized = ArticleCoreWordsNomalizedDataSchema.parse(
        JSON.parse(readUtf8(opts.fromNormalizedJson)),
      );
    } catch (e) {
      exitValidation(
        e,
        "Failed to parse ArticleCoreWordsNomalizedData (expected nomalized array)",
      );
    }
    const [combined, normOut] = combineArticleSentenceCoreV2(
      sentences,
      normalized,
    );
    process.stdout.write(
      `${dumpArticleSentenceCoreCombineTupleV2Json(combined, normOut)}\n`,
    );
  });

program
  .command("article-word-pipeline")
  .argument("<article>", "Path to article text file")
  .action(async (articlePath: string) => {
    const text = readUtf8(articlePath);
    const [combined, normalized] = await articleWordPipelineV2(text);
    process.stdout.write(
      `${dumpArticleSentenceCoreCombineTupleV2Json(combined, normalized)}\n`,
    );
  });

program
  .command("extract-memory-sentences")
  .description(
    "Sample words → linked sentences; output sentences JSON (short-term pool in full, then weighted long-term sample)",
  )
  .requiredOption("--db <path>", "SQLite database path")
  .option("--fraction <n>", "Fraction of words table to sample (default 0.2)")
  .option(
    "--long-term-fraction <n>",
    "Fraction for non-short-term sentence pool (default: same as --fraction)",
  )
  .action(
    (opts: { db: string; fraction?: string; longTermFraction?: string }) => {
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
        exitValidation(e, "extract-memory-sentences failed");
      }
    },
  );

async function runStoryWordSentenceBucketsCli(opts: {
  db: string;
  maxWords?: string;
  fraction?: string;
}): Promise<void> {
  const rawMaxWords =
    opts.maxWords !== undefined && opts.maxWords !== ""
      ? Number.parseInt(opts.maxWords, 10)
      : 10;
  const maxWords =
    Number.isFinite(rawMaxWords) && rawMaxWords > 0 ? rawMaxWords : 10;
  const rawFraction =
    opts.fraction !== undefined && opts.fraction !== ""
      ? Number.parseFloat(opts.fraction)
      : 0.2;
  const fraction =
    Number.isFinite(rawFraction) && rawFraction > 0 ? rawFraction : 0.2;
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
  const maxWords =
    Number.isFinite(rawMaxWords) && rawMaxWords > 0 ? rawMaxWords : 10;
  const rawFraction =
    opts.fraction !== undefined && opts.fraction !== ""
      ? Number.parseFloat(opts.fraction)
      : 0.2;
  const fraction =
    Number.isFinite(rawFraction) && rawFraction > 0 ? rawFraction : 0.2;
  const rawMinRuns =
    opts.minRuns !== undefined && opts.minRuns !== ""
      ? Number.parseInt(opts.minRuns, 10)
      : undefined;
  const minRuns =
    rawMinRuns !== undefined && Number.isFinite(rawMinRuns) && rawMinRuns > 0
      ? rawMinRuns
      : undefined;
  const rawMaxRuns =
    opts.maxRuns !== undefined && opts.maxRuns !== ""
      ? Number.parseInt(opts.maxRuns, 10)
      : undefined;
  const maxRuns =
    rawMaxRuns !== undefined && Number.isFinite(rawMaxRuns) && rawMaxRuns > 0
      ? rawMaxRuns
      : undefined;
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
  const maxWords =
    Number.isFinite(rawMaxWords) && rawMaxWords > 0 ? rawMaxWords : 10;
  const rawFraction =
    opts.fraction !== undefined && opts.fraction !== ""
      ? Number.parseFloat(opts.fraction)
      : 0.2;
  const fraction =
    Number.isFinite(rawFraction) && rawFraction > 0 ? rawFraction : 0.2;
  const rawMinRuns =
    opts.minRuns !== undefined && opts.minRuns !== ""
      ? Number.parseInt(opts.minRuns, 10)
      : undefined;
  const minRuns =
    rawMinRuns !== undefined && Number.isFinite(rawMinRuns) && rawMinRuns > 0
      ? rawMinRuns
      : undefined;
  const rawMaxRuns =
    opts.maxRuns !== undefined && opts.maxRuns !== ""
      ? Number.parseInt(opts.maxRuns, 10)
      : undefined;
  const maxRuns =
    rawMaxRuns !== undefined && Number.isFinite(rawMaxRuns) && rawMaxRuns > 0
      ? rawMaxRuns
      : undefined;
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
    "Run predream-decay (duration decay + short-term cleanup), then story-word-sentence-pipeline; stdout is merged JSON",
  )
  .requiredOption("--db <path>", "SQLite database path")
  .option(
    "--max-words <n>",
    "Max words to sample from words table per story stage (default 10)",
  )
  .option(
    "--fraction <n>",
    "Sampling fraction for sentence vs normal_words relevance (default 0.2)",
  )
  .option(
    "--min-runs <n>",
    "Minimum random pipeline runs for story-word-sentence (inclusive, default 3)",
  )
  .option(
    "--max-runs <n>",
    "Maximum random pipeline runs for story-word-sentence (inclusive, default 5)",
  )
  .action(
    async (opts: {
      db: string;
      maxWords?: string;
      fraction?: string;
      minRuns?: string;
      maxRuns?: string;
    }) => {
      try {
        await runDreamingPipelineCli(opts);
      } catch (e) {
        exitValidation(e, "dreaming-pipeline failed");
      }
    },
  );

program
  .command("predream-decay")
  .description(
    "Predream: decrement sentences.duration globally; short-term rows with duration<=0 become long-term if weight>=7 else deleted; stdout JSON report",
  )
  .requiredOption("--db <path>", "SQLite database path")
  .action((opts: { db: string }) => {
    try {
      const out = runPredreamDecayFromDb(resolvePath(opts.db));
      printJson(out);
    } catch (e) {
      exitValidation(e, "predream-decay failed");
    }
  });

program
  .command("story-word-sentence-buckets")
  .description(
    "Full dreaming bucket pass: sample words, story, score buckets, dual link writes, prune orphan normal_words, merge orphan sentences; stdout JSON includes orphanSentenceMerge",
  )
  .requiredOption("--db <path>", "SQLite database path")
  .option(
    "--max-words <n>",
    "Max words from words table when generating story (default 10)",
  )
  .option(
    "--fraction <n>",
    "Sampling fraction for sentence vs normal_words relevance (default 0.2)",
  )
  .action(
    async (opts: { db: string; maxWords?: string; fraction?: string }) => {
      try {
        await runStoryWordSentenceBucketsCli(opts);
      } catch (e) {
        exitValidation(e, "story-word-sentence-buckets failed");
      }
    },
  );

program
  .command("story-word-sentence-pipeline")
  .description(
    "Run multiple full story-word-sentence-buckets passes in sequence; run count random between --min-runs and --max-runs (default 3–5); stdout is aggregate JSON only",
  )
  .requiredOption("--db <path>", "SQLite database path")
  .option(
    "--max-words <n>",
    "Max words from words table per story round (default 10)",
  )
  .option(
    "--fraction <n>",
    "Per-round sampling fraction for sentence vs normal_words relevance (default 0.2)",
  )
  .option(
    "--min-runs <n>",
    "Random run count lower bound (inclusive, default 3)",
  )
  .option(
    "--max-runs <n>",
    "Random run count upper bound (inclusive, default 5)",
  )
  .action(
    async (opts: {
      db: string;
      maxWords?: string;
      fraction?: string;
      minRuns?: string;
      maxRuns?: string;
    }) => {
      try {
        await runStoryWordSentencePipelineCli(opts);
      } catch (e) {
        exitValidation(e, "story-word-sentence-pipeline failed");
      }
    },
  );

program
  .command("harden-db")
  .description(
    "Remove invalid/duplicate links and ensure relationship indexes and unique constraints",
  )
  .requiredOption("--db <path>", "SQLite database path")
  .action((opts: { db: string }) => {
    try {
      hardenDbFile(resolvePath(opts.db));
      process.stdout.write("ok\n");
    } catch (e) {
      exitValidation(e, "harden-db failed");
    }
  });

program
  .command("import-awp-v2-tuple")
  .requiredOption("--from-json <path>", "article-word-pipeline tuple JSON")
  .requiredOption("--db <path>", "SQLite database path")
  .option(
    "--as-of <YYYY-MM-DD>",
    "Optional date (YYYY-MM-DD) passed as today to import",
  )
  .action((opts: { fromJson: string; db: string; asOf?: string }) => {
    try {
      importAwpV2TupleFromPaths(
        resolvePath(opts.fromJson),
        resolvePath(opts.db),
        {
          today: opts.asOf,
        },
      );
    } catch (e) {
      exitValidation(e, "import awp v2 tuple failed");
    }
  });

program.parseAsync(process.argv);
