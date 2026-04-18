import { writeFileSync } from "node:fs";
import type { RunDreamingPipelineFromDbOpts } from "../dreaming-pipeline/runDreamingPipelineFromDb.js";
import { saveTextToMemoryDb } from "../memory/saveTextToMemoryDb.js";
import { applySentenceUsageFeedback } from "../sqlite/applySentenceUsageFeedback.js";
import { scrubOpenclawHeartbeatArtifacts } from "../utils/scrubOpenclawHeartbeatArtifacts.js";
import { stripMemokInjectEchoFromTranscript } from "../utils/stripMemokInjectEchoFromTranscript.js";
import type { MemokConfig } from "./memokTypes.js";
import { cronPatternFromDailyAt, isMemokSetupCliRun } from "./memokTypes.js";
import {
  memoryCandidateIdsBySession,
  RecallCandidateMemoriesParams,
  ReportUsedMemoryIdsParams,
  recallAndStoreCandidates,
} from "./memoryCandidates.js";
import { registerDreamingPipelineCron } from "./registerDreamingPipelineCron.js";
import {
  clampToLastChars,
  collectLabeledTurns,
  INITIAL_TURN_WINDOW,
  MAX_AGENT_END_CHARS,
  oneLineSnippet,
  shortHash,
  stripFencedCodeBlocks,
} from "./transcriptHelpers.js";

const savedKeys = new Set<string>();
const sessionProgress = new Map<
  string,
  { lastCount: number; prefixHash: string }
>();

export type MemokRuntimeContext = {
  pluginCfg: MemokConfig;
  dbPath: string;
  memoryInjectEnabled: boolean;
  memoryRecallMode: NonNullable<MemokConfig["memoryRecallMode"]>;
  extractFraction: number;
  longTermFraction: number;
  maxInjectChars: number;
  persistTranscriptToMemory: boolean;
};

export function registerMemokPluginRuntime(
  api: any,
  ctx: MemokRuntimeContext,
): void {
  const {
    pluginCfg,
    dbPath,
    memoryInjectEnabled,
    memoryRecallMode,
    extractFraction,
    longTermFraction,
    maxInjectChars,
    persistTranscriptToMemory,
  } = ctx;

  if (pluginCfg.dreamingPipelineScheduleEnabled === true) {
    if (isMemokSetupCliRun()) {
      api.logger?.info(
        "[memok-ai] 检测到 `openclaw memok setup` 交互流程，跳过 dreaming cron 注册以避免 CLI 进程常驻。",
      );
    } else {
      const rawCron =
        typeof pluginCfg.dreamingPipelineCron === "string" &&
        pluginCfg.dreamingPipelineCron.trim()
          ? pluginCfg.dreamingPipelineCron.trim()
          : (cronPatternFromDailyAt(
              pluginCfg.dreamingPipelineDailyAt,
              api.logger,
            ) ?? "0 3 * * *");
      const dreamingTz =
        typeof pluginCfg.dreamingPipelineTimezone === "string" &&
        pluginCfg.dreamingPipelineTimezone.trim()
          ? pluginCfg.dreamingPipelineTimezone.trim()
          : undefined;
      const pipelineOpts: RunDreamingPipelineFromDbOpts = {};
      const mw = pluginCfg.dreamingPipelineMaxWords;
      if (typeof mw === "number" && Number.isFinite(mw)) {
        pipelineOpts.maxWords = Math.floor(mw);
      }
      const fr = pluginCfg.dreamingPipelineFraction;
      if (typeof fr === "number" && Number.isFinite(fr)) {
        pipelineOpts.fraction = fr;
      }
      const mn = pluginCfg.dreamingPipelineMinRuns;
      if (typeof mn === "number" && Number.isFinite(mn)) {
        pipelineOpts.minRuns = Math.floor(mn);
      }
      const mx = pluginCfg.dreamingPipelineMaxRuns;
      if (typeof mx === "number" && Number.isFinite(mx)) {
        pipelineOpts.maxRuns = Math.floor(mx);
      }
      registerDreamingPipelineCron({
        logger: api.logger ?? {},
        dbPath,
        pattern: rawCron,
        timezone: dreamingTz,
        pipelineOpts:
          Object.keys(pipelineOpts).length > 0 ? pipelineOpts : undefined,
      });
    }
  }

  const runSave = async (
    dedupeKey: string,
    text: string,
    source: "agent_end" | "message_sent",
  ): Promise<void> => {
    let stripped = stripMemokInjectEchoFromTranscript(text.trim());
    stripped = scrubOpenclawHeartbeatArtifacts(stripped);
    if (!stripped) {
      return;
    }
    if (savedKeys.has(dedupeKey)) {
      return;
    }
    savedKeys.add(dedupeKey);
    if (!persistTranscriptToMemory) {
      api.logger?.debug?.(
        `[memok-ai] 跳过写入 SQLite (${source})，len=${stripped.length}`,
      );
      return;
    }
    const debugFile = `/tmp/memok-ai-input-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}.txt`;
    try {
      writeFileSync(debugFile, stripped, "utf-8");
    } catch {
      // ignore debug dump failures
    }
    api.logger?.info(
      `[memok-ai] 输入调试 (${source}): len=${stripped.length}, file=${debugFile}, prefix=${JSON.stringify(oneLineSnippet(stripped.slice(0, 500), 260))}, suffix=${JSON.stringify(oneLineSnippet(stripped.slice(-500), 260))}`,
    );
    api.logger?.info(`[memok-ai] 记忆管线开始 (${source})…`);
    try {
      await saveTextToMemoryDb(stripped, { dbPath });
      api.logger?.info(`[memok-ai] 记忆已保存 (${source})`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      api.logger?.error(
        `[memok-ai] 保存记忆失败 (${source}): ${msg}; input_file=${debugFile}; input_len=${stripped.length}`,
      );
      savedKeys.delete(dedupeKey);
    }
  };

  if (memoryInjectEnabled) {
    api.on("before_prompt_build", (_event: any, ctx: any) => {
      try {
        const sessionMemKey = ctx.sessionKey ?? ctx.sessionId ?? "unknown";
        if (memoryRecallMode === "prepend") {
          const r = recallAndStoreCandidates(
            dbPath,
            extractFraction,
            longTermFraction,
            maxInjectChars,
            sessionMemKey,
          );
          if (r.kind === "empty") {
            return;
          }
          if (r.truncated) {
            api.logger?.info(
              `[memok-ai] 记忆注入已截断: session=${sessionMemKey}, ids=${r.ids.length}, maxInjectChars=${maxInjectChars}`,
            );
          }
          api.logger?.info(
            `[memok-ai] before_prompt_build: prependContext chars=${r.text.length} session=${sessionMemKey}`,
          );
          return { prependContext: r.text };
        }
        const useSkillHint = memoryRecallMode === "skill+hint";
        const r = recallAndStoreCandidates(
          dbPath,
          extractFraction,
          longTermFraction,
          maxInjectChars,
          sessionMemKey,
        );
        if (r.kind === "empty") {
          api.logger?.info(
            `[memok-ai] before_prompt_build: ${memoryRecallMode} 本轮无候选 session=${sessionMemKey}`,
          );
          if (useSkillHint) {
            return {
              prependContext:
                "（memok）本轮未抽到候选记忆句；若需再试可调工具 memok_recall_candidate_memories。",
            };
          }
          return;
        }
        if (r.truncated) {
          api.logger?.info(
            `[memok-ai] ${memoryRecallMode} 系统上下文注入已截断: session=${sessionMemKey}, ids=${r.ids.length}, maxInjectChars=${maxInjectChars}`,
          );
        }
        const skillLead =
          "（memok）以下为每轮自动附带的候选记忆（系统上下文，非用户消息区 prepend）。请遵循技能 memok-memory 阅读定界块内条目并自行判断是否采用；采用后请调用 memok_report_used_memory_ids 上报 id。\n\n";
        const appendSystemContext = `${skillLead}${r.text}`;
        api.logger?.info(
          `[memok-ai] before_prompt_build: appendSystemContext recall chars=${appendSystemContext.length} session=${sessionMemKey}${useSkillHint ? " +prependHint" : ""}`,
        );
        if (useSkillHint) {
          return {
            appendSystemContext,
            prependContext:
              "（memok）完整候选在**系统上下文**定界块内；同轮再抽样请调 `memok_recall_candidate_memories`；采用后请 `memok_report_used_memory_ids`。",
          };
        }
        return { appendSystemContext };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        api.logger?.warn?.(`[memok-ai] 记忆召回前置处理跳过: ${msg}`);
      }
    });
  }

  if (memoryInjectEnabled) {
    const recallDescription =
      memoryRecallMode === "prepend"
        ? "从 memok SQLite 图库抽样候选记忆句（与技能 memok-memory 配合）。prepend 模式下载入前通常已自动注入一批候选；若需在本轮中重新抽样可调用。返回文本含 [id=…] 与定界块。"
        : "skill / skill+hint 下网关已在每轮 before_prompt_build 把最新候选写入 appendSystemContext；若**同一轮内**需要再抽样一次可调用。返回文本含 [id=…] 与定界块，并会刷新本轮候选 id。";
    api.registerTool(
      (toolCtx: any) => {
        return {
          name: "memok_recall_candidate_memories",
          label: "Memok 召回候选记忆",
          description: recallDescription,
          parameters: RecallCandidateMemoriesParams,
          async execute(_toolCallId: any, _params: Record<string, never>) {
            const sessionMemKey =
              toolCtx.sessionKey ?? toolCtx.sessionId ?? "unknown";
            try {
              const r = recallAndStoreCandidates(
                dbPath,
                extractFraction,
                longTermFraction,
                maxInjectChars,
                sessionMemKey,
              );
              if (r.kind === "empty") {
                return {
                  content: [
                    {
                      type: "text" as const,
                      text: "（memok）当前抽样未得到候选记忆句。",
                    },
                  ],
                  details: { sentenceIds: [] as number[], empty: true },
                };
              }
              if (r.truncated) {
                api.logger?.info(
                  `[memok-ai] 工具召回已截断: session=${sessionMemKey}, ids=${r.ids.length}, maxInjectChars=${maxInjectChars}`,
                );
              }
              return {
                content: [{ type: "text" as const, text: r.text }],
                details: { sentenceIds: r.ids, truncated: r.truncated },
              };
            } catch (error: unknown) {
              const msg =
                error instanceof Error ? error.message : String(error);
              api.logger?.warn?.(
                `[memok-ai] memok_recall_candidate_memories 失败: ${msg}`,
              );
              return {
                content: [{ type: "text" as const, text: `召回失败：${msg}` }],
                details: { error: true },
              };
            }
          },
        };
      },
      { name: "memok_recall_candidate_memories" },
    );
    api.logger?.info(
      `[memok-ai] 已注册工具 memok_recall_candidate_memories（memoryRecallMode=${memoryRecallMode}）`,
    );
  }

  if (memoryInjectEnabled) {
    api.registerTool(
      (toolCtx: any) => {
        const reportDescription =
          memoryRecallMode === "prepend"
            ? "当你在本轮回复中**确实使用**了 `@@@MEMOK_RECALL_START@@@` … `@@@MEMOK_RECALL_END@@@` 包裹的候选记忆条目时，调用此工具上报所采用句子的数字 id（列表中的 [id=…]）。若未使用任何候选记忆，则不要调用。"
            : "当你在本轮回复中**确实使用**了系统上下文里自动附带的候选块、或工具 `memok_recall_candidate_memories` 返回文本中的某条候选（[id=…]）时，调用此工具上报所采用句子的数字 id。未采用任何条目则不要调用。";
        return {
          name: "memok_report_used_memory_ids",
          label: "Memok 记忆反馈",
          description: reportDescription,
          parameters: ReportUsedMemoryIdsParams,
          async execute(_toolCallId: any, params: { sentenceIds?: number[] }) {
            const raw = params?.sentenceIds;
            const sentenceIds = Array.isArray(raw)
              ? raw.filter(
                  (n): n is number =>
                    typeof n === "number" && Number.isInteger(n) && n > 0,
                )
              : [];
            const sessionMemKey =
              toolCtx.sessionKey ?? toolCtx.sessionId ?? "unknown";
            const candidate = memoryCandidateIdsBySession.get(sessionMemKey);
            const roundIds = candidate?.ids;
            const hasRoundCandidates = (roundIds?.length ?? 0) > 0;
            const allowedSet = hasRoundCandidates ? new Set(roundIds) : null;
            const validIds = allowedSet
              ? sentenceIds.filter((id) => allowedSet.has(id))
              : sentenceIds;
            if (sentenceIds.length > 0 && allowedSet) {
              const outsiders = sentenceIds.filter((id) => !allowedSet.has(id));
              if (outsiders.length > 0) {
                api.logger?.warn?.(
                  `[memok-ai] memok_report_used_memory_ids: 部分 id 不在本轮候选内: ${outsiders.join(", ")}`,
                );
              }
            }
            let updatedCount = 0;
            if (validIds.length > 0) {
              try {
                ({ updatedCount } = applySentenceUsageFeedback(
                  dbPath,
                  validIds,
                ));
              } catch (error: unknown) {
                const msg =
                  error instanceof Error ? error.message : String(error);
                api.logger?.error(`[memok-ai] 记忆反馈写库失败: ${msg}`);
                return {
                  content: [
                    {
                      type: "text" as const,
                      text: `更新记忆库失败：${msg}`,
                    },
                  ],
                  details: { error: true, sentenceIds, validIds },
                };
              }
            }
            const text =
              sentenceIds.length === 0
                ? "未上报任何 id（空数组）。若你未使用候选记忆，这是正确的；若使用了请传入对应 id。"
                : validIds.length === 0
                  ? "上报的 id 均不在本轮可校验的候选列表内，未更新数据库。"
                  : `已更新 ${updatedCount} 条句子（weight 每次+1；跨日则当日 duration 计数从 1 起；同日 duration 最多+3 次）`;
            return {
              content: [{ type: "text" as const, text }],
              details: {
                recorded: validIds.length,
                updatedCount,
                sentenceIds,
                validIds,
              },
            };
          },
        };
      },
      { name: "memok_report_used_memory_ids" },
    );
    api.logger?.info("[memok-ai] 已注册工具 memok_report_used_memory_ids");
  }

  api.on("agent_end", (event: any, hookCtx: any) => {
    if (!event.success) {
      return;
    }
    const turns = collectLabeledTurns(event.messages ?? []);
    if (turns.length === 0) {
      return;
    }
    const sessionId = hookCtx.sessionKey ?? hookCtx.sessionId ?? "nosession";
    const state = sessionProgress.get(sessionId);
    let startIdx = 0;
    if (!state) {
      startIdx = Math.max(0, turns.length - INITIAL_TURN_WINDOW);
    } else if (turns.length <= state.lastCount) {
      return;
    } else {
      const prevPrefixHash = shortHash(
        turns.slice(0, state.lastCount).join("\n\n"),
      );
      if (prevPrefixHash === state.prefixHash) {
        startIdx = state.lastCount;
      } else {
        startIdx = Math.max(0, turns.length - INITIAL_TURN_WINDOW);
        api.logger?.info(
          `[memok-ai] 会话历史发生重写，回退窗口模式: session=${sessionId}, turns=${turns.length}, lastCount=${state.lastCount}`,
        );
      }
    }

    const delta = turns.slice(startIdx).join("\n\n");
    const cleaned = stripFencedCodeBlocks(delta);
    const transcript = clampToLastChars(cleaned, MAX_AGENT_END_CHARS).trim();
    if (!transcript) {
      return;
    }
    const dedupeKey = `ae:${sessionId}:${startIdx}:${turns.length}:${shortHash(transcript)}`;

    sessionProgress.set(sessionId, {
      lastCount: turns.length,
      prefixHash: shortHash(turns.join("\n\n")),
    });

    void runSave(dedupeKey, transcript, "agent_end");
  });

  api.on("message_sent", (event: any, hookCtx: any) => {
    if (!event.success) {
      return;
    }
    const content = event.content?.trim() ?? "";
    if (!content) {
      return;
    }
    const dedupeKey = `ms:${hookCtx.conversationId ?? event.to}:${content.slice(0, 280)}`;
    void runSave(dedupeKey, `OpenClaw:\n${content}`, "message_sent");
  });
}
