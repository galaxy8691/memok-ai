import type Database from "better-sqlite3";
import { openSqlite } from "./openSqlite.js";

/**
 * 数据库结构加固（幂等）：
 * - 清理明显无效 link（word_to_normal_link.normal_id 为 NULL）
 * - 去重 link 关系（保留最小 id）
 * - 建立外键列索引与组合唯一索引，防止重复关系并提升联查/删除性能
 */
export function hardenDb(db: Database.Database): void {
  db.pragma("foreign_keys = ON");
  const tableExists = (tableName: string): boolean => {
    const row = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?")
      .get(tableName) as { 1?: number } | undefined;
    return row !== undefined;
  };
  const runTx = db.transaction(() => {
    if (tableExists("word_to_normal_link")) {
      db.prepare(
        "DELETE FROM word_to_normal_link WHERE normal_id IS NULL",
      ).run();

      db.prepare(
        `DELETE FROM word_to_normal_link
         WHERE normal_id IS NOT NULL
           AND rowid NOT IN (
             SELECT MIN(rowid)
             FROM word_to_normal_link
             WHERE normal_id IS NOT NULL
             GROUP BY word_id, normal_id
           )`,
      ).run();

      db.prepare(
        "CREATE INDEX IF NOT EXISTS idx_word_to_normal_link_word_id ON word_to_normal_link(word_id)",
      ).run();
      db.prepare(
        "CREATE INDEX IF NOT EXISTS idx_word_to_normal_link_normal_id ON word_to_normal_link(normal_id)",
      ).run();
      db.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_word_to_normal_link_word_normal ON word_to_normal_link(word_id, normal_id) WHERE normal_id IS NOT NULL",
      ).run();
    }

    if (tableExists("sentence_to_normal_link")) {
      db.prepare(
        `DELETE FROM sentence_to_normal_link
         WHERE rowid NOT IN (
           SELECT MIN(rowid)
           FROM sentence_to_normal_link
           GROUP BY sentence_id, normal_id
         )`,
      ).run();

      db.prepare(
        "CREATE INDEX IF NOT EXISTS idx_sentence_to_normal_link_sentence_id ON sentence_to_normal_link(sentence_id)",
      ).run();
      db.prepare(
        "CREATE INDEX IF NOT EXISTS idx_sentence_to_normal_link_normal_id ON sentence_to_normal_link(normal_id)",
      ).run();
      db.prepare(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_sentence_to_normal_link_sentence_normal ON sentence_to_normal_link(sentence_id, normal_id)",
      ).run();
    }
  });
  runTx();
}

export function hardenDbFile(dbPath: string): void {
  const db = openSqlite(dbPath);
  try {
    hardenDb(db);
  } finally {
    db.close();
  }
}
