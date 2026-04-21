import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { sampleNormalWordsForRelevance } from "../src/dreaming-pipeline/story-word-sentence-pipeline/sampleNormalWordsForRelevance.js";

function makeDb(root: string): string {
  const dbPath = join(root, "nw-sample.sqlite");
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE normal_words (id INTEGER PRIMARY KEY, word TEXT);`);
  for (let i = 1; i <= 10; i += 1) {
    db.prepare("INSERT INTO normal_words (id, word) VALUES (?, ?)").run(
      i,
      `w${i}`,
    );
  }
  db.close();
  return dbPath;
}

describe("sampleNormalWordsForRelevance", () => {
  it("samples about fraction of rows with at least 1", () => {
    const root = mkdtempSync(join(tmpdir(), "memok-nw-"));
    try {
      const dbPath = makeDb(root);
      const rows = sampleNormalWordsForRelevance(dbPath, { fraction: 0.2 });
      expect(rows.length).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
