import { openSqlite } from "../../sqlite/openSqlite.js";

const DEFAULT_FRACTION = 0.2;

export type RelevanceSentenceItem = {
  id: number;
  sentence: string;
};

export type SampleSentencesForRelevanceOpts = {
  /** 对 sentences 全表行数的抽样比例，默认 0.2 */
  fraction?: number;
};

/**
 * 从 `sentences` 表随机抽样约 `fraction` 比例（至少 1 条，表非空），返回 `{id, sentence}` 列表。
 */
export function sampleSentencesForRelevance(
  dbPath: string,
  opts?: SampleSentencesForRelevanceOpts,
): RelevanceSentenceItem[] {
  const fraction = opts?.fraction ?? DEFAULT_FRACTION;
  const db = openSqlite(dbPath, { readonly: true });
  try {
    db.pragma("foreign_keys = ON");
    const countRow = db
      .prepare("SELECT COUNT(*) as c FROM sentences")
      .get() as { c: number | bigint };
    const n = Number(countRow.c);
    if (n <= 0) {
      throw new Error("sentences 表为空，无法抽样");
    }
    const k = Math.max(1, Math.round(n * fraction));
    const rows = db
      .prepare("SELECT id, sentence FROM sentences ORDER BY RANDOM() LIMIT ?")
      .all(k) as { id: number; sentence: string }[];
    return rows.map((r) => ({ id: r.id, sentence: r.sentence }));
  } finally {
    db.close();
  }
}
