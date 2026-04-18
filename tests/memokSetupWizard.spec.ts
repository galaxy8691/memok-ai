import { describe, expect, it } from "vitest";
import {
  isValidDailyAt,
  type MemokSetupAnswers,
  mergeMemokSetupToConfig,
} from "../src/plugin/setupWizard.js";

type MergedPlugins = {
  entries?: Record<
    string,
    { enabled?: boolean; config?: Record<string, unknown> }
  >;
  slots?: { memory?: string };
};

function pluginsShape(out: unknown): MergedPlugins | undefined {
  return (out as { plugins?: MergedPlugins }).plugins;
}

describe("setupWizard helpers", () => {
  it("validates HH:mm format", () => {
    expect(isValidDailyAt("03:00")).toBe(true);
    expect(isValidDailyAt("23:59")).toBe(true);
    expect(isValidDailyAt("24:00")).toBe(false);
    expect(isValidDailyAt("3:00")).toBe(false);
  });

  it("merges setup answers into memok config", () => {
    const cur = {
      plugins: {
        entries: {
          "memok-ai": {
            enabled: false,
            config: {
              dbPath: "/tmp/m.db",
              memoryInjectEnabled: true,
            },
          },
        },
      },
    } as Record<string, unknown>;

    const answers: MemokSetupAnswers = {
      llmProvider: "deepseek",
      llmApiKey: "sk-1",
      llmModelPreset: "deepseek-chat",
      dreamingPipelineScheduleEnabled: true,
      dreamingPipelineDailyAt: "03:00",
      dreamingPipelineTimezone: "Asia/Shanghai",
    };
    const out = mergeMemokSetupToConfig(cur, answers);
    const entry = pluginsShape(out)?.entries?.["memok-ai"];
    const memok = entry?.config;
    expect(entry?.enabled).toBe(true);
    expect(memok?.dbPath).toBe("/tmp/m.db");
    expect(memok?.llmProvider).toBe("deepseek");
    expect(memok?.llmModelPreset).toBe("deepseek-chat");
    expect(memok?.dreamingPipelineDailyAt).toBe("03:00");
    expect(pluginsShape(out)?.slots?.memory).toBe("memok-ai");
  });

  it("removes undefined optional values", () => {
    const answers: MemokSetupAnswers = {
      llmProvider: "custom",
      llmBaseUrl: "https://x/v1",
      llmApiKey: undefined,
      llmModel: "",
      llmModelPreset: undefined,
      dreamingPipelineScheduleEnabled: false,
    };
    const out = mergeMemokSetupToConfig({}, answers);
    const memok = pluginsShape(out)?.entries?.["memok-ai"]?.config;
    expect(memok?.llmProvider).toBe("custom");
    expect(memok?.llmBaseUrl).toBe("https://x/v1");
    expect(memok?.llmApiKey).toBeUndefined();
    expect(memok?.llmModel).toBeUndefined();
    expect(pluginsShape(out)?.slots?.memory).toBe("memok-ai");
  });

  it("always sets memory slot to memok-ai (exclusive)", () => {
    const cur = {
      plugins: {
        slots: { memory: "memory-core" },
      },
    } as Record<string, unknown>;
    const answers: MemokSetupAnswers = {
      llmProvider: "inherit",
      dreamingPipelineScheduleEnabled: false,
    };
    const out = mergeMemokSetupToConfig(cur, answers);
    expect(pluginsShape(out)?.slots?.memory).toBe("memok-ai");
  });
});
