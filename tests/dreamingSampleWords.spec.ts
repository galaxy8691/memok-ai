import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { sampleWordStrings } from "../src/dreaming-pipeline/story-word-sentence-pipeline/sampleWordStrings.js";

function mkWordsDb(dir: string, words: string[]): string {
  const dbPath = join(dir, "w.sqlite");
  const db = new Database(dbPath);
  db.exec(
    "CREATE TABLE words (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT UNIQUE);",
  );
  const ins = db.prepare("INSERT INTO words (word) VALUES (?)");
  for (const w of words) {
    ins.run(w);
  }
  db.close();
  return dbPath;
}

describe("sampleWordStrings", () => {
  it("throws when words table is empty", () => {
    const root = mkdtempSync(join(tmpdir(), "memok-dream-"));
    try {
      const dbPath = join(root, "empty.sqlite");
      const db = new Database(dbPath);
      db.exec(
        "CREATE TABLE words (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT UNIQUE);",
      );
      db.close();
      expect(() => sampleWordStrings(dbPath)).toThrow(/words 表为空/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("with one row returns that single word", () => {
    const root = mkdtempSync(join(tmpdir(), "memok-dream-"));
    try {
      const dbPath = mkWordsDb(root, ["solo"]);
      const out = sampleWordStrings(dbPath);
      expect(out).toEqual(["solo"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("default caps at 10 words when table has more", { timeout: 15000 }, () => {
    const root = mkdtempSync(join(tmpdir(), "memok-dream-"));
    try {
      const all = Array.from({ length: 25 }, (_, i) => `w${i}`);
      const dbPath = mkWordsDb(root, all);
      const out = sampleWordStrings(dbPath);
      expect(out.length).toBe(10);
      const set = new Set(all);
      for (const w of out) {
        expect(set.has(w)).toBe(true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns all rows when fewer than maxWords", () => {
    const root = mkdtempSync(join(tmpdir(), "memok-dream-"));
    try {
      const all = ["a", "b", "c"];
      const dbPath = mkWordsDb(root, all);
      const out = sampleWordStrings(dbPath, { maxWords: 10 });
      expect(out.length).toBe(3);
      expect(new Set(out)).toEqual(new Set(all));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("maxWords overrides cap", () => {
    const root = mkdtempSync(join(tmpdir(), "memok-dream-"));
    try {
      const all = Array.from({ length: 20 }, (_, i) => `x${i}`);
      const dbPath = mkWordsDb(root, all);
      const out = sampleWordStrings(dbPath, { maxWords: 5 });
      expect(out.length).toBe(5);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
