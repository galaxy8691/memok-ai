import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { saveTextToMemoryDb } from "./memory/saveTextToMemoryDb.js";

// 默认数据库路径
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

// 简单的内存缓存，避免重复保存同一条消息
const savedMessages = new Set<string>();

export default definePluginEntry({
  id: "memok-ai",
  name: "Memok AI Memory",
  description: "自动保存 OpenClaw 对话到 memok-ai 记忆系统",

  async register(api) {
    const config = api.config as MemokConfig;

    if (config.enabled === false) {
      api.logger?.info("[memok-ai] 已禁用");
      return;
    }

    const dbPath = config.dbPath || getDefaultDbPath();

    api.logger?.info(`[memok-ai] 已启用，数据库: ${dbPath}`);

    // Hook: 出站消息投递完成后再保存（见 OpenClaw message_sent）
    api.on("message_sent", async (event, ctx) => {
      try {
        if (!event.success) {
          return;
        }

        const content = event.content?.trim() ?? "";
        if (!content) {
          return;
        }

        // 避免重复保存（message_sent 不提供稳定 messageId，用会话 + 内容前缀近似去重）
        const dedupeKey = `${ctx.conversationId ?? event.to}:${content.slice(0, 240)}`;
        if (savedMessages.has(dedupeKey)) {
          return;
        }
        savedMessages.add(dedupeKey);

        // 出站 event 仅含已发送正文，不含用户侧上文；需要「整轮对话」时请改用 agent_end 等钩子组合
        const conversation = `OpenClaw:\n${content}`;

        api.logger?.info("[memok-ai] 正在生成记忆锚点...");
        await saveTextToMemoryDb(conversation, { dbPath });

        api.logger?.info("[memok-ai] 记忆已保存");
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        api.logger?.error(`[memok-ai] 保存记忆失败: ${msg}`);
      }
    });
  },
});
