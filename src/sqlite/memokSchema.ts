import { existsSync, unlinkSync } from "node:fs";
import type Database from "better-sqlite3";
import { memokInitDatabaseDdl } from "./memokSqliteDdl.js";
import { openSqlite } from "./openSqlite.js";

function applyMemokSqliteSchema(db: Database.Database): void {
  db.pragma("foreign_keys = ON");
  db.exec(memokInitDatabaseDdl);
}

export type CreateFreshMemokSqliteFileOptions = {
  /**
   * 为 `true` 时：若 `dbPath` 已存在则删除主库文件及同路径的 `-wal` / `-shm`（若存在），再写入新库。
   */
  replace?: boolean;
};

function removeSqliteSidecars(dbPath: string): void {
  for (const suffix of ["-wal", "-shm"] as const) {
    const p = `${dbPath}${suffix}`;
    if (existsSync(p)) {
      try {
        unlinkSync(p);
      } catch {
        /* 占用或权限不足时忽略，主文件删除后多数环境会重建 */
      }
    }
  }
}

/**
 * 在磁盘路径上创建一个空的 memok SQLite 库（建表 + `dream_logs` + link 加固与索引）。
 * 默认若文件已存在则抛错，避免误覆盖；需要覆盖时传 `{ replace: true }`。
 */
export function createFreshMemokSqliteFile(
  dbPath: string,
  options?: CreateFreshMemokSqliteFileOptions,
): void {
  if (existsSync(dbPath)) {
    if (!options?.replace) {
      throw new Error(
        `createFreshMemokSqliteFile: file already exists: ${dbPath} (pass { replace: true } to overwrite)`,
      );
    }
    removeSqliteSidecars(dbPath);
    unlinkSync(dbPath);
  }
  const db = openSqlite(dbPath);
  try {
    applyMemokSqliteSchema(db);
  } finally {
    db.close();
  }
}
