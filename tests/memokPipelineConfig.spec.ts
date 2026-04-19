import { afterEach, describe, expect, it } from "vitest";
import {
  buildPipelineContext,
  memokPipelineConfigFromProcessEnv,
} from "../src/config/memokPipelineConfig.js";

describe("memokPipelineConfigFromProcessEnv", () => {
  const prev: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    for (const k of Object.keys(prev)) {
      delete prev[k];
    }
  });

  function setEnv(key: string, value: string) {
    if (!(key in prev)) {
      prev[key] = process.env[key];
    }
    process.env[key] = value;
  }

  it("builds config and context from process.env", () => {
    setEnv("OPENAI_API_KEY", "sk-test");
    setEnv("OPENAI_BASE_URL", "https://api.openai.com/v1");
    setEnv("MEMOK_LLM_MODEL", "gpt-4o-mini");
    setEnv("MEMOK_LLM_MAX_WORKERS", "4");
    setEnv("MEMOK_V2_ARTICLE_SENTENCES_MAX_OUTPUT_TOKENS", "4096");
    setEnv("MEMOK_CORE_WORDS_NORMALIZE_MAX_OUTPUT_TOKENS", "16384");
    setEnv("MEMOK_SENTENCE_MERGE_MAX_COMPLETION_TOKENS", "1024");
    const cfg = memokPipelineConfigFromProcessEnv();
    expect(cfg.dbPath).toBe("./memok.sqlite");
    expect(cfg.llmModel).toBe("gpt-4o-mini");
    expect(cfg.llmMaxWorkers).toBe(4);
    expect(cfg.articleSentencesMaxOutputTokens).toBe(4096);
    expect(cfg.coreWordsNormalizeMaxOutputTokens).toBe(16384);
    expect(cfg.sentenceMergeMaxCompletionTokens).toBe(1024);
    const ctx = buildPipelineContext(cfg);
    expect(ctx.client).toBeDefined();
    expect(ctx.config.openaiApiKey).toBe("sk-test");
  });

  it("throws when OPENAI_API_KEY is missing", () => {
    setEnv("OPENAI_API_KEY", "");
    expect(() => memokPipelineConfigFromProcessEnv()).toThrow(/OPENAI_API_KEY/);
  });

  it("uses MEMOK_DB_PATH when set", () => {
    setEnv("OPENAI_API_KEY", "sk-test");
    setEnv("MEMOK_DB_PATH", "/tmp/memok.sqlite");
    const cfg = memokPipelineConfigFromProcessEnv();
    expect(cfg.dbPath).toBe("/tmp/memok.sqlite");
  });
});
