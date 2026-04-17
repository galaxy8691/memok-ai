import { articleWordPipelineV2 } from "../article-word-pipeline/v2/articleWordPipeline.js";
import { importAwpV2Tuple } from "../sqlite/awpV2Import.js";
import { openSqlite } from "../sqlite/openSqlite.js";

export type SaveTextToMemoryDbOptions = {
  dbPath: string;
  today?: string;
};

/**
 * 输入任意文本，走 article-word-pipeline(v2) 后直接写入 SQLite。
 * 不落地任何中间 JSON 文件。
 */
export async function saveTextToMemoryDb(
  text: string,
  options: SaveTextToMemoryDbOptions,
): Promise<void> {
  const stripped = text.trim();
  if (!stripped) {
    throw new Error("text must be non-empty after stripping whitespace");
  }

  const [combined, normalized] = await articleWordPipelineV2(stripped);
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
