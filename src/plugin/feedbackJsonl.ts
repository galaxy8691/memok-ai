import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function appendFeedbackJsonl(
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
