import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as dotenvConfig } from "dotenv";
import type OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";

const ENV_SKIP_STRUCTURED_PARSE = "MEMOK_SKIP_LLM_STRUCTURED_PARSE";
const ENV_LLM_MAX_WORKERS = "MEMOK_LLM_MAX_WORKERS";
const MAX_WORKERS_CAP = 64;

function findProjectRoot(startDir: string): string {
  let current = startDir;
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(current, "package.json");
    if (existsSync(candidate)) {
      return current;
    }
    const next = dirname(current);
    if (next === current) {
      break;
    }
    current = next;
  }
  return startDir;
}

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = findProjectRoot(join(CURRENT_DIR, "..", ".."));

export function loadProjectEnv(): void {
  dotenvConfig({ path: join(PROJECT_ROOT, ".env"), override: false });
}

export function llmMaxWorkers(): number {
  const raw = (process.env[ENV_LLM_MAX_WORKERS] ?? "").trim();
  if (!raw) {
    return 1;
  }
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 1) {
    return 1;
  }
  return Math.min(n, MAX_WORKERS_CAP);
}

export function preferJsonObjectOnly(): boolean {
  const flag = (process.env[ENV_SKIP_STRUCTURED_PARSE] ?? "")
    .trim()
    .toLowerCase();
  if (["1", "true", "yes", "on"].includes(flag)) {
    return true;
  }
  const base = (process.env.OPENAI_BASE_URL ?? "").toLowerCase();
  return base.includes("deepseek");
}

export function isDeepseekCompatibleBaseUrl(): boolean {
  const base = (process.env.OPENAI_BASE_URL ?? "").trim().toLowerCase();
  return base.includes("deepseek");
}

function isStructuredResponseUnsupported(err: unknown): boolean {
  const anyErr = err as {
    status?: number;
    statusCode?: number;
    message?: string;
    error?: { message?: string };
  };
  const status = anyErr.statusCode ?? anyErr.status;
  if (status !== 400) {
    return false;
  }
  const blob = JSON.stringify(err).toLowerCase();
  const signals = [
    "response_format",
    "json_schema",
    "structured output",
    "structured_output",
    "unavailable",
  ];
  if (signals.some((s) => blob.includes(s))) {
    return true;
  }
  const msg = (anyErr.error?.message ?? anyErr.message ?? "").toLowerCase();
  return signals.some((s) => msg.includes(s));
}

function compactSnippet(s: string, maxChars: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxChars) {
    return oneLine;
  }
  return `${oneLine.slice(0, maxChars)}...`;
}

function extractJsonErrorPosition(msg: string): number | undefined {
  const m = msg.match(/position\s+(\d+)/i);
  if (!m) {
    return undefined;
  }
  const n = Number.parseInt(m[1], 10);
  return Number.isFinite(n) ? n : undefined;
}

function buildJsonParseDebug(raw: string, error: unknown): string {
  const errMsg = error instanceof Error ? error.message : String(error);
  const pos = extractJsonErrorPosition(errMsg);
  const prefix = compactSnippet(raw.slice(0, 300), 300);
  const suffix = compactSnippet(raw.slice(-300), 300);
  let around = "";
  if (pos !== undefined) {
    const lo = Math.max(0, pos - 120);
    const hi = Math.min(raw.length, pos + 120);
    around = compactSnippet(raw.slice(lo, hi), 240);
  }
  return [
    `json_parse_error=${errMsg}`,
    `raw_length=${raw.length}`,
    `raw_prefix=${JSON.stringify(prefix)}`,
    `raw_suffix=${JSON.stringify(suffix)}`,
    ...(around ? [`raw_around_pos=${JSON.stringify(around)}`] : []),
  ].join("; ");
}

type Message = { role: "system" | "user" | "assistant"; content: string };

type RunParseOrJsonParams<T> = {
  client: OpenAI;
  model: string;
  messagesParse: Message[];
  messagesJson: Message[];
  schema: z.ZodType<T>;
  responseName: string;
  maxCompletionTokens?: number;
  maxTokens?: number;
};

export async function runParseOrJson<T>(
  params: RunParseOrJsonParams<T>,
): Promise<T> {
  const {
    client,
    model,
    messagesParse,
    messagesJson,
    schema,
    responseName,
    maxCompletionTokens,
    maxTokens,
  } = params;
  if (maxCompletionTokens !== undefined && maxTokens !== undefined) {
    throw new Error("maxCompletionTokens 与 maxTokens 请勿同时传入");
  }
  const tokenKw: Record<string, number> = {};
  if (maxCompletionTokens !== undefined) {
    tokenKw.max_completion_tokens = maxCompletionTokens;
  } else if (maxTokens !== undefined) {
    tokenKw.max_tokens = maxTokens;
  }

  const callJsonObject = async (): Promise<T> => {
    const completion = await client.chat.completions.create({
      model,
      messages: messagesJson,
      response_format: { type: "json_object" },
      ...tokenKw,
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      throw new Error("LLM returned empty content in json_object mode");
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (error) {
      const debug = buildJsonParseDebug(raw, error);
      throw new Error(
        `LLM returned invalid JSON in json_object mode (${responseName}/${model}): ${debug}`,
      );
    }
    return schema.parse(parsedJson);
  };

  if (preferJsonObjectOnly()) {
    return callJsonObject();
  }

  try {
    const completion = await client.chat.completions.parse({
      model,
      messages: messagesParse,
      response_format: zodResponseFormat(schema, responseName),
      ...tokenKw,
    });
    const message = completion.choices[0]?.message;
    if (message?.refusal) {
      throw new Error(`model refused: ${message.refusal}`);
    }
    if (!message?.parsed) {
      throw new Error("LLM returned no parsed structured output");
    }
    return schema.parse(message.parsed);
  } catch (err) {
    if (!isStructuredResponseUnsupported(err)) {
      throw err;
    }
    return callJsonObject();
  }
}
