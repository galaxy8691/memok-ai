import { Cron } from "croner";
import {
  type RunDreamingPipelineFromDbOpts,
  runDreamingPipelineFromDb,
} from "../dreaming-pipeline/runDreamingPipelineFromDb.js";
import { openSqlite } from "../sqlite/openSqlite.js";

export type PluginLoggerLike = {
  info?: (msg: string) => void;
  warn?: (msg: string) => void;
  error?: (msg: string) => void;
};

let active: Cron | undefined;

/** 停止由本模块注册的定时任务（例如热重载前可调用；当前插件未单独挂接 reload）。 */
export function stopDreamingPipelineCron(): void {
  active?.stop();
  active = undefined;
}

/**
 * 在 OpenClaw 网关进程内按 cron 调度执行 `runDreamingPipelineFromDb`（需网关常驻）。
 * 与系统 crontab 无关；时区由 `timezone` 或本机默认决定。
 */
export function registerDreamingPipelineCron(params: {
  logger: PluginLoggerLike;
  dbPath: string;
  pattern: string;
  timezone?: string;
  pipelineOpts?: RunDreamingPipelineFromDbOpts;
}): void {
  stopDreamingPipelineCron();
  const { logger, dbPath, pattern, timezone, pipelineOpts } = params;

  const insertDreamLog = (row: Record<string, unknown>): void => {
    try {
      const db = openSqlite(dbPath, undefined, (m) => logger.warn?.(m));
      try {
        db.pragma("foreign_keys = ON");
        db.exec(
          `CREATE TABLE IF NOT EXISTS dream_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dream_date TEXT NOT NULL,
            ts TEXT NOT NULL,
            status TEXT NOT NULL,
            log_json TEXT NOT NULL
          )`,
        );
        const dreamDate = new Date().toISOString().slice(0, 10);
        const ts =
          typeof row.ts === "string" ? row.ts : new Date().toISOString();
        const status = String(row.status ?? "unknown");
        db.prepare(
          `INSERT INTO dream_logs (dream_date, ts, status, log_json)
           VALUES (?, ?, ?, ?)`,
        ).run(dreamDate, ts, status, JSON.stringify(row));
      } finally {
        db.close();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn?.(`[memok-ai] dream_logs 写库失败: ${msg}`);
    }
  };

  try {
    const job = new Cron(
      pattern,
      {
        name: "memok-ai-dreaming-pipeline",
        timezone,
        protect: true,
      },
      async () => {
        const startedAt = new Date().toISOString();
        try {
          logger.info?.(
            `[memok-ai] dreaming-pipeline（定时）开始: db=${dbPath}`,
          );
          const out = await runDreamingPipelineFromDb(dbPath, pipelineOpts);
          const p = out.predream;
          const s = out.storyWordSentencePipeline;
          logger.info?.(
            `[memok-ai] dreaming-pipeline（定时）完成: predream(durationDec=${p.sentencesDurationDecremented} promoted=${p.promotedToLongTerm} deleted=${p.deletedSentences}) storyRuns=${s.plannedRuns}`,
          );
          insertDreamLog({
            ts: startedAt,
            status: "ok",
            dbPath,
            predream: p,
            storyWordSentencePipeline: {
              minRuns: s.minRuns,
              maxRuns: s.maxRuns,
              plannedRuns: s.plannedRuns,
              orphanNormalWordsDeleted: s.orphanNormalWordsDeleted,
              orphanSentenceMerge: s.orphanSentenceMerge,
              sentenceLinkFeedback: s.sentenceLinkFeedback,
              normalWordLinkFeedback: s.normalWordLinkFeedback,
            },
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.error?.(`[memok-ai] dreaming-pipeline（定时）失败: ${msg}`);
          insertDreamLog({
            ts: startedAt,
            status: "error",
            dbPath,
            error: msg,
          });
        }
      },
    );
    active = job;
    const next = job.nextRun();
    logger.info?.(
      `[memok-ai] dreaming-pipeline 已调度: cron=${pattern}${timezone ? ` tz=${timezone}` : ""} 下次=${next?.toISOString() ?? "unknown"}`,
    );
    logger.info?.("[memok-ai] dreaming 结果将写入 SQLite 表 dream_logs");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error?.(
      `[memok-ai] dreaming-pipeline 定时无效: pattern=${pattern} ${msg}`,
    );
  }
}
