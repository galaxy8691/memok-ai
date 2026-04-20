import { dreamLogsTableDdl } from "./memokSqliteDdl.js";
import { openSqlite } from "./openSqlite.js";

/**
 * 在 `dream_logs` 表追加一行（`dreamingPipeline` 成功或失败后调用）。
 * 与 OpenClaw 插件曾使用的 schema 一致。
 */
export function persistDreamPipelineLogToDb(params: {
  dbPath: string;
  dreamDate: string;
  ts: string;
  status: "ok" | "error";
  logPayload: Record<string, unknown>;
  warn?: (msg: string) => void;
}): void {
  const { dbPath, dreamDate, ts, status, logPayload, warn } = params;
  try {
    const db = openSqlite(dbPath, undefined, (m) => warn?.(m));
    try {
      db.pragma("foreign_keys = ON");
      db.exec(dreamLogsTableDdl);
      db.prepare(
        `INSERT INTO dream_logs (dream_date, ts, status, log_json)
           VALUES (?, ?, ?, ?)`,
      ).run(dreamDate, ts, status, JSON.stringify(logPayload));
    } finally {
      db.close();
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    warn?.(`[memok-ai] dream_logs 写库失败: ${msg}`);
  }
}
