import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { dumpArticleSentenceCoreCombineTupleV2Json } from "../article-word-pipeline/v2/articleSentenceCoreCombine.js";
import { articleWordPipelineV2 } from "../article-word-pipeline/v2/articleWordPipeline.js";

type CliOptions = {
  inputDir: string;
  outputDir: string;
  skipExisting: boolean;
  fromIndex: number;
  toIndex: number | null;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    inputDir: "articles",
    outputDir: "outputs",
    skipExisting: true,
    fromIndex: 0,
    toIndex: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input-dir" && argv[i + 1]) {
      opts.inputDir = argv[++i];
    } else if (arg === "--output-dir" && argv[i + 1]) {
      opts.outputDir = argv[++i];
    } else if (arg === "--skip-existing") {
      opts.skipExisting = true;
    } else if (arg === "--no-skip-existing") {
      opts.skipExisting = false;
    } else if (arg === "--from" && argv[i + 1]) {
      opts.fromIndex = Math.max(0, Number.parseInt(argv[++i], 10) || 0);
    } else if (arg === "--to" && argv[i + 1]) {
      const n = Number.parseInt(argv[++i], 10);
      opts.toIndex = Number.isFinite(n) ? Math.max(0, n) : null;
    }
  }
  return opts;
}

function collectTxtFiles(root: string): string[] {
  const files: string[] = [];
  function walk(dir: string): void {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) {
        walk(p);
      } else if (extname(name).toLowerCase() === ".txt") {
        files.push(p);
      }
    }
  }
  walk(root);
  return files.sort((a, b) => a.localeCompare(b));
}

function outputNameFor(inputPath: string, inputRoot: string): string {
  const rel = relative(inputRoot, inputPath);
  const base = basename(rel, extname(rel));
  return `${base}-output.json`;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const inputDir = resolve(process.cwd(), opts.inputDir);
  const outputDir = resolve(process.cwd(), opts.outputDir);
  mkdirSync(outputDir, { recursive: true });

  const all = collectTxtFiles(inputDir);
  const sliced = all.filter(
    (_, idx) =>
      idx >= opts.fromIndex && (opts.toIndex === null || idx <= opts.toIndex),
  );
  if (sliced.length === 0) {
    console.log("没有找到待处理的 .txt 文件。");
    return;
  }

  console.log(
    `将处理 ${sliced.length} 个文件（输入目录: ${inputDir}，输出目录: ${outputDir}）`,
  );
  const errors: string[] = [];

  for (let i = 0; i < sliced.length; i += 1) {
    const file = sliced[i];
    const outPath = join(outputDir, outputNameFor(file, inputDir));
    if (opts.skipExisting) {
      try {
        statSync(outPath);
        console.log(
          `[${i + 1}/${sliced.length}] 跳过已存在: ${basename(outPath)}`,
        );
        continue;
      } catch {
        // not exists
      }
    }

    try {
      const text = readFileSync(file, "utf-8");
      const [combined, normalized] = await articleWordPipelineV2(text);
      const payload = dumpArticleSentenceCoreCombineTupleV2Json(
        combined,
        normalized,
        2,
      );
      writeFileSync(outPath, payload, "utf-8");
      console.log(
        `[${i + 1}/${sliced.length}] 完成: ${basename(file)} -> ${basename(outPath)}`,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      errors.push(`${file}\t${msg}`);
      console.error(
        `[${i + 1}/${sliced.length}] 失败: ${basename(file)}: ${msg}`,
      );
    }
  }

  if (errors.length > 0) {
    const errPath = join(outputDir, "batch-errors.log");
    writeFileSync(errPath, `${errors.join("\n")}\n`, "utf-8");
    console.log(
      `批处理结束：成功 ${sliced.length - errors.length}，失败 ${errors.length}。错误日志: ${errPath}`,
    );
  } else {
    console.log(`批处理结束：全部成功，共 ${sliced.length} 个文件。`);
  }
}

void main();
