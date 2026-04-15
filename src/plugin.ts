import { Type } from "@sinclair/typebox";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { saveTextToMemoryDb } from "./memory/saveTextToMemoryDb.js";
import {
  extractMemorySentencesByWordSample,
  type MemoryExtractedSentence,
} from "./read-memory-pipeline/extractMemorySentencesByWordSample.js";
import { scrubOpenclawHeartbeatArtifacts } from "./utils/scrubOpenclawHeartbeatArtifacts.js";
import {
  MEMOK_INJECT_END,
  MEMOK_INJECT_START,
  MEMOK_MEMORY_INJECT_MARKER,
  stripMemokInjectEchoFromTranscript,
} from "./utils/stripMemokInjectEchoFromTranscript.js";

function getDefaultDbPath(): string {
  return (
    process.env.MEMOK_MEMORY_DB ||
    join(homedir(), ".openclaw/extensions/memok-ai/memok.sqlite")
  );
}

function expandUserPath(p: string): string {
  const t = p.trim();
  if (t.startsWith("~/")) {
    return join(homedir(), t.slice(2));
  }
  return t;
}

function getDefaultMemoryFeedbackLogPath(): string {
  return join(homedir(), ".openclaw/extensions/memok-ai/memory-feedback.jsonl");
}

interface MemokConfig {
  dbPath?: string;
  enabled?: boolean;
  /** 是否在每轮模型前注入候选记忆（默认 true） */
  memoryInjectEnabled?: boolean;
  extractFraction?: number;
  longTermFraction?: number;
  maxInjectChars?: number;
  memoryFeedbackLogPath?: string;
  /**
   * 是否在每轮结束后把对话 transcript 再跑 article 管线写入 SQLite。
   * 未设置时：若开启记忆注入则默认 **false**（避免「读库 → 注入 → 再整段写回」自我污染）；未开启注入时默认 **true**（保持旧行为）。
   */
  persistTranscriptToMemory?: boolean;
}

const MEMORY_CANDIDATE_TTL_MS = 30 * 60 * 1000;
const MEMORY_CANDIDATE_MAP_MAX = 50;

const savedKeys = new Set<string>();
const sessionProgress = new Map<string, { lastCount: number; prefixHash: string }>();
/** sessionKey（或回退键）→ 最近一轮注入的句子 id，供工具校验与日志 */
const memoryCandidateIdsBySession = new Map<string, { ids: number[]; at: number }>();

const ReportUsedMemoryIdsParams = Type.Object({
  sentenceIds: Type.Array(Type.Integer(), { minItems: 0 }),
});

function pruneMemoryCandidateMap(): void {
  const now = Date.now();
  for (const [k, v] of memoryCandidateIdsBySession) {
    if (now - v.at > MEMORY_CANDIDATE_TTL_MS) {
      memoryCandidateIdsBySession.delete(k);
    }
  }
  while (memoryCandidateIdsBySession.size > MEMORY_CANDIDATE_MAP_MAX) {
    let oldestKey: string | undefined;
    let oldestAt = Infinity;
    for (const [k, v] of memoryCandidateIdsBySession) {
      if (v.at < oldestAt) {
        oldestAt = v.at;
        oldestKey = k;
      }
    }
    if (oldestKey !== undefined) {
      memoryCandidateIdsBySession.delete(oldestKey);
    } else {
      break;
    }
  }
}

function formatOneMemoryLine(s: MemoryExtractedSentence): string {
  const mw = s.matched_word;
  const sentence = scrubOpenclawHeartbeatArtifacts(s.sentence.replace(/\s+/g, " ").trim());
  const w = scrubOpenclawHeartbeatArtifacts(mw.word);
  const nw = scrubOpenclawHeartbeatArtifacts(mw.normal_word);
  return `- [id=${s.id}] ${sentence} (词: ${w} → ${nw})`;
}

/**
 * 生成 prependContext；按条累加直至达到 maxChars（至少尽量放入第一条）。
 */
function buildMemoryInjectBlock(
  sentences: MemoryExtractedSentence[],
  maxChars: number,
): { text: string; ids: number[]; truncated: boolean } {
  const header =
    `${MEMOK_MEMORY_INJECT_MARKER}以下为从本地记忆库抽样得到的句子，**未必与当前问题相关**。\n` +
    "请自行判断是否采用；若采用请在回复中自然使用这些信息。\n" +
    "若确实采用了其中某些条目，请在本轮内调用工具 `memok_report_used_memory_ids`，传入对应 `id` 数组；若全部未采用则**不要调用**该工具。\n\n";

  const ids: number[] = [];
  let body = "";
  let truncated = false;
  const wrapOverhead =
    MEMOK_INJECT_START.length + MEMOK_INJECT_END.length + 2; // 两侧各一换行
  const innerBudget = Math.max(0, maxChars - wrapOverhead);
  const restBudget = Math.max(0, innerBudget - header.length);
  for (const s of sentences) {
    const line = `${formatOneMemoryLine(s)}\n`;
    if (body.length + line.length > restBudget) {
      if (body.length === 0 && line.length > restBudget) {
        body = `${line.slice(0, Math.max(0, restBudget - 1))}…\n`;
        ids.push(s.id);
        truncated = true;
        break;
      }
      truncated = true;
      break;
    }
    body += line;
    ids.push(s.id);
  }
  const inner = scrubOpenclawHeartbeatArtifacts(header + body);
  const text = `${MEMOK_INJECT_START}\n${inner}\n${MEMOK_INJECT_END}`;
  return { text, ids, truncated };
}

function appendFeedbackJsonl(
  logPath: string,
  row: { ts: string; sessionKey?: string; sessionId?: string; sentenceIds: number[] },
): void {
  const dir = dirname(logPath);
  mkdirSync(dir, { recursive: true });
  appendFileSync(logPath, `${JSON.stringify(row)}\n`, "utf-8");
}

const INITIAL_TURN_WINDOW = 12;
const MAX_AGENT_END_CHARS = 3000;

function shortHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = Math.imul(31, h) + s.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(16);
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: string }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  if (content != null) {
    return String(content);
  }
  return "";
}

function oneLineSnippet(s: string, maxChars: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  if (one.length <= maxChars) {
    return one;
  }
  return `${one.slice(0, maxChars)}...`;
}

function collectLabeledTurns(messages: unknown[]): string[] {
  const lines: string[] = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") {
      continue;
    }
    const msg = m as Record<string, unknown>;
    const role = msg.role;
    if (role !== "user" && role !== "assistant") {
      continue;
    }
    const text = extractTextFromContent(msg.content).trim();
    if (!text) {
      continue;
    }
    const label = role === "user" ? "用户" : "OpenClaw";
    lines.push(`${label}: ${text}`);
  }
  return lines;
}

function stripFencedCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, "[代码块已省略]");
}

function clampToLastChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return text.slice(-maxChars);
}

export default definePluginEntry({
  id: "memok-ai",
  name: "Memok AI Memory",
  description: "自动保存 OpenClaw 对话到 memok-ai 记忆系统",

  register(api) {
    const fromEntry = api.config.plugins?.entries?.["memok-ai"] as MemokConfig | undefined;
    const pluginCfg = {
      ...(fromEntry && typeof fromEntry === "object" ? fromEntry : {}),
      ...(api.pluginConfig && typeof api.pluginConfig === "object" ? api.pluginConfig : {}),
    } as MemokConfig;

    if (pluginCfg.enabled === false) {
      api.logger?.info("[memok-ai] 已禁用");
      return;
    }

    const dbPath = expandUserPath(pluginCfg.dbPath || getDefaultDbPath());
    const memoryInjectEnabled = pluginCfg.memoryInjectEnabled !== false;
    const extractFraction = pluginCfg.extractFraction ?? 0.2;
    const longTermFraction = pluginCfg.longTermFraction ?? extractFraction;
    const maxInjectChars = Math.max(512, pluginCfg.maxInjectChars ?? 12_000);
    const memoryFeedbackLogPath = expandUserPath(
      pluginCfg.memoryFeedbackLogPath || getDefaultMemoryFeedbackLogPath(),
    );

    api.logger?.info(`[memok-ai] 已启用，数据库: ${dbPath}`);
    if (memoryInjectEnabled) {
      api.logger?.info(
        `[memok-ai] 记忆注入: fraction=${extractFraction}, longTermFraction=${longTermFraction}, maxInjectChars=${maxInjectChars}`,
      );
    }
    api.logger?.info(`[memok-ai] 记忆反馈日志: ${memoryFeedbackLogPath}`);

    const persistTranscriptToMemory =
      pluginCfg.persistTranscriptToMemory === true ||
      (pluginCfg.persistTranscriptToMemory !== false && !memoryInjectEnabled);
    if (!persistTranscriptToMemory) {
      api.logger?.info(
        "[memok-ai] persistTranscriptToMemory 为关闭（默认与 memoryInjectEnabled 同时开启时关闭），对话不会写入 SQLite；仅注入/工具反馈仍可用。需要落库请设 persistTranscriptToMemory: true。",
      );
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
        api.logger?.debug?.(`[memok-ai] 跳过写入 SQLite (${source})，len=${stripped.length}`);
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
        api.logger?.error(`[memok-ai] 保存记忆失败 (${source}): ${msg}; input_file=${debugFile}; input_len=${stripped.length}`);
        savedKeys.delete(dedupeKey);
      }
    };

    if (memoryInjectEnabled) {
      api.on("before_prompt_build", (_event, ctx) => {
        try {
          const out = extractMemorySentencesByWordSample(dbPath, {
            fraction: extractFraction,
            longTermFraction,
          });
          if (out.sentences.length === 0) {
            return;
          }
          const { text, ids, truncated } = buildMemoryInjectBlock(out.sentences, maxInjectChars);
          const sessionMemKey = ctx.sessionKey ?? ctx.sessionId ?? "unknown";
          pruneMemoryCandidateMap();
          memoryCandidateIdsBySession.set(sessionMemKey, { ids, at: Date.now() });
          if (truncated) {
            api.logger?.info(
              `[memok-ai] 记忆注入已截断: session=${sessionMemKey}, ids=${ids.length}, maxInjectChars=${maxInjectChars}`,
            );
          }
          return { prependContext: text };
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          api.logger?.warn?.(`[memok-ai] 记忆注入跳过: ${msg}`);
        }
      });
    }

    api.registerTool((toolCtx) => {
      return {
        name: "memok_report_used_memory_ids",
        label: "Memok 记忆反馈",
        description:
          "当你在本轮回复中**确实使用**了 `@@@MEMOK_RECALL_START@@@` … `@@@MEMOK_RECALL_END@@@` 包裹的候选记忆条目时，调用此工具上报所采用句子的数字 id（列表中的 [id=…]）。若未使用任何候选记忆，则不要调用。",
        parameters: ReportUsedMemoryIdsParams,
        async execute(_toolCallId, params: { sentenceIds?: number[] }) {
          const raw = params?.sentenceIds;
          const sentenceIds = Array.isArray(raw)
            ? raw.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0)
            : [];
          const sessionMemKey = toolCtx.sessionKey ?? toolCtx.sessionId ?? "unknown";
          const candidate = memoryCandidateIdsBySession.get(sessionMemKey);
          if (sentenceIds.length > 0 && candidate?.ids?.length) {
            const allowed = new Set(candidate.ids);
            const outsiders = sentenceIds.filter((id) => !allowed.has(id));
            if (outsiders.length > 0) {
              api.logger?.warn?.(
                `[memok-ai] memok_report_used_memory_ids: 部分 id 不在本轮候选内: ${outsiders.join(", ")}`,
              );
            }
          }
          if (sentenceIds.length > 0) {
            try {
              appendFeedbackJsonl(memoryFeedbackLogPath, {
                ts: new Date().toISOString(),
                sessionKey: toolCtx.sessionKey,
                sessionId: toolCtx.sessionId,
                sentenceIds,
              });
            } catch (error: unknown) {
              const msg = error instanceof Error ? error.message : String(error);
              api.logger?.error(`[memok-ai] 写入记忆反馈日志失败: ${msg}`);
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `写入反馈日志失败：${msg}`,
                  },
                ],
                details: { error: true, sentenceIds },
              };
            }
          }
          const text =
            sentenceIds.length === 0
              ? "未上报任何 id（空数组）。若你未使用候选记忆，这是正确的；若使用了请传入对应 id。"
              : `已记录 ${sentenceIds.length} 个句子 id 到反馈日志。`;
          return {
            content: [{ type: "text" as const, text }],
            details: { recorded: sentenceIds.length, sentenceIds },
          };
        },
      };
    }, { name: "memok_report_used_memory_ids" });

    // 主路径：整轮 agent 结束，使用“增量游标”避免重复传输全量历史
    api.on("agent_end", (event, ctx) => {
      if (!event.success) {
        return;
      }
      const turns = collectLabeledTurns(event.messages ?? []);
      if (turns.length === 0) {
        return;
      }
      const sessionId = ctx.sessionKey ?? ctx.sessionId ?? "nosession";
      const state = sessionProgress.get(sessionId);
      let startIdx = 0;
      if (!state) {
        // 首次：只取最近窗口，避免一次性传超长历史
        startIdx = Math.max(0, turns.length - INITIAL_TURN_WINDOW);
      } else if (turns.length <= state.lastCount) {
        // 无新增回合
        return;
      } else {
        // 正常增量：仅发送上次游标之后的部分；若历史发生重写则回退到窗口模式
        const prevPrefixHash = shortHash(turns.slice(0, state.lastCount).join("\n\n"));
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
      const dedupeKey = ctx.runId
        ? `ae:${ctx.runId}`
        : `ae:${sessionId}:${startIdx}:${turns.length}:${shortHash(transcript)}`;

      // 无论是否成功，都推进游标，保证“已传输过的部分不重复传输”
      sessionProgress.set(sessionId, {
        lastCount: turns.length,
        prefixHash: shortHash(turns.join("\n\n")),
      });

      void runSave(dedupeKey, transcript, "agent_end");
    });

    // 兜底：部分渠道出站未必走 agent_end 同一套语义时，仍可在投递完成后保存（仅助手正文）
    api.on("message_sent", (event, ctx) => {
      if (!event.success) {
        return;
      }
      const content = event.content?.trim() ?? "";
      if (!content) {
        return;
      }
      const dedupeKey = `ms:${ctx.conversationId ?? event.to}:${content.slice(0, 280)}`;
      void runSave(dedupeKey, `OpenClaw:\n${content}`, "message_sent");
    });
  },
});
