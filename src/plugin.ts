import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { saveTextToMemoryDb } from "./memory/saveTextToMemoryDb.js";
import { writeFileSync } from "node:fs";

function getDefaultDbPath(): string {
  return (
    process.env.MEMOK_MEMORY_DB ||
    `${process.env.HOME || "/home/wik20"}/.openclaw/extensions/memok-ai/memok.sqlite`
  );
}

interface MemokConfig {
  dbPath?: string;
  enabled?: boolean;
}

const savedKeys = new Set<string>();
const sessionProgress = new Map<string, { lastCount: number; prefixHash: string }>();
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

    const dbPath = pluginCfg.dbPath || getDefaultDbPath();
    api.logger?.info(`[memok-ai] 已启用，数据库: ${dbPath}`);

    const runSave = async (
      dedupeKey: string,
      text: string,
      source: "agent_end" | "message_sent",
    ): Promise<void> => {
      const stripped = text.trim();
      if (!stripped) {
        return;
      }
      if (savedKeys.has(dedupeKey)) {
        return;
      }
      savedKeys.add(dedupeKey);
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
