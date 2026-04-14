import Database from "better-sqlite3";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { importAwpV2Tuple, parseAwpV2TupleJson } from "../sqlite/awpV2Import.js";

type CliOptions = {
  inputDir: string;
  dbPath: string;
  skipImported: boolean;
  fromIndex: number;
  toIndex: number | null;
  asOf?: string;
};

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    inputDir: "outputs",
    dbPath: "memok.sqlite",
    skipImported: true,
    fromIndex: 0,
    toIndex: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input-dir" && argv[i + 1]) {
      opts.inputDir = argv[++i];
    } else if (arg === "--db" && argv[i + 1]) {
      opts.dbPath = argv[++i];
    } else if (arg === "--skip-imported") {
      opts.skipImported = true;
    } else if (arg === "--no-skip-imported") {
      opts.skipImported = false;
    } else if (arg === "--from" && argv[i + 1]) {
      opts.fromIndex = Math.max(0, Number.parseInt(argv[++i], 10) || 0);
    } else if (arg === "--to" && argv[i + 1]) {
      const n = Number.parseInt(argv[++i], 10);
      opts.toIndex = Number.isFinite(n) ? Math.max(0, n) : null;
    } else if (arg === "--as-of" && argv[i + 1]) {
      opts.asOf = argv[++i];
    }
  }
  return opts;
}

function collectOutputJsonFiles(root: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    const st = statSync(p);
    if (!st.isFile()) {
      continue;
    }
    if (extname(name).toLowerCase() !== ".json") {
      continue;
    }
    if (!name.endsWith("-output.json")) {
      continue;
    }
    files.push(p);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function ensureImportLedgerTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS imported_outputs (
      file_name TEXT PRIMARY KEY,
      imported_at TEXT NOT NULL
    )
  `);
}

function alreadyImported(db: Database.Database, fileName: string): boolean {
  const row = db.prepare("SELECT 1 FROM imported_outputs WHERE file_name = ?").get(fileName) as
    | Record<string, unknown>
    | undefined;
  return row !== undefined;
}

function markImported(db: Database.Database, fileName: string): void {
  db.prepare(
    "INSERT INTO imported_outputs (file_name, imported_at) VALUES (?, datetime('now')) ON CONFLICT(file_name) DO UPDATE SET imported_at=datetime('now')",
  ).run(fileName);
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const inputDir = resolve(process.cwd(), opts.inputDir);
  const dbPath = resolve(process.cwd(), opts.dbPath);
  const logDir = resolve(process.cwd(), "outputs");
  mkdirSync(logDir, { recursive: true });

  const all = collectOutputJsonFiles(inputDir);
  const selected = all.filter((_, idx) => idx >= opts.fromIndex && (opts.toIndex === null || idx <= opts.toIndex));
  if (selected.length === 0) {
    console.log("没有找到可导入的 -output.json 文件。");
    return;
  }

  const db = new Database(dbPath);
  ensureImportLedgerTable(db);

  let ok = 0;
  let skipped = 0;
  const errors: string[] = [];
  try {
    console.log(`开始导入 ${selected.length} 个文件到 ${dbPath}`);
    for (let i = 0; i < selected.length; i += 1) {
      const filePath = selected[i];
      const fileName = basename(filePath);
      if (opts.skipImported && alreadyImported(db, fileName)) {
        skipped += 1;
        console.log(`[${i + 1}/${selected.length}] 跳过已导入: ${fileName}`);
        continue;
      }
      try {
        const raw = JSON.parse(readFileSync(filePath, "utf-8"));
        const [sc, nm] = parseAwpV2TupleJson(raw);
        const tx = db.transaction(() => {
          importAwpV2Tuple(db, sc, nm, { today: opts.asOf });
          markImported(db, fileName);
        });
        tx();
        ok += 1;
        console.log(`[${i + 1}/${selected.length}] 导入成功: ${fileName}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push(`${fileName}\t${msg}`);
        console.error(`[${i + 1}/${selected.length}] 导入失败: ${fileName}: ${msg}`);
      }
    }
  } finally {
    db.close();
  }

  if (errors.length > 0) {
    const errPath = join(logDir, "import-errors.log");
    writeFileSync(errPath, `${errors.join("\n")}\n`, "utf-8");
    console.log(`导入完成：成功 ${ok}，跳过 ${skipped}，失败 ${errors.length}。错误日志: ${errPath}`);
  } else {
    console.log(`导入完成：成功 ${ok}，跳过 ${skipped}，失败 0。`);
  }
}

main();
