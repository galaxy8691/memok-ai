import { Cron } from "croner";
import {
  runDreamingPipelineFromDb,
  type RunDreamingPipelineFromDbOpts,
} from "../dreaming-pipeline/runDreamingPipelineFromDb.js";

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

  try {
    const job = new Cron(
      pattern,
      {
        name: "memok-ai-dreaming-pipeline",
        timezone,
        protect: true,
      },
      async () => {
        try {
          logger.info?.(`[memok-ai] dreaming-pipeline（定时）开始: db=${dbPath}`);
          const out = await runDreamingPipelineFromDb(dbPath, pipelineOpts);
          const p = out.predream;
          const s = out.storyWordSentencePipeline;
          logger.info?.(
            `[memok-ai] dreaming-pipeline（定时）完成: predream(durationDec=${p.sentencesDurationDecremented} promoted=${p.promotedToLongTerm} deleted=${p.deletedSentences}) storyRuns=${s.plannedRuns}`,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.error?.(`[memok-ai] dreaming-pipeline（定时）失败: ${msg}`);
        }
      },
    );
    active = job;
    const next = job.nextRun();
    logger.info?.(
      `[memok-ai] dreaming-pipeline 已调度: cron=${pattern}${timezone ? ` tz=${timezone}` : ""} 下次=${next?.toISOString() ?? "unknown"}`,
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error?.(`[memok-ai] dreaming-pipeline 定时无效: pattern=${pattern} ${msg}`);
  }
}
