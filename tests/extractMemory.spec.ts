import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { extractMemorySentencesByWordSample } from "../src/read-memory-pipeline/extractMemorySentencesByWordSample.js";

function createFixtureDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE words (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT UNIQUE);
    CREATE TABLE normal_words (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT UNIQUE);
    CREATE TABLE word_to_normal_link (word_id INTEGER, normal_id INTEGER, weight INTEGER);
    CREATE TABLE sentences (id INTEGER PRIMARY KEY AUTOINCREMENT, sentence TEXT, weight INTEGER, duration INTEGER, last_edit_date TEXT, is_short_term INTEGER, duration_change_times INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE sentence_to_normal_link (normal_id INTEGER, sentence_id INTEGER, weight INTEGER);
  `);
  db.prepare("INSERT INTO words (word) VALUES (?), (?), (?), (?), (?)").run(
    "a",
    "b",
    "c",
    "d",
    "e",
  );
  db.prepare("INSERT INTO normal_words (word) VALUES (?)").run("N");
  const w = db.prepare("SELECT id FROM words").all() as { id: number }[];
  const nid = (
    db.prepare("SELECT id FROM normal_words WHERE word = ?").get("N") as {
      id: number;
    }
  ).id;
  for (const row of w) {
    db.prepare(
      "INSERT INTO word_to_normal_link (word_id, normal_id, weight) VALUES (?, ?, 1)",
    ).run(row.id, nid);
  }
  db.prepare(
    "INSERT INTO sentences (sentence, weight, duration, last_edit_date, is_short_term) VALUES (?, 1, 7, '2026-01-01', 1), (?, 2, 14, '2026-01-02', 0), (?, 1, 1, '2026-01-03', 0), (?, 1, 1, '2026-01-04', 0)",
  ).run("短句", "长A", "长B", "长C");
  const srows = db.prepare("SELECT id, sentence FROM sentences").all() as {
    id: number;
    sentence: string;
  }[];
  for (const s of srows) {
    db.prepare(
      "INSERT INTO sentence_to_normal_link (normal_id, sentence_id, weight) VALUES (?, ?, 1)",
    ).run(nid, s.id);
  }
  return db;
}

describe("extractMemorySentencesByWordSample", () => {
  it("returns both arrays empty when words table is empty", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE words (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT UNIQUE);
      CREATE TABLE normal_words (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT UNIQUE);
      CREATE TABLE word_to_normal_link (word_id INTEGER, normal_id INTEGER, weight INTEGER);
      CREATE TABLE sentences (id INTEGER PRIMARY KEY AUTOINCREMENT, sentence TEXT, weight INTEGER, duration INTEGER, last_edit_date TEXT, is_short_term INTEGER, duration_change_times INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE sentence_to_normal_link (normal_id INTEGER, sentence_id INTEGER, weight INTEGER);
    `);
    const out = extractMemorySentencesByWordSample(db);
    expect(out).toEqual({ sentences: [] });
    db.close();
  });

  it("merges short_term then weighted long_term sample in single sentences array", () => {
    const db = createFixtureDb();
    try {
      const out = extractMemorySentencesByWordSample(db, {
        fraction: 1,
        longTermFraction: 0.2,
      });
      const longN = 3;
      const want = Math.max(1, Math.round(longN * 0.2));
      const longPicked = Math.min(want, longN);
      expect(out.sentences.length).toBe(1 + longPicked);
      const shorts = out.sentences.filter((s) => s.is_short_term);
      const longs = out.sentences.filter((s) => !s.is_short_term);
      expect(shorts).toHaveLength(1);
      expect(shorts[0].sentence).toBe("短句");
      const firstWord = shorts[0].matched_word;
      expect(firstWord.normal_word).toBe("N");
      expect(["a", "b", "c", "d", "e"]).toContain(firstWord.word);
      for (const s of out.sentences) {
        expect(s.matched_word).toEqual(firstWord);
      }
      expect(longs).toHaveLength(longPicked);
      expect(out.sentences[0].is_short_term).toBe(true);
      for (const s of longs) {
        expect(s.is_short_term).toBe(false);
      }
    } finally {
      db.close();
    }
  });

  it("uses k = max(1, round(n * fraction)) for word sample count", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE words (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT UNIQUE);
      CREATE TABLE normal_words (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT UNIQUE);
      CREATE TABLE word_to_normal_link (word_id INTEGER, normal_id INTEGER, weight INTEGER);
      CREATE TABLE sentences (id INTEGER PRIMARY KEY AUTOINCREMENT, sentence TEXT, weight INTEGER, duration INTEGER, last_edit_date TEXT, is_short_term INTEGER, duration_change_times INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE sentence_to_normal_link (normal_id INTEGER, sentence_id INTEGER, weight INTEGER);
    `);
    for (let i = 0; i < 3; i += 1) {
      db.prepare("INSERT INTO words (word) VALUES (?)").run(`w${i}`);
    }
    const nInfo = db
      .prepare("INSERT INTO normal_words (word) VALUES (?)")
      .run("N");
    const nid = Number(nInfo.lastInsertRowid);
    const wrows = db.prepare("SELECT id FROM words").all() as { id: number }[];
    for (const r of wrows) {
      db.prepare(
        "INSERT INTO word_to_normal_link (word_id, normal_id, weight) VALUES (?, ?, 1)",
      ).run(r.id, nid);
    }
    const sInfo = db
      .prepare(
        "INSERT INTO sentences (sentence, weight, duration, last_edit_date, is_short_term) VALUES (?, 1, 7, '2026-01-01', 1)",
      )
      .run("s");
    const sid = Number(sInfo.lastInsertRowid);
    db.prepare(
      "INSERT INTO sentence_to_normal_link (normal_id, sentence_id, weight) VALUES (?, ?, 1)",
    ).run(nid, sid);
    const out = extractMemorySentencesByWordSample(db, { fraction: 0.2 });
    expect(out.sentences.length).toBe(1);
    expect(out.sentences[0].is_short_term).toBe(true);
    expect(out.sentences[0].matched_word.normal_word).toBe("N");
    expect(["w0", "w1", "w2"]).toContain(out.sentences[0].matched_word.word);
    db.close();
  });
});
