import { Type } from "@sinclair/typebox";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { saveTextToMemoryDb } from "./memory/saveTextToMemoryDb.js";
import { applySentenceUsageFeedback } from "./sqlite/applySentenceUsageFeedback.js";
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
import { loadProjectEnv } from "./llm/openaiCompat.js";
import type { RunDreamingPipelineFromDbOpts } from "./dreaming-pipeline/runDreamingPipelineFromDb.js";
import { applyMemokPluginLlmEnv, type MemokLlmEnvConfig } from "./plugin/applyMemokPluginLlmEnv.js";
import { registerDreamingPipelineCron } from "./plugin/registerDreamingPipelineCron.js";
import { mergeMemokSetupToConfig, promptMemokSetupAnswers } from "./plugin/setupWizard.js";

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

function resolveMemokDbPathFromConfig(root: Record<string, unknown>): string {
  const plugins = (root.plugins as Record<string, unknown> | undefined) ?? {};
  const entries = (plugins.entries as Record<string, unknown> | undefined) ?? {};
  const entry = (entries["memok-ai"] as Record<string, unknown> | undefined) ?? {};
  const cfg = (entry.config as Record<string, unknown> | undefined) ?? {};
  const raw = typeof cfg.dbPath === "string" ? cfg.dbPath : "";
  return expandUserPath(raw || getDefaultDbPath());
}

function isMemokSetupCliRun(): boolean {
  const argv = process.argv.map((x) => x.toLowerCase());
  const memokIdx = argv.lastIndexOf("memok");
  if (memokIdx < 0) return false;
  return argv[memokIdx + 1] === "setup";
}

/** `plugins.entries.memok-ai.config` 与 manifest 字段对应 */
interface MemokConfig extends MemokLlmEnvConfig {
  dbPath?: string;
  /** 与网关 entry 顶层的 `enabled` 同义时可出现在 config 内 */
  enabled?: boolean;
  /** 是否启用候选记忆能力（默认 true；具体送达方式见 memoryRecallMode） */
  memoryInjectEnabled?: boolean;
  /**
   * skill=每轮 appendSystemContext 强制附带候选 + 工具自愿再抽样；
   * skill+hint=同上并额外 prepend 一行极短提示（对话区可见，无大块定界正文）；
   * prepend=整块 prependContext（旧行为）。
   */
  memoryRecallMode?: "skill" | "skill+hint" | "prepend";
  extractFraction?: number;
  longTermFraction?: number;
  maxInjectChars?: number;
  /** 模型上报已用句子 id 时追加的 JSONL（调试用，与写库并行） */
  memoryFeedbackLogPath?: string;
  /**
   * 是否在每轮结束后把对话 transcript 再跑 article 管线写入 SQLite。
   * 未设置时默认 **true**；候选记忆块由 `@@@MEMOK_RECALL_*@@@` 定界，落库前会整段剥离，一般无需关闭。
   */
  persistTranscriptToMemory?: boolean;
  /**
   * 是否在**网关进程内**按 cron 调度执行 `dreaming-pipeline`（predream + story-word-sentence，会调 LLM）。
   * 默认 **false**，需显式 `true` 才启用。
   */
  dreamingPipelineScheduleEnabled?: boolean;
  /** 每日触发时间（`HH:mm`，如 `03:00`）；仅在未设置 `dreamingPipelineCron` 时生效 */
  dreamingPipelineDailyAt?: string;
  /** 5 段 cron，默认每天本地/指定时区 **03:00**（`0 3 * * *`） */
  dreamingPipelineCron?: string;
  /** IANA 时区（如 `Asia/Shanghai`）；不设则由 croner 按本机解释 */
  dreamingPipelineTimezone?: string;
  /** 传给 story 段，同 CLI `dreaming-pipeline` */
  dreamingPipelineMaxWords?: number;
  dreamingPipelineFraction?: number;
  dreamingPipelineMinRuns?: number;
  dreamingPipelineMaxRuns?: number;
}

/** 网关 `plugins.entries.memok-ai`：顶层 `enabled`，选项在 `config` */
interface MemokPluginEntry {
  enabled?: boolean;
  config?: MemokConfig;
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

const RecallCandidateMemoriesParams = Type.Object({});

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

type RecallStoreResult =
  | { kind: "empty" }
  | { kind: "block"; text: string; ids: number[]; truncated: boolean };

/**
 * 抽样并写入本轮 session 的候选 id，供 prepend / 工具 / 反馈校验共用。
 */
function recallAndStoreCandidates(
  dbPath: string,
  extractFraction: number,
  longTermFraction: number,
  maxInjectChars: number,
  sessionMemKey: string,
): RecallStoreResult {
  const out = extractMemorySentencesByWordSample(dbPath, {
    fraction: extractFraction,
    longTermFraction,
  });
  if (out.sentences.length === 0) {
    pruneMemoryCandidateMap();
    memoryCandidateIdsBySession.set(sessionMemKey, { ids: [], at: Date.now() });
    return { kind: "empty" };
  }
  const built = buildMemoryInjectBlock(out.sentences, maxInjectChars);
  pruneMemoryCandidateMap();
  memoryCandidateIdsBySession.set(sessionMemKey, { ids: built.ids, at: Date.now() });
  return {
    kind: "block",
    text: built.text,
    ids: built.ids,
    truncated: built.truncated,
  };
}

function appendFeedbackJsonl(
  logPath: string,
  row: {
    ts: string;
    sessionKey?: string;
    sessionId?: string;
    sentenceIds: number[];
    validIds: number[];
    updatedCount: number;
    dbError?: string;
  },
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

function cronPatternFromDailyAt(
  raw: unknown,
  logger?: { warn?: (msg: string) => void },
): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const t = raw.trim();
  if (!t) {
    return undefined;
  }
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) {
    logger?.warn?.(`[memok-ai] dreamingPipelineDailyAt 格式无效（期望 HH:mm）：${t}`);
    return undefined;
  }
  const hour = Number.parseInt(m[1], 10);
  const minute = Number.parseInt(m[2], 10);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    logger?.warn?.(`[memok-ai] dreamingPipelineDailyAt 超出范围（00:00~23:59）：${t}`);
    return undefined;
  }
  return `${minute} ${hour} * * *`;
}

export default definePluginEntry({
  id: "memok-ai",
  name: "Memok AI Memory",
  description: "自动保存 OpenClaw 对话到 memok-ai 记忆系统",

  register(api) {
    api.registerCli(({ program }) => {
      const memok = program.command("memok").description("memok-ai plugin commands");
      memok
        .command("setup")
        .description("Interactive setup for llm provider/model and dreaming schedule")
        .action(async () => {
          const runtimeConfig = api.runtime?.config;
          if (!runtimeConfig?.loadConfig || !runtimeConfig?.writeConfigFile) {
            throw new Error("memok setup unavailable: runtime config API not ready");
          }
          const answers = await promptMemokSetupAnswers();
          const cur = runtimeConfig.loadConfig() as unknown as Record<string, unknown>;
          const next = mergeMemokSetupToConfig(cur, answers);
          await runtimeConfig.writeConfigFile(next as any);
          const dbPath = resolveMemokDbPathFromConfig(next);
          const cleanPath = `${dbPath}.clean`;
          let copiedFromClean = false;
          if (existsSync(cleanPath)) {
            copyFileSync(cleanPath, dbPath);
            copiedFromClean = true;
          }
          console.log(
            [
              "[memok-ai] setup 完成：已写入 plugins.entries.memok-ai.config",
              `- llmProvider=${answers.llmProvider}`,
              `- model=${answers.llmModel?.trim() ? answers.llmModel.trim() : (answers.llmModelPreset ?? "(未设置)")}`,
              `- memorySlotExclusive=${answers.memorySlotExclusive ? "yes(memok-ai)" : "no"}`,
              `- dreamingSchedule=${answers.dreamingPipelineScheduleEnabled ? `on @ ${answers.dreamingPipelineDailyAt ?? "03:00"}` : "off"}`,
              copiedFromClean
                ? `- 已从 ${cleanPath} 复制初始库到 ${dbPath}`
                : `- 未找到 ${cleanPath}，跳过初始库复制`,
              "",
              "请重启 gateway 使新配置生效。",
            ].join("\n"),
          );
        });
    }, {
      descriptors: [
        {
          name: "memok",
          description: "memok-ai setup and maintenance commands",
          hasSubcommands: true,
        },
      ],
    });

    api.registerCommand({
      name: "memok",
      description: "Show memok setup help",
      acceptsArgs: true,
      handler: async (ctx) => {
        const first = (ctx.args ?? "").trim().split(/\s+/)[0] ?? "";
        if (first === "setup") {
          return {
            text: "请在网关终端执行 `openclaw memok setup` 进入交互式向导（供应商/API Key/模型/发梦时间）。",
          };
        }
        return {
          text: "用法：`/memok setup`（提示终端执行 `openclaw memok setup`）",
        };
      },
    });

    const entry = api.config.plugins?.entries?.["memok-ai"] as MemokPluginEntry | undefined;
    const pluginCfg = {
      ...(entry?.config && typeof entry.config === "object" ? entry.config : {}),
      ...(api.pluginConfig && typeof api.pluginConfig === "object" ? api.pluginConfig : {}),
    } as MemokConfig;

    if (entry?.enabled === false || pluginCfg.enabled === false) {
      api.logger?.info("[memok-ai] 已禁用");
      return;
    }

    loadProjectEnv();
    applyMemokPluginLlmEnv(pluginCfg, api.logger);
    if (
      (pluginCfg.llmProvider ?? "inherit") !== "inherit" ||
      (pluginCfg.llmApiKey ?? "").trim() ||
      (pluginCfg.llmModel ?? "").trim() ||
      (pluginCfg.llmModelPreset ?? "").trim()
    ) {
      api.logger?.info(
        "[memok-ai] 已根据插件配置尝试补齐 OPENAI_API_KEY / OPENAI_BASE_URL / MEMOK_LLM_MODEL（不覆盖已存在的环境变量）",
      );
    }

    const dbPath = expandUserPath(pluginCfg.dbPath || getDefaultDbPath());
    const memoryInjectEnabled = pluginCfg.memoryInjectEnabled !== false;
    const rawMode = pluginCfg.memoryRecallMode ?? "skill+hint";
    const memoryRecallMode: MemokConfig["memoryRecallMode"] =
      rawMode === "prepend" || rawMode === "skill" || rawMode === "skill+hint"
        ? rawMode
        : (api.logger?.warn?.(`[memok-ai] 未知 memoryRecallMode=${String(rawMode)}，按 skill 处理`),
          "skill");
    const extractFraction = pluginCfg.extractFraction ?? 0.2;
    const longTermFraction = pluginCfg.longTermFraction ?? extractFraction;
    const maxInjectChars = Math.max(512, pluginCfg.maxInjectChars ?? 12_000);
    const memoryFeedbackLogPath = expandUserPath(
      pluginCfg.memoryFeedbackLogPath || getDefaultMemoryFeedbackLogPath(),
    );
    api.logger?.info(`[memok-ai] 已启用，数据库: ${dbPath}`);
    if (memoryInjectEnabled) {
      api.logger?.info(
        `[memok-ai] 记忆召回: mode=${memoryRecallMode}, fraction=${extractFraction}, longTermFraction=${longTermFraction}, maxInjectChars=${maxInjectChars}`,
      );
      api.logger?.info(`[memok-ai] 记忆反馈 JSONL（调试）: ${memoryFeedbackLogPath}`);
    }
    const persistTranscriptToMemory = pluginCfg.persistTranscriptToMemory !== false;
    if (pluginCfg.persistTranscriptToMemory === false) {
      api.logger?.info(
        "[memok-ai] persistTranscriptToMemory 已显式关闭，对话不会写入 SQLite（仅注入/工具反馈仍可用）。",
      );
    }

    if (pluginCfg.dreamingPipelineScheduleEnabled === true) {
      if (isMemokSetupCliRun()) {
        api.logger?.info(
          "[memok-ai] 检测到 `openclaw memok setup` 交互流程，跳过 dreaming cron 注册以避免 CLI 进程常驻。",
        );
      } else {
      const rawCron = 
        typeof pluginCfg.dreamingPipelineCron === "string" && pluginCfg.dreamingPipelineCron.trim()
          ? pluginCfg.dreamingPipelineCron.trim()
          : (cronPatternFromDailyAt(pluginCfg.dreamingPipelineDailyAt, api.logger) ?? "0 3 * * *");
      const dreamingTz =
        typeof pluginCfg.dreamingPipelineTimezone === "string" && pluginCfg.dreamingPipelineTimezone.trim()
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
        pipelineOpts: Object.keys(pipelineOpts).length > 0 ? pipelineOpts : undefined,
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
          // skill / skill+hint：每轮在回复前**必定**抽样并写入候选 id；正文走 appendSystemContext（系统侧）。
          // skill+hint 另加一行极短 prependContext，便于对话区提示「有 memok + 工具」且不灌整块定界正文。
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
                prependContext: "（memok）本轮未抽到候选记忆句；若需再试可调工具 memok_recall_candidate_memories。",
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
        (toolCtx) => {
          return {
            name: "memok_recall_candidate_memories",
            label: "Memok 召回候选记忆",
            description: recallDescription,
            parameters: RecallCandidateMemoriesParams,
            async execute(_toolCallId, _params: Record<string, never>) {
              const sessionMemKey = toolCtx.sessionKey ?? toolCtx.sessionId ?? "unknown";
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
                const msg = error instanceof Error ? error.message : String(error);
                api.logger?.warn?.(`[memok-ai] memok_recall_candidate_memories 失败: ${msg}`);
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
      api.registerTool((toolCtx) => {
        const reportDescription =
          memoryRecallMode === "prepend"
            ? "当你在本轮回复中**确实使用**了 `@@@MEMOK_RECALL_START@@@` … `@@@MEMOK_RECALL_END@@@` 包裹的候选记忆条目时，调用此工具上报所采用句子的数字 id（列表中的 [id=…]）。若未使用任何候选记忆，则不要调用。"
            : "当你在本轮回复中**确实使用**了系统上下文里自动附带的候选块、或工具 `memok_recall_candidate_memories` 返回文本中的某条候选（[id=…]）时，调用此工具上报所采用句子的数字 id。未采用任何条目则不要调用。";
        return {
          name: "memok_report_used_memory_ids",
          label: "Memok 记忆反馈",
          description: reportDescription,
          parameters: ReportUsedMemoryIdsParams,
          async execute(_toolCallId, params: { sentenceIds?: number[] }) {
            const raw = params?.sentenceIds;
            const sentenceIds = Array.isArray(raw)
              ? raw.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n > 0)
              : [];
            const sessionMemKey = toolCtx.sessionKey ?? toolCtx.sessionId ?? "unknown";
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
                ({ updatedCount } = applySentenceUsageFeedback(dbPath, validIds));
              } catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                api.logger?.error(`[memok-ai] 记忆反馈写库失败: ${msg}`);
                if (sentenceIds.length > 0) {
                  try {
                    appendFeedbackJsonl(memoryFeedbackLogPath, {
                      ts: new Date().toISOString(),
                      sessionKey: toolCtx.sessionKey,
                      sessionId: toolCtx.sessionId,
                      sentenceIds,
                      validIds,
                      updatedCount: 0,
                      dbError: msg,
                    });
                  } catch (logErr: unknown) {
                    const lm = logErr instanceof Error ? logErr.message : String(logErr);
                    api.logger?.warn?.(`[memok-ai] 写记忆反馈 JSONL 失败: ${lm}`);
                  }
                }
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
            let feedbackJsonlOk = true;
            if (sentenceIds.length > 0) {
              try {
                appendFeedbackJsonl(memoryFeedbackLogPath, {
                  ts: new Date().toISOString(),
                  sessionKey: toolCtx.sessionKey,
                  sessionId: toolCtx.sessionId,
                  sentenceIds,
                  validIds,
                  updatedCount,
                });
              } catch (logErr: unknown) {
                feedbackJsonlOk = false;
                const lm = logErr instanceof Error ? logErr.message : String(logErr);
                api.logger?.warn?.(`[memok-ai] 写记忆反馈 JSONL 失败: ${lm}`);
              }
            }
            const logHint = sentenceIds.length > 0 ? (feedbackJsonlOk ? "；JSONL 调试日志已追加。" : "；JSONL 调试日志写入失败，见网关日志。") : "";
            const text =
              sentenceIds.length === 0
                ? "未上报任何 id（空数组）。若你未使用候选记忆，这是正确的；若使用了请传入对应 id。"
                : validIds.length === 0
                  ? `上报的 id 均不在本轮可校验的候选列表内，未更新数据库。${logHint}`
                  : `已更新 ${updatedCount} 条句子（weight 每次+1；跨日则当日 duration 计数从 1 起；同日 duration 最多+3 次）${logHint}`;
            return {
              content: [{ type: "text" as const, text }],
              details: {
                recorded: validIds.length,
                updatedCount,
                sentenceIds,
                validIds,
                feedbackJsonl: sentenceIds.length > 0 ? feedbackJsonlOk : undefined,
              },
            };
          },
        };
      }, { name: "memok_report_used_memory_ids" });
      api.logger?.info("[memok-ai] 已注册工具 memok_report_used_memory_ids");
    }

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
