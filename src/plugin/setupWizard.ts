import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

export type MemokLlmProvider =
  | "inherit"
  | "openai"
  | "deepseek"
  | "openrouter"
  | "moonshot"
  | "siliconflow"
  | "ollama"
  | "custom";

const PROVIDERS: MemokLlmProvider[] = [
  "inherit",
  "openai",
  "deepseek",
  "openrouter",
  "moonshot",
  "siliconflow",
  "ollama",
  "custom",
];

const PRESET_BY_PROVIDER: Record<
  Exclude<MemokLlmProvider, "inherit" | "custom">,
  string[]
> = {
  openai: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-4.1-nano", "gpt-4o"],
  deepseek: ["deepseek-chat", "deepseek-v3"],
  openrouter: ["openai/gpt-4o-mini", "openai/gpt-4.1-mini"],
  moonshot: ["moonshot-v1-8k", "moonshot-v1-32k"],
  siliconflow: ["Qwen/Qwen2.5-7B-Instruct", "deepseek-ai/DeepSeek-V3"],
  ollama: ["qwen2.5:7b-instruct", "llama3.1:8b-instruct"],
};

export type MemokSetupAnswers = {
  llmProvider: MemokLlmProvider;
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmModelPreset?: string;
  llmModel?: string;
  dreamingPipelineScheduleEnabled: boolean;
  dreamingPipelineDailyAt?: string;
  dreamingPipelineTimezone?: string;
};

export function isValidDailyAt(v: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v.trim());
}

function toYes(v: string, fallback: boolean): boolean {
  const t = v.trim().toLowerCase();
  if (!t) return fallback;
  return ["y", "yes", "1", "true", "on"].includes(t);
}

function clean(v: string): string | undefined {
  const t = v.trim();
  return t ? t : undefined;
}

async function pickByNumber(
  ask: (q: string) => Promise<string>,
  title: string,
  rows: string[],
  defaultIndex: number,
): Promise<number> {
  while (true) {
    const options = rows.map((x, i) => `${i + 1}) ${x}`).join("\n");
    const raw = await ask(
      `${title}\n${options}\n选择 [默认 ${defaultIndex + 1}]: `,
    );
    const t = raw.trim();
    if (!t) return defaultIndex;
    const n = Number.parseInt(t, 10);
    if (Number.isInteger(n) && n >= 1 && n <= rows.length) {
      return n - 1;
    }
  }
}

export async function promptMemokSetupAnswers(): Promise<MemokSetupAnswers> {
  const rl = createInterface({ input, output });
  const ask = (q: string) => rl.question(q);
  try {
    const pIdx = await pickByNumber(
      ask,
      "选择 LLM 供应商：",
      PROVIDERS.map((p) => p),
      0,
    );
    const llmProvider = PROVIDERS[pIdx];

    let llmModelPreset: string | undefined;
    if (llmProvider !== "inherit" && llmProvider !== "custom") {
      const presets = PRESET_BY_PROVIDER[llmProvider];
      const mIdx = await pickByNumber(
        ask,
        "选择模型预设（推荐非 reasoning/think）：",
        presets,
        0,
      );
      llmModelPreset = presets[mIdx];
    }

    const llmModel = clean(
      await ask(
        `可选：手填 llmModel（留空=沿用上一步预设${llmModelPreset ? `：${llmModelPreset}` : ""}）: `,
      ),
    );
    const llmApiKey = clean(await ask("可选：API Key（留空则沿用环境变量）: "));
    const llmBaseUrl =
      llmProvider === "custom"
        ? clean(
            await ask(
              "custom 模式请填写 Base URL（如 https://api.xxx.com/v1）: ",
            ),
          )
        : undefined;
    const dreamingOn = toYes(
      await ask("是否启用 dreaming 定时任务？(Y/n): "),
      true,
    );
    let dreamingPipelineDailyAt: string | undefined;
    let dreamingPipelineTimezone: string | undefined;
    if (dreamingOn) {
      while (true) {
        const raw =
          (await ask("每日触发时间 HH:mm [默认 03:00]: ")).trim() || "03:00";
        if (isValidDailyAt(raw)) {
          dreamingPipelineDailyAt = raw;
          break;
        }
      }
      dreamingPipelineTimezone = clean(
        await ask("可选：时区（如 Asia/Shanghai，留空使用系统时区）: "),
      );
    }

    if (llmProvider === "custom" && !llmBaseUrl) {
      throw new Error("llmProvider=custom 时必须提供 llmBaseUrl");
    }

    return {
      llmProvider,
      llmApiKey,
      llmBaseUrl,
      llmModelPreset,
      llmModel,
      dreamingPipelineScheduleEnabled: dreamingOn,
      dreamingPipelineDailyAt,
      dreamingPipelineTimezone,
    };
  } finally {
    rl.close();
  }
}

export function mergeMemokSetupToConfig(
  cfg: Record<string, unknown>,
  answers: MemokSetupAnswers,
): Record<string, unknown> {
  const root = cfg ?? {};
  const plugins = (root.plugins as Record<string, unknown> | undefined) ?? {};
  const entries =
    (plugins.entries as Record<string, unknown> | undefined) ?? {};
  const slots = (plugins.slots as Record<string, unknown> | undefined) ?? {};
  const curEntry =
    (entries["memok-ai"] as Record<string, unknown> | undefined) ?? {};
  const curCfg = (curEntry.config as Record<string, unknown> | undefined) ?? {};

  const nextPluginCfg: Record<string, unknown> = {
    ...curCfg,
    llmProvider: answers.llmProvider,
    llmApiKey: answers.llmApiKey,
    llmBaseUrl: answers.llmBaseUrl,
    llmModelPreset: answers.llmModelPreset,
    llmModel: answers.llmModel,
    dreamingPipelineScheduleEnabled: answers.dreamingPipelineScheduleEnabled,
    dreamingPipelineDailyAt: answers.dreamingPipelineDailyAt,
    dreamingPipelineTimezone: answers.dreamingPipelineTimezone,
  };

  // Remove undefined keys to keep config concise.
  for (const [k, v] of Object.entries(nextPluginCfg)) {
    if (v === undefined || v === "") {
      delete nextPluginCfg[k];
    }
  }

  // Wizard only sets HH:mm; drop stale cron so it cannot override dailyAt at runtime.
  if (
    answers.dreamingPipelineScheduleEnabled === true &&
    answers.dreamingPipelineDailyAt
  ) {
    delete nextPluginCfg.dreamingPipelineCron;
  }

  const nextSlots: Record<string, unknown> = { ...slots };
  // 向导固定把 memory 槽交给 memok-ai，避免网关侧「槽位仍是 memory-core」导致插件不生效、发梦不跑。
  nextSlots.memory = "memok-ai";

  return {
    ...root,
    plugins: {
      ...plugins,
      slots: nextSlots,
      entries: {
        ...entries,
        "memok-ai": {
          ...curEntry,
          enabled: true,
          config: nextPluginCfg,
        },
      },
    },
  };
}
