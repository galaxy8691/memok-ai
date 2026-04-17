import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { mergeOrphanSentencesIntoTopScored } from "../src/dreaming-pipeline/story-word-sentence-pipeline/mergeOrphanSentencesIntoTopScored.js";

function makeDb(root: string): string {
  const dbPath = join(root, "orphan.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE sentences (id INTEGER PRIMARY KEY, sentence TEXT, weight INTEGER, duration INTEGER);
    CREATE TABLE sentence_to_normal_link (normal_id INTEGER, sentence_id INTEGER, weight INTEGER);
  `);
  db.prepare(
    "INSERT INTO sentences (id, sentence, weight, duration) VALUES (1,'top',1,1),(2,'orphan A',1,1),(3,'orphan B',1,1),(4,'linked keep',1,1)",
  ).run();
  db.prepare(
    "INSERT INTO sentence_to_normal_link (normal_id, sentence_id, weight) VALUES (9,1,1),(9,4,1)",
  ).run();
  db.close();
  return dbPath;
}

describe("mergeOrphanSentencesIntoTopScored", () => {
  it("merges orphans into top sentence and deletes orphans", async () => {
    const root = mkdtempSync(join(tmpdir(), "memok-orphan-"));
    try {
      const dbPath = makeDb(root);
      const resultPath = join(root, "result.json");
      writeFileSync(
        resultPath,
        JSON.stringify({
          relevance: {
            sentences: [
              { id: 1, score: 99 },
              { id: 2, score: 20 },
              { id: 3, score: 10 },
              { id: 4, score: 88 },
            ],
          },
        }),
        "utf-8",
      );
      const out = await mergeOrphanSentencesIntoTopScored(dbPath, resultPath, {
        mergeFn: async (base, orphan) => `${base} + ${orphan}`,
      });
      expect(out.topSentenceId).toBe(1);
      expect(out.orphansFound).toBe(2);
      expect(out.mergedCount).toBe(2);
      expect(out.deletedCount).toBe(2);

      const db = new Database(dbPath, { readonly: true });
      const rows = db
        .prepare("SELECT id, sentence FROM sentences ORDER BY id")
        .all() as { id: number; sentence: string }[];
      db.close();
      expect(rows.map((r) => r.id)).toEqual([1, 4]);
      expect(rows[0].sentence).toBe("top + orphan A + orphan B");
      expect(rows[1].sentence).toBe("linked keep");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
