import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMemokPluginLlmEnv } from "../src/plugin/applyMemokPluginLlmEnv.js";

const KEYS = ["OPENAI_API_KEY", "OPENAI_BASE_URL", "MEMOK_LLM_MODEL"] as const;

describe("applyMemokPluginLlmEnv", () => {
  const snapshot: Partial<Record<(typeof KEYS)[number], string | undefined>> =
    {};

  beforeEach(() => {
    for (const k of KEYS) {
      snapshot[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      const v = snapshot[k];
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  it("sets api key, preset base url, and model when env empty", () => {
    applyMemokPluginLlmEnv({
      llmProvider: "deepseek",
      llmApiKey: "sk-test",
      llmModel: "deepseek-chat",
    });
    expect(process.env.OPENAI_API_KEY).toBe("sk-test");
    expect(process.env.OPENAI_BASE_URL).toBe("https://api.deepseek.com/v1");
    expect(process.env.MEMOK_LLM_MODEL).toBe("deepseek-chat");
  });

  it("does not override existing env", () => {
    process.env.OPENAI_API_KEY = "existing";
    process.env.OPENAI_BASE_URL = "https://example.com/v1";
    process.env.MEMOK_LLM_MODEL = "m1";
    applyMemokPluginLlmEnv({
      llmProvider: "deepseek",
      llmApiKey: "sk-test",
      llmModel: "deepseek-chat",
    });
    expect(process.env.OPENAI_API_KEY).toBe("existing");
    expect(process.env.OPENAI_BASE_URL).toBe("https://example.com/v1");
    expect(process.env.MEMOK_LLM_MODEL).toBe("m1");
  });

  it("uses custom base url when llmProvider is custom", () => {
    applyMemokPluginLlmEnv({
      llmProvider: "custom",
      llmBaseUrl: "https://my.proxy/v1",
      llmApiKey: "k",
    });
    expect(process.env.OPENAI_BASE_URL).toBe("https://my.proxy/v1");
    expect(process.env.OPENAI_API_KEY).toBe("k");
  });

  it("falls back to llmModelPreset when llmModel is empty", () => {
    applyMemokPluginLlmEnv({
      llmProvider: "openai",
      llmModelPreset: "gpt-4o-mini",
    });
    expect(process.env.MEMOK_LLM_MODEL).toBe("gpt-4o-mini");
  });
});
