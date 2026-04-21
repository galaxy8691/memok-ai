import type OpenAI from "openai";
import type { z } from "zod";
import { runParseOrJson } from "../../llm/openaiCompat.js";

export const DEFAULT_MAX_OUTPUT = 4096;
export const DEEPSEEK_CHAT_MAX_TOKENS_CAP = 8192;
export const DEFAULT_MAX_LLM_ATTEMPTS = 5;
export const HARD_CAP_LLM_ATTEMPTS = 32;
export const MAX_ITEMS_PER_BATCH = 50;

export function clampScore0to100(n: number): number {
  const r = Math.round(Number(n));
  if (!Number.isFinite(r)) {
    return 50;
  }
  return Math.max(0, Math.min(100, r));
}

export function effectiveOutputBudget(
  forDeepseek: boolean,
  explicit?: number,
): number {
  const cap = explicit ?? DEFAULT_MAX_OUTPUT;
  if (forDeepseek) {
    return Math.max(1, Math.min(cap, DEEPSEEK_CHAT_MAX_TOKENS_CAP));
  }
  return Math.max(256, Math.min(cap, 128_000));
}

export function resolveMaxLlmAttempts(raw?: string): number {
  if (!raw) {
    return DEFAULT_MAX_LLM_ATTEMPTS;
  }
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 1) {
    return DEFAULT_MAX_LLM_ATTEMPTS;
  }
  return Math.min(n, HARD_CAP_LLM_ATTEMPTS);
}

export type ScoreOneBatchOpts = {
  client: OpenAI;
  model: string;
  budget: number;
  deepseek: boolean;
  preferJsonObjectOnly?: boolean;
};

export type RelevanceMessages = {
  messagesParse: Array<{ role: "system" | "user"; content: string }>;
  messagesJson: Array<{ role: "system" | "user"; content: string }>;
};

export async function scoreOneBatchWithRetry<T>(
  opts: ScoreOneBatchOpts & {
    messages: RelevanceMessages;
    schema: z.ZodType<T>;
    responseName: string;
    validate: (raw: T) => T;
    repair: (raw: T) => T;
    maxAttempts: number;
  },
): Promise<T> {
  const {
    client,
    model,
    budget,
    deepseek,
    preferJsonObjectOnly,
    messages,
    schema,
    responseName,
    validate,
    repair,
    maxAttempts,
  } = opts;

  const tokenKw: Record<string, number> = {};
  if (deepseek) {
    tokenKw.max_tokens = budget;
  } else {
    tokenKw.max_completion_tokens = budget;
  }

  const parseArgs = {
    client,
    model,
    messagesParse: messages.messagesParse,
    messagesJson: messages.messagesJson,
    schema,
    responseName,
    ...tokenKw,
    ...(preferJsonObjectOnly !== undefined ? { preferJsonObjectOnly } : {}),
  };

  let lastError: unknown;
  let lastRaw: T | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const raw = await runParseOrJson(parseArgs);
    lastRaw = raw;
    try {
      return validate(raw);
    } catch (e) {
      lastError = e;
    }
  }
  if (lastRaw) {
    return validate(repair(lastRaw));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function validateRelevanceIds(
  inputItems: Array<{ id: number }>,
  outputItems: Array<{ id: number }>,
  itemName: string,
): void {
  if (outputItems.length !== inputItems.length) {
    throw new Error(
      `${itemName} 相关性评分条数不一致: input=${inputItems.length}, output=${outputItems.length}`,
    );
  }
  const inIds = new Set(inputItems.map((s) => s.id));
  const outIds = new Set(outputItems.map((s) => s.id));
  if (inIds.size !== outIds.size) {
    throw new Error(`${itemName} 相关性评分 id 数量不一致`);
  }
  for (const id of inIds) {
    if (!outIds.has(id)) {
      throw new Error(`${itemName} 相关性评分缺少输入 id=${id}`);
    }
  }
  for (const id of outIds) {
    if (!inIds.has(id)) {
      throw new Error(`${itemName} 相关性评分出现未输入 id=${id}`);
    }
  }
}

export function buildRelevanceScoresById(
  outputItems: Array<{ id: number; score: unknown }>,
): Map<number, number> {
  const byId = new Map<number, number>();
  for (const row of outputItems) {
    if (Number.isFinite(row.id)) {
      const score = Number(row.score);
      if (Number.isFinite(score)) {
        byId.set(row.id, clampScore0to100(score));
      }
    }
  }
  return byId;
}

export function computeFallbackScore(byId: Map<number, number>): number {
  if (byId.size === 0) {
    return 50;
  }
  let sum = 0;
  for (const v of byId.values()) {
    sum += v;
  }
  return Math.round(sum / byId.size);
}

export function repairRelevanceScores(
  inputIds: number[],
  byId: Map<number, number>,
  fallback: number,
): { id: number; score: number }[] {
  return inputIds.map((id) => ({
    id,
    score: byId.has(id) ? (byId.get(id) ?? fallback) : fallback,
  }));
}
