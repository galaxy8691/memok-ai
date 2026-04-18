import { copyFileSync, existsSync } from "node:fs";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { loadProjectEnv } from "./llm/openaiCompat.js";
import { applyMemokPluginLlmEnv } from "./plugin/applyMemokPluginLlmEnv.js";
import {
  expandUserPath,
  getDefaultDbPath,
  type MemokConfig,
  type MemokPluginEntry,
  resolveMemokDbPathFromConfig,
} from "./plugin/memokTypes.js";
import {
  type MemokRuntimeContext,
  registerMemokPluginRuntime,
} from "./plugin/registerMemokPluginRuntime.js";
import {
  mergeMemokSetupToConfig,
  promptMemokSetupAnswers,
} from "./plugin/setupWizard.js";

export default definePluginEntry({
  id: "memok-ai",
  name: "Memok AI Memory",
  description: "自动保存 OpenClaw 对话到 memok-ai 记忆系统",

  register(api: any) {
    api.registerCli(
      ({ program }: any) => {
        const memok = program
          .command("memok")
          .description("memok-ai plugin commands");
        memok
          .command("setup")
          .description(
            "Interactive setup for llm provider/model and dreaming schedule",
          )
          .action(async () => {
            const runtimeConfig = api.runtime?.config;
            if (!runtimeConfig?.loadConfig || !runtimeConfig?.writeConfigFile) {
              throw new Error(
                "memok setup unavailable: runtime config API not ready",
              );
            }
            const answers = await promptMemokSetupAnswers();
            const cur = runtimeConfig.loadConfig() as unknown as Record<
              string,
              unknown
            >;
            const next = mergeMemokSetupToConfig(cur, answers);
            await runtimeConfig.writeConfigFile(next);
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
                "- plugins.slots.memory=memok-ai（向导固定独占 memory 槽）",
                `- dreamingSchedule=${answers.dreamingPipelineScheduleEnabled ? `on @ ${answers.dreamingPipelineDailyAt ?? "03:00"}` : "off"}`,
                copiedFromClean
                  ? `- 已从 ${cleanPath} 复制初始库到 ${dbPath}`
                  : `- 未找到 ${cleanPath}，跳过初始库复制`,
                "",
                "请重启 gateway 使新配置生效。",
              ].join("\n"),
            );
          });
      },
      { commands: ["memok"] },
    );

    api.registerCommand({
      name: "memok",
      description: "Show memok setup help",
      acceptsArgs: true,
      handler: async (ctx: any) => {
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

    const entry = api.config.plugins?.entries?.["memok-ai"] as
      | MemokPluginEntry
      | undefined;
    const manifestDefaults =
      api.pluginConfig && typeof api.pluginConfig === "object"
        ? (api.pluginConfig as Record<string, unknown>)
        : {};
    const entryConfig =
      entry?.config && typeof entry.config === "object"
        ? (entry.config as Record<string, unknown>)
        : {};
    const baseDefaults = { ...manifestDefaults };
    // Manifest default `dreamingPipelineCron` is "0 3 * * *". If the user only set
    // `dreamingPipelineDailyAt` in openclaw.json (wizard), omitting cron must not
    // inherit that default — otherwise dailyAt is silently ignored.
    const userCron = entryConfig.dreamingPipelineCron;
    const hasUserCron =
      typeof userCron === "string" && userCron.trim().length > 0;
    const hasUserDailyAt =
      typeof entryConfig.dreamingPipelineDailyAt === "string" &&
      entryConfig.dreamingPipelineDailyAt.trim().length > 0;
    if (hasUserDailyAt && !hasUserCron) {
      delete baseDefaults.dreamingPipelineCron;
    }
    const pluginCfg = {
      ...baseDefaults,
      ...entryConfig,
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
    let memoryRecallMode: MemokConfig["memoryRecallMode"];
    if (
      rawMode === "prepend" ||
      rawMode === "skill" ||
      rawMode === "skill+hint"
    ) {
      memoryRecallMode = rawMode;
    } else {
      api.logger?.warn?.(
        `[memok-ai] 未知 memoryRecallMode=${String(rawMode)}，按 skill 处理`,
      );
      memoryRecallMode = "skill";
    }
    const extractFraction = pluginCfg.extractFraction ?? 0.2;
    const longTermFraction = pluginCfg.longTermFraction ?? extractFraction;
    const maxInjectChars = Math.max(512, pluginCfg.maxInjectChars ?? 12_000);
    api.logger?.info(`[memok-ai] 已启用，数据库: ${dbPath}`);
    if (memoryInjectEnabled) {
      api.logger?.info(
        `[memok-ai] 记忆召回: mode=${memoryRecallMode}, fraction=${extractFraction}, longTermFraction=${longTermFraction}, maxInjectChars=${maxInjectChars}`,
      );
    }
    const persistTranscriptToMemory =
      pluginCfg.persistTranscriptToMemory !== false;
    if (pluginCfg.persistTranscriptToMemory === false) {
      api.logger?.info(
        "[memok-ai] persistTranscriptToMemory 已显式关闭，对话不会写入 SQLite（仅注入/工具反馈仍可用）。",
      );
    }

    const runtimeCtx: MemokRuntimeContext = {
      pluginCfg,
      dbPath,
      memoryInjectEnabled,
      memoryRecallMode,
      extractFraction,
      longTermFraction,
      maxInjectChars,
      persistTranscriptToMemory,
    };
    registerMemokPluginRuntime(api, runtimeCtx);
  },
});
