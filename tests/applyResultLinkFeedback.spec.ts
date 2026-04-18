import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyResultLinkFeedback } from "../src/dreaming-pipeline/story-word-sentence-pipeline/applyResultLinkFeedback.js";

function makeDb(root: string): string {
  const dbPath = join(root, "fb.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE words (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT UNIQUE);
    CREATE TABLE normal_words (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT UNIQUE);
    CREATE TABLE word_to_normal_link (word_id INTEGER, normal_id INTEGER, weight INTEGER);
    CREATE TABLE sentences (id INTEGER PRIMARY KEY, sentence TEXT, weight INTEGER, duration INTEGER);
    CREATE TABLE sentence_to_normal_link (normal_id INTEGER, sentence_id INTEGER, weight INTEGER);
  `);
  db.prepare("INSERT INTO words (word) VALUES (?), (?)").run("alpha", "beta");
  db.prepare("INSERT INTO normal_words (word) VALUES (?), (?), (?)").run(
    "N1",
    "N2",
    "N3",
  );
  const w = db.prepare("SELECT id, word FROM words").all() as {
    id: number;
    word: string;
  }[];
  const n = db.prepare("SELECT id, word FROM normal_words").all() as {
    id: number;
    word: string;
  }[];
  const wid = Object.fromEntries(w.map((x) => [x.word, x.id])) as Record<
    string,
    number
  >;
  const nid = Object.fromEntries(n.map((x) => [x.word, x.id])) as Record<
    string,
    number
  >;
  db.prepare(
    "INSERT INTO word_to_normal_link (word_id, normal_id, weight) VALUES (?, ?, 1)",
  ).run(wid.alpha, nid.N1);
  db.prepare(
    "INSERT INTO word_to_normal_link (word_id, normal_id, weight) VALUES (?, ?, 1)",
  ).run(wid.beta, nid.N2);
  db.prepare(
    "INSERT INTO sentences (id, sentence, weight, duration) VALUES (101, 's101', 5, 9), (102, 's102', 2, 3), (103, 's103', 7, 1)",
  ).run();
  // sentence 101: links to N1,N2,N3
  db.prepare(
    "INSERT INTO sentence_to_normal_link (normal_id, sentence_id, weight) VALUES (?, 101, 2)",
  ).run(nid.N1);
  db.prepare(
    "INSERT INTO sentence_to_normal_link (normal_id, sentence_id, weight) VALUES (?, 101, 1)",
  ).run(nid.N2);
  db.prepare(
    "INSERT INTO sentence_to_normal_link (normal_id, sentence_id, weight) VALUES (?, 101, 7)",
  ).run(nid.N3);
  // sentence 102: links to N1,N3
  db.prepare(
    "INSERT INTO sentence_to_normal_link (normal_id, sentence_id, weight) VALUES (?, 102, 1)",
  ).run(nid.N1);
  db.prepare(
    "INSERT INTO sentence_to_normal_link (normal_id, sentence_id, weight) VALUES (?, 102, 4)",
  ).run(nid.N3);
  // sentence 103: conflict case
  db.prepare(
    "INSERT INTO sentence_to_normal_link (normal_id, sentence_id, weight) VALUES (?, 103, 3)",
  ).run(nid.N1);
  db.close();
  return dbPath;
}

describe("applyResultLinkFeedback", () => {
  it("updates only matched normal_ids, applies +/- and deletes <=0, skip conflicts", {
    timeout: 15000,
  }, () => {
    const root = mkdtempSync(join(tmpdir(), "memok-fb-"));
    try {
      const dbPath = makeDb(root);
      const stats = applyResultLinkFeedback(dbPath, {
        words: ["alpha", "beta"], // hit N1,N2 (not N3)
        buckets: {
          words: ["alpha", "beta"],
          id_ge_60: [101, 103],
          id_ge_40_lt_60: [],
          id_lt_40: [102, 103], // 103 conflict -> skipped
        },
      });
      expect(stats.matchedNormalIds).toBe(2);
      expect(stats.updatedSentenceRows).toBe(1);
      expect(stats.skippedConflicts).toBe(1);
      expect(stats.targetedPlusSentences).toBe(1);
      expect(stats.targetedMinusSentences).toBe(1);
      // plus on sentence 101 for N1/N2 => 2 updates, 0 new links
      expect(stats.updatedPlus).toBe(2);
      expect(stats.insertedPlusSentenceLinks).toBe(0);
      // minus on sentence 102 for N1/N2 (only N1 exists) => 1 row
      expect(stats.updatedMinus).toBe(1);
      // 102-N1 goes 1->0 then deleted
      expect(stats.deleted).toBe(1);

      const db = new Database(dbPath, { readonly: true });
      const coreRows = db
        .prepare("SELECT id, weight, duration FROM sentences ORDER BY id")
        .all() as { id: number; weight: number; duration: number }[];
      const rows = db
        .prepare(
          "SELECT sentence_id, normal_id, weight FROM sentence_to_normal_link ORDER BY sentence_id, normal_id",
        )
        .all() as {
        sentence_id: number;
        normal_id: number;
        weight: number;
      }[];
      db.close();
      // sentence core: 101 gets +1/+1, 103 conflict skip, 102 low-score does not change core
      expect(coreRows).toEqual([
        { id: 101, weight: 6, duration: 10 },
        { id: 102, weight: 2, duration: 3 },
        { id: 103, weight: 7, duration: 1 },
      ]);
      // sentence 101: N1 3, N2 2, N3 unchanged 7
      const s101 = rows
        .filter((r) => r.sentence_id === 101)
        .map((r) => r.weight);
      expect(s101).toEqual([3, 2, 7]);
      // sentence 102: N1 deleted, N3 unchanged 4
      const s102 = rows
        .filter((r) => r.sentence_id === 102)
        .map((r) => r.weight);
      expect(s102).toEqual([4]);
      // sentence 103 untouched due to conflict
      const s103 = rows
        .filter((r) => r.sentence_id === 103)
        .map((r) => r.weight);
      expect(s103).toEqual([3]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("inserts missing sentence_to_normal_link for high sentences vs story normals", () => {
    const root = mkdtempSync(join(tmpdir(), "memok-fb-ins-"));
    try {
      const dbPath = join(root, "ins.sqlite");
      const db = new Database(dbPath);
      db.exec(`
        CREATE TABLE words (id INTEGER PRIMARY KEY, word TEXT UNIQUE);
        CREATE TABLE normal_words (id INTEGER PRIMARY KEY, word TEXT UNIQUE);
        CREATE TABLE word_to_normal_link (word_id INTEGER, normal_id INTEGER, weight INTEGER);
        CREATE TABLE sentences (id INTEGER PRIMARY KEY, sentence TEXT, weight INTEGER, duration INTEGER);
        CREATE TABLE sentence_to_normal_link (normal_id INTEGER, sentence_id INTEGER, weight INTEGER);
      `);
      db.prepare("INSERT INTO words (id, word) VALUES (1, 'alpha')").run();
      db.prepare(
        "INSERT INTO normal_words (id, word) VALUES (10, 'N10')",
      ).run();
      db.prepare(
        "INSERT INTO word_to_normal_link (word_id, normal_id, weight) VALUES (1, 10, 5)",
      ).run();
      db.prepare(
        "INSERT INTO sentences (id, sentence, weight, duration) VALUES (201, 's', 1, 1)",
      ).run();
      db.close();

      const stats = applyResultLinkFeedback(dbPath, {
        words: ["alpha"],
        buckets: {
          words: ["alpha"],
          id_ge_60: [201],
          id_ge_40_lt_60: [],
          id_lt_40: [],
        },
      });
      expect(stats.updatedPlus).toBe(0);
      expect(stats.insertedPlusSentenceLinks).toBe(1);
      expect(stats.updatedSentenceRows).toBe(1);

      const ro = new Database(dbPath, { readonly: true });
      const row = ro
        .prepare(
          "SELECT weight FROM sentence_to_normal_link WHERE sentence_id = 201 AND normal_id = 10",
        )
        .get() as { weight: number };
      ro.close();
      expect(row.weight).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
