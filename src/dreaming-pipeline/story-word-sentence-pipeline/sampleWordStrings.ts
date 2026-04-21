import { openSqlite } from "../../sqlite/openSqlite.js";
import { selectCount, selectRows } from "../../sqlite/sqliteHelpers.js";

const DEFAULT_MAX_WORDS = 10;

export type SampleWordStringsOpts = {
  /** 最多抽几个词（无放回随机）；默认 10；若表内总行数更少则只抽 `n` 行 */
  maxWords?: number;
};

/**
 * 从 `words` 表无放回随机抽取至多 `maxWords` 个词（默认 10），返回 `word` 字符串列表。
 */
export function sampleWordStrings(
  dbPath: string,
  opts?: SampleWordStringsOpts,
): string[] {
  const rawCap = opts?.maxWords ?? DEFAULT_MAX_WORDS;
  const cap =
    Number.isFinite(rawCap) && rawCap > 0
      ? Math.floor(rawCap)
      : DEFAULT_MAX_WORDS;
  const db = openSqlite(dbPath, { readonly: true });
  try {
    db.pragma("foreign_keys = ON");
    const n = selectCount(db.prepare("SELECT COUNT(*) as c FROM words"));
    if (n <= 0) {
      throw new Error("words 表为空，无法抽样");
    }
    const k = Math.min(n, cap);
    const rows = selectRows<{ word: string }>(
      db.prepare("SELECT word FROM words ORDER BY RANDOM() LIMIT ?"),
      k,
    );
    return rows.map((r) => r.word);
  } finally {
    db.close();
  }
}
