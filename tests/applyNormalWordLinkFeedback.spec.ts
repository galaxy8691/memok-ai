import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyNormalWordLinkFeedback } from "../src/dreaming-pipeline/story-word-sentence-pipeline/applyNormalWordLinkFeedback.js";

function makeDb(root: string): string {
  const dbPath = join(root, "nw-fb.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE words (id INTEGER PRIMARY KEY, word TEXT UNIQUE);
    CREATE TABLE normal_words (id INTEGER PRIMARY KEY, word TEXT);
    CREATE TABLE word_to_normal_link (word_id INTEGER, normal_id INTEGER, weight INTEGER);
  `);
  db.prepare(
    "INSERT INTO words (id, word) VALUES (1, 'alpha'), (2, 'beta')",
  ).run();
  db.prepare(
    "INSERT INTO normal_words (id, word) VALUES (101, 'N101'), (102, 'N102'), (103, 'N103'), (201, 'N201')",
  ).run();
  // N101: links from word 1 and 2, high bucket target
  db.prepare(
    "INSERT INTO word_to_normal_link (word_id, normal_id, weight) VALUES (1, 101, 2), (2, 101, 1)",
  ).run();
  // N102: only word 1, low bucket -> minus
  db.prepare(
    "INSERT INTO word_to_normal_link (word_id, normal_id, weight) VALUES (1, 102, 1)",
  ).run();
  // N103: conflict (both plus and minus lists) -> skip
  db.prepare(
    "INSERT INTO word_to_normal_link (word_id, normal_id, weight) VALUES (1, 103, 3)",
  ).run();
  db.close();
  return dbPath;
}

describe("applyNormalWordLinkFeedback", () => {
  it("updates only links for story words; plus on high normal_id; minus and delete <=0; skip conflicts", {
    timeout: 15000,
  }, () => {
    const root = mkdtempSync(join(tmpdir(), "memok-nw-fb-"));
    try {
      const dbPath = makeDb(root);
      const stats = applyNormalWordLinkFeedback(dbPath, {
        words: ["alpha", "beta"],
        normalWordBuckets: {
          id_ge_60: [101, 103, 201],
          id_ge_40_lt_60: [],
          id_lt_40: [102, 103],
        },
      });
      expect(stats.matchedWordIds).toBe(2);
      expect(stats.skippedConflicts).toBe(1);
      expect(stats.targetedPlusNormalWords).toBe(2);
      expect(stats.targetedMinusNormalWords).toBe(1);
      // 101: two existing links +1; 201: no links -> 2 inserts (alpha+beta)
      expect(stats.updatedPlus).toBe(2);
      expect(stats.insertedPlusLinks).toBe(2);
      // 102: (1,102) 1->0 then deleted => 1 update 1 delete
      expect(stats.updatedMinus).toBe(1);
      expect(stats.deleted).toBe(1);

      const db = new Database(dbPath, { readonly: true });
      const rows = db
        .prepare(
          "SELECT word_id, normal_id, weight FROM word_to_normal_link ORDER BY normal_id, word_id",
        )
        .all() as { word_id: number; normal_id: number; weight: number }[];
      db.close();
      expect(rows).toEqual([
        { word_id: 1, normal_id: 101, weight: 3 },
        { word_id: 2, normal_id: 101, weight: 2 },
        { word_id: 1, normal_id: 103, weight: 3 },
        { word_id: 1, normal_id: 201, weight: 1 },
        { word_id: 2, normal_id: 201, weight: 1 },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
