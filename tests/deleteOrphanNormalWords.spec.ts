import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { deleteOrphanNormalWords } from "../src/dreaming-pipeline/story-word-sentence-pipeline/deleteOrphanNormalWords.js";

function makeDb(root: string): string {
  const dbPath = join(root, "orphan-nw.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE words (id INTEGER PRIMARY KEY, word TEXT);
    CREATE TABLE normal_words (id INTEGER PRIMARY KEY, word TEXT);
    CREATE TABLE sentences (id INTEGER PRIMARY KEY, sentence TEXT);
    CREATE TABLE word_to_normal_link (word_id INTEGER, normal_id INTEGER, weight INTEGER);
    CREATE TABLE sentence_to_normal_link (normal_id INTEGER, sentence_id INTEGER, weight INTEGER);
  `);
  db.prepare("INSERT INTO words (id, word) VALUES (1, 'a')").run();
  db.prepare("INSERT INTO sentences (id, sentence) VALUES (1, 's')").run();
  // N1: orphan (no links)
  // N2: only sentence link -> keep
  // N3: word link -> keep
  // N4: orphan
  db.prepare(
    "INSERT INTO normal_words (id, word) VALUES (1,'N1'),(2,'N2'),(3,'N3'),(4,'N4')",
  ).run();
  db.prepare(
    "INSERT INTO sentence_to_normal_link (normal_id, sentence_id, weight) VALUES (2, 1, 1)",
  ).run();
  db.prepare(
    "INSERT INTO word_to_normal_link (word_id, normal_id, weight) VALUES (1, 3, 1)",
  ).run();
  db.close();
  return dbPath;
}

describe("deleteOrphanNormalWords", () => {
  it("deletes only normal_words with no word and no sentence links", {
    timeout: 15000,
  }, () => {
    const root = mkdtempSync(join(tmpdir(), "memok-orphan-nw-"));
    try {
      const dbPath = makeDb(root);
      const out = deleteOrphanNormalWords(dbPath);
      expect(out.count).toBe(2);
      expect(out.ids.sort((a, b) => a - b)).toEqual([1, 4]);

      const db = new Database(dbPath, { readonly: true });
      const ids = db
        .prepare("SELECT id FROM normal_words ORDER BY id")
        .all() as { id: number }[];
      db.close();
      expect(ids.map((r) => r.id)).toEqual([2, 3]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
