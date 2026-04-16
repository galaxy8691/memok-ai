import Database from "better-sqlite3";

export type SampleWordStringsOpts = {
  /** 对 `words` 全表行数取样的比例，默认 0.2 */
  fraction?: number;
};

/**
 * 从 `words` 表随机抽取约 `fraction` 比例的行（至少 1 行，表非空），返回 `word` 字符串列表。
 * 与 `extractMemorySentencesByWordSample` 的抽样行数公式一致。
 */
export function sampleWordStrings(dbPath: string, opts?: SampleWordStringsOpts): string[] {
  const fraction = opts?.fraction ?? 0.2;
  const db = new Database(dbPath, { readonly: true });
  try {
    db.pragma("foreign_keys = ON");
    const countRow = db.prepare("SELECT COUNT(*) as c FROM words").get() as { c: number | bigint };
    const n = Number(countRow.c);
    if (n <= 0) {
      throw new Error("words 表为空，无法抽样");
    }
    const k = Math.max(1, Math.round(n * fraction));
    const rows = db.prepare("SELECT word FROM words ORDER BY RANDOM() LIMIT ?").all(k) as { word: string }[];
    return rows.map((r) => r.word);
  } finally {
    db.close();
  }
}
