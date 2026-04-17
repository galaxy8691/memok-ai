import { describe, expect, it } from "vitest";
import {
  isValidDailyAt,
  mergeMemokSetupToConfig,
  type MemokSetupAnswers,
} from "../src/plugin/setupWizard.js";

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
      memorySlotExclusive: true,
      dreamingPipelineScheduleEnabled: true,
      dreamingPipelineDailyAt: "03:00",
      dreamingPipelineTimezone: "Asia/Shanghai",
    };
    const out = mergeMemokSetupToConfig(cur, answers);
    const memok = ((out.plugins as any).entries["memok-ai"] as any).config;
    expect(((out.plugins as any).entries["memok-ai"] as any).enabled).toBe(true);
    expect(memok.dbPath).toBe("/tmp/m.db");
    expect(memok.llmProvider).toBe("deepseek");
    expect(memok.llmModelPreset).toBe("deepseek-chat");
    expect(memok.dreamingPipelineDailyAt).toBe("03:00");
    expect(((out.plugins as any).slots as any).memory).toBe("memok-ai");
  });

  it("removes undefined optional values", () => {
    const answers: MemokSetupAnswers = {
      llmProvider: "custom",
      llmBaseUrl: "https://x/v1",
      llmApiKey: undefined,
      llmModel: "",
      llmModelPreset: undefined,
      memorySlotExclusive: false,
      dreamingPipelineScheduleEnabled: false,
    };
    const out = mergeMemokSetupToConfig({}, answers);
    const memok = ((out.plugins as any).entries["memok-ai"] as any).config;
    expect(memok.llmProvider).toBe("custom");
    expect(memok.llmBaseUrl).toBe("https://x/v1");
    expect(memok.llmApiKey).toBeUndefined();
    expect(memok.llmModel).toBeUndefined();
  });

  it("removes memok slot when non-exclusive selected", () => {
    const cur = {
      plugins: {
        slots: { memory: "memok-ai" },
      },
    } as Record<string, unknown>;
    const answers: MemokSetupAnswers = {
      llmProvider: "inherit",
      memorySlotExclusive: false,
      dreamingPipelineScheduleEnabled: false,
    };
    const out = mergeMemokSetupToConfig(cur, answers);
    expect(((out.plugins as any).slots as any).memory).toBeUndefined();
  });
});
