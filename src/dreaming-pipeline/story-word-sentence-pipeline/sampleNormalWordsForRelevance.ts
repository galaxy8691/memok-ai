import { openSqlite } from "../../sqlite/openSqlite.js";

const DEFAULT_FRACTION = 0.2;

export type RelevanceNormalWordItem = {
  id: number;
  word: string;
};

export type SampleNormalWordsForRelevanceOpts = {
  /** 对 normal_words 全表行数的抽样比例，默认 0.2 */
  fraction?: number;
};

/**
 * 从 `normal_words` 表随机抽样约 `fraction` 比例（至少 1 条，表非空），返回 `{ id, word }` 列表。
 */
export function sampleNormalWordsForRelevance(
  dbPath: string,
  opts?: SampleNormalWordsForRelevanceOpts,
): RelevanceNormalWordItem[] {
  const fraction = opts?.fraction ?? DEFAULT_FRACTION;
  const db = openSqlite(dbPath, { readonly: true });
  try {
    db.pragma("foreign_keys = ON");
    const countRow = db
      .prepare("SELECT COUNT(*) as c FROM normal_words")
      .get() as { c: number | bigint };
    const n = Number(countRow.c);
    if (n <= 0) {
      throw new Error("normal_words 表为空，无法抽样");
    }
    const k = Math.max(1, Math.round(n * fraction));
    const rows = db
      .prepare("SELECT id, word FROM normal_words ORDER BY RANDOM() LIMIT ?")
      .all(k) as { id: number; word: string }[];
    return rows.map((r) => ({ id: r.id, word: r.word }));
  } finally {
    db.close();
  }
}
