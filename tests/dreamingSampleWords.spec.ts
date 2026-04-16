import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { sampleWordStrings } from "../src/dreaming-pipeline/sampleWordStrings.js";

function mkWordsDb(dir: string, words: string[]): string {
  const dbPath = join(dir, "w.sqlite");
  const db = new Database(dbPath);
  db.exec("CREATE TABLE words (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT UNIQUE);");
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
      db.exec("CREATE TABLE words (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT UNIQUE);");
      db.close();
      expect(() => sampleWordStrings(dbPath)).toThrow(/words 表为空/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("with one row and default fraction returns that single word", () => {
    const root = mkdtempSync(join(tmpdir(), "memok-dream-"));
    try {
      const dbPath = mkWordsDb(root, ["solo"]);
      const out = sampleWordStrings(dbPath);
      expect(out).toEqual(["solo"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("k = max(1, round(n * fraction)) and samples are subset of table", () => {
    const root = mkdtempSync(join(tmpdir(), "memok-dream-"));
    try {
      const all = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
      const dbPath = mkWordsDb(root, all);
      // n=10, fraction=0.2 -> k=2
      const out = sampleWordStrings(dbPath, { fraction: 0.2 });
      expect(out.length).toBe(2);
      const set = new Set(all);
      for (const w of out) {
        expect(set.has(w)).toBe(true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fraction=1 yields all words (order random)", () => {
    const root = mkdtempSync(join(tmpdir(), "memok-dream-"));
    try {
      const all = ["x", "y", "z"];
      const dbPath = mkWordsDb(root, all);
      const out = sampleWordStrings(dbPath, { fraction: 1 });
      expect(out.length).toBe(3);
      expect(new Set(out)).toEqual(new Set(all));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
