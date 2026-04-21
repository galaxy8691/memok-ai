import type Database from "better-sqlite3";
import { openSqlite } from "../../sqlite/openSqlite.js";

const DEFAULT_SHORT_TERM_TO_LONG_TERM_WEIGHT = 7;

export type RunPredreamDecayFromDbOpts = {
  /**
   * 短期句 `weight >=` 该值时设为长期；同时 `weight <` 该值且 `duration<=0` 的短期句会被删除。
   * 缺省为 **7**。
   */
  shortTermToLongTermWeightThreshold?: number;
};

export type PredreamDecayResult = {
  /** 全局 `duration = duration - 1` 影响的行数 */
  sentencesDurationDecremented: number;
  /** `is_short_term=1` 且 `weight>=` 阈值被设为长期（`is_short_term=0`），不要求 `duration` */
  promotedToLongTerm: number;
  /** `is_short_term=1` 且 `duration<=0` 且 `weight`< 阈值被删除的句子条数 */
  deletedSentences: number;
};

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name) as { 1?: number } | undefined;
  return row !== undefined;
}

function resolveWeightThreshold(raw: number | undefined): number {
  if (raw === undefined) {
    return DEFAULT_SHORT_TERM_TO_LONG_TERM_WEIGHT;
  }
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    throw new Error(
      "shortTermToLongTermWeightThreshold must be an integer >= 1",
    );
  }
  return raw;
}

/**
 * predream：全表句子 `duration` 减 1；再分流：
 * - 短期且 `weight >=` 阈值 → 直接 `is_short_term = 0`（转长期，不看 `duration`）
 * - 短期且 `duration <= 0` 且 `weight <` 阈值 → 删除句子（先删 `sentence_to_normal_link` 若表存在）
 */
export function runPredreamDecayFromDb(
  dbPath: string,
  opts?: RunPredreamDecayFromDbOpts,
): PredreamDecayResult {
  const wMin = resolveWeightThreshold(opts?.shortTermToLongTermWeightThreshold);
  const db = openSqlite(dbPath);
  try {
    db.pragma("foreign_keys = ON");
    const runTx = db.transaction((): PredreamDecayResult => {
      const dec = db
        .prepare("UPDATE sentences SET duration = duration - 1")
        .run();
      const sentencesDurationDecremented = dec.changes;

      const promote = db
        .prepare(
          `UPDATE sentences SET is_short_term = 0
           WHERE COALESCE(is_short_term, 0) = 1 AND weight >= ?`,
        )
        .run(wMin);
      const promotedToLongTerm = promote.changes;

      if (tableExists(db, "sentence_to_normal_link")) {
        db.prepare(
          `DELETE FROM sentence_to_normal_link
           WHERE sentence_id IN (
             SELECT id FROM sentences
             WHERE COALESCE(is_short_term, 0) = 1 AND duration <= 0 AND weight < ?
           )`,
        ).run(wMin);
      }

      const del = db
        .prepare(
          `DELETE FROM sentences
           WHERE COALESCE(is_short_term, 0) = 1 AND duration <= 0 AND weight < ?`,
        )
        .run(wMin);
      const deletedSentences = del.changes;

      return {
        sentencesDurationDecremented,
        promotedToLongTerm,
        deletedSentences,
      };
    });
    return runTx();
  } finally {
    db.close();
  }
}
