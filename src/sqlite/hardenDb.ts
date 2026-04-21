import type Database from "better-sqlite3";
import {
  memokSentenceToNormalLinkHardenDdl,
  memokWordToNormalLinkHardenDdl,
} from "./memokSqliteDdl.js";
import { openSqlite } from "./openSqlite.js";
import { selectExists } from "./sqliteHelpers.js";

/**
 * 数据库结构加固（幂等）：与 `memokSqliteDdl` 中 `memokInitDatabaseDdl` 的 link 段语义相同，
 * 但对缺表旧库按表存在性分段执行，避免 `no such table`。
 */
export function hardenDb(db: Database.Database): void {
  db.pragma("foreign_keys = ON");
  const tableExists = (tableName: string): boolean => {
    return selectExists(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?"),
      tableName,
    );
  };
  const runTx = db.transaction(() => {
    if (tableExists("word_to_normal_link")) {
      db.exec(memokWordToNormalLinkHardenDdl);
    }
    if (tableExists("sentence_to_normal_link")) {
      db.exec(memokSentenceToNormalLinkHardenDdl);
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
