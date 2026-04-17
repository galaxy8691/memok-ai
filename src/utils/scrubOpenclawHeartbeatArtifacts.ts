import type {
  ArticleCoreWordsNomalizedData,
  ArticleSentenceCoreCombinedData,
} from "../article-word-pipeline/v2/schemas.js";

/**
 * 剥离 OpenClaw 网关常见的心跳 / 定时提醒模板（易随对话写入记忆库，下一轮又注入，误触 HEARTBEAT_OK 等语义）。
 * 在子串断字之前执行。
 */
function scrubOpenclawHeartbeatTemplates(text: string): string {
  let s = text;
  // 英文默认心跳指令（整段；允许贴在文首无前置换行）
  s = s.replace(
    /(^|[\r\n])\s*Read HEARTBEAT\.md if it exists \(workspace context\)\. Follow it strictly\. Do not infer or repeat old tasks from prior chats\. If nothing needs attention, reply HEARTBEAT_OK\.\s*/gim,
    "\n",
  );
  // 定时提醒：从触发句到 workspace 路径说明（含中间「提醒正文」）
  s = s.replace(
    /(^|[\r\n])\s*A scheduled reminder has been triggered\.[\s\S]*?When reading HEARTBEAT\.md, use workspace file[^\n]*\s*/gim,
    "\n",
  );
  // 单独出现的 workspace 路径行 / 勿读文档行 / 内部处理说明
  s = s.replace(
    /(^|[\r\n])\s*When reading HEARTBEAT\.md, use workspace file[^\n]*\s*/gim,
    "\n",
  );
  s = s.replace(/(^|[\r\n])\s*Do not read docs\/heartbeat\.md\.?\s*/gim, "\n");
  s = s.replace(
    /(^|[\r\n])\s*Handle this reminder internally[^\n]*\s*/gim,
    "\n",
  );
  s = s.replace(/(^|[\r\n])\s*The reminder content is:\s*/gim, "\n");
  // 中文「执行 HEARTBEAT.md 检查清单」整块（可含多行 System: 前缀列表）
  s = s.replace(
    /执行 HEARTBEAT\.md 检查清单[：:][\s\S]*?完成后报告结果。\s*/g,
    "",
  );
  // 去掉孤立的 `System:` 空行噪声
  s = s.replace(/(^|[\r\n])System:\s*(?=[\r\n]|$)/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/**
 * OpenClaw 对 `HEARTBEAT_OK`、`HEARTBEAT.md` 及心跳轮次有特殊语义；
 * 正文若含相同子串，易在下游（插件 / 网关）被误触发。先删模板再对残留子串断字。
 */
export function scrubOpenclawHeartbeatArtifacts(text: string): string {
  let t = scrubOpenclawHeartbeatTemplates(text);
  t = t.replace(/HEARTBEAT_OK/gi, "HEARTBEAT\u200B_OK");
  t = t.replace(/HEARTBEAT\.md/gi, "HEARTBEAT\u200B.md");
  t = t.replace(/\bHEARTBEAT\b/gi, "HEART\u200DBEAT");
  return t;
}

/** 对 v2 二元组中所有用户可见字符串字段做 HEARTBEAT* 脱敏（写入 SQLite / 插件前调用）。 */
export function scrubHeartbeatInAwpTuple(
  tuple: readonly [
    ArticleSentenceCoreCombinedData,
    ArticleCoreWordsNomalizedData,
  ],
): [ArticleSentenceCoreCombinedData, ArticleCoreWordsNomalizedData] {
  const [sc, nm] = tuple;
  return [
    {
      sentence_core: sc.sentence_core.map((item) => ({
        sentence: scrubOpenclawHeartbeatArtifacts(item.sentence),
        core_words: item.core_words.map((w) =>
          scrubOpenclawHeartbeatArtifacts(w),
        ),
      })),
    },
    {
      nomalized: nm.nomalized.map((p) => ({
        original_text: scrubOpenclawHeartbeatArtifacts(p.original_text),
        new_text: scrubOpenclawHeartbeatArtifacts(p.new_text),
      })),
    },
  ];
}
