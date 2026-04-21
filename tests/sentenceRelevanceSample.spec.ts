import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { sampleSentencesForRelevance } from "../src/dreaming-pipeline/story-word-sentence-pipeline/sampleSentencesForRelevance.js";

function mkSentencesDb(dir: string, n: number): string {
  const dbPath = join(dir, "s.sqlite");
  const db = new Database(dbPath);
  db.exec(
    "CREATE TABLE sentences (id INTEGER PRIMARY KEY AUTOINCREMENT, sentence TEXT);",
  );
  const ins = db.prepare("INSERT INTO sentences (sentence) VALUES (?)");
  for (let i = 0; i < n; i += 1) {
    ins.run(`s-${i}`);
  }
  db.close();
  return dbPath;
}

describe("sampleSentencesForRelevance", () => {
  it("throws when sentences table is empty", () => {
    const root = mkdtempSync(join(tmpdir(), "memok-rel-sample-"));
    try {
      const dbPath = mkSentencesDb(root, 0);
      expect(() => sampleSentencesForRelevance(dbPath)).toThrow(
        /sentences 表为空/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses k = max(1, round(n * fraction))", () => {
    const root = mkdtempSync(join(tmpdir(), "memok-rel-sample-"));
    try {
      const dbPath = mkSentencesDb(root, 10);
      const out = sampleSentencesForRelevance(dbPath, { fraction: 0.2 });
      expect(out).toHaveLength(2);
      for (const row of out) {
        expect(Number.isInteger(row.id)).toBe(true);
        expect(typeof row.sentence).toBe("string");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("still returns one sentence when n is small", () => {
    const root = mkdtempSync(join(tmpdir(), "memok-rel-sample-"));
    try {
      const dbPath = mkSentencesDb(root, 3);
      const out = sampleSentencesForRelevance(dbPath, { fraction: 0.2 });
      expect(out).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
