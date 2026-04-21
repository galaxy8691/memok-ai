import type Database from "better-sqlite3";

/** 安全执行 `SELECT 1 ... LIMIT 1` 并判断是否存在至少一行。 */
export function selectExists(
  stmt: Database.Statement,
  ...params: unknown[]
): boolean {
  return stmt.get(...params) !== undefined;
}

/** 安全执行 `SELECT COUNT(*) as c ...` 并返回数值 count。 */
export function selectCount(
  stmt: Database.Statement,
  ...params: unknown[]
): number {
  const row = stmt.get(...params) as Record<string, unknown> | undefined;
  if (row === undefined) {
    return 0;
  }
  const raw = row.c;
  if (raw === undefined || raw === null) {
    return 0;
  }
  return Number(raw);
}

/** 安全执行单条查询并返回经 Zod / 运行时校验后的对象。 */
export function selectRow<T extends Record<string, unknown>>(
  stmt: Database.Statement,
  ...params: unknown[]
): T | undefined {
  const row = stmt.get(...params);
  if (row === undefined || row === null) {
    return undefined;
  }
  return row as T;
}

/** 安全执行多条查询并返回经类型断言后的数组。 */
export function selectRows<T extends Record<string, unknown>>(
  stmt: Database.Statement,
  ...params: unknown[]
): T[] {
  const rows = stmt.all(...params);
  return rows as T[];
}
