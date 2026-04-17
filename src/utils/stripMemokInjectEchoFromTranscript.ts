/** 旧版注入标题（无定界符）；落库时仍尝试剥离，兼容历史消息。 */
export const MEMOK_MEMORY_INJECT_MARKER = "【memok-ai 候选记忆】";

/**
 * 与 `buildMemoryInjectBlock` 配对：整段候选记忆包在起止标记之间，便于 transcript 落库时整段删除，避免回灌 SQLite。
 * 选用 `@@@` + 固定 token，降低与正文偶然碰撞的概率。
 */
export const MEMOK_INJECT_START = "@@@MEMOK_RECALL_START@@@";
export const MEMOK_INJECT_END = "@@@MEMOK_RECALL_END@@@";

function stripDelimitedMemokBlocks(text: string): string {
  let out = text;
  for (;;) {
    const start = out.indexOf(MEMOK_INJECT_START);
    if (start === -1) {
      break;
    }
    const afterStart = start + MEMOK_INJECT_START.length;
    const end = out.indexOf(MEMOK_INJECT_END, afterStart);
    if (end === -1) {
      // 有起点无终点：剥到下一轮对话或文末，避免半段残留
      const tail = out.slice(afterStart);
      const m = /\n\n((?:User|用户):|OpenClaw:)/.exec(tail);
      const cut = m ? start + MEMOK_INJECT_START.length + m.index : out.length;
      out = `${out.slice(0, start).replace(/\s+$/, "")}${out.slice(cut)}`;
      break;
    }
    const afterEnd = end + MEMOK_INJECT_END.length;
    out = `${out.slice(0, start).replace(/\s+$/, "")}${out.slice(afterEnd)}`;
  }
  return out;
}

/**
 * 从 transcript 中移除本插件注入的候选记忆：
 * 1) `@@@MEMOK_RECALL_START@@@` … `@@@MEMOK_RECALL_END@@@` 整段；
 * 2) 旧版从 `【memok-ai 候选记忆】` 到下一轮 `User:`/`用户:`/`OpenClaw:` 之前。
 */
export function stripMemokInjectEchoFromTranscript(text: string): string {
  let out = stripDelimitedMemokBlocks(text);
  for (;;) {
    const idx = out.indexOf(MEMOK_MEMORY_INJECT_MARKER);
    if (idx === -1) {
      break;
    }
    const tail = out.slice(idx);
    const m = /\n\n((?:User|用户):|OpenClaw:)/.exec(tail);
    const removeEnd = idx + (m ? m.index : tail.length);
    out = `${out.slice(0, idx).replace(/\s+$/, "")}${out.slice(removeEnd)}`;
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}
