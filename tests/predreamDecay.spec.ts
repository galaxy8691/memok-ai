import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { runPredreamDecayFromDb } from "../src/dreaming-pipeline/predream-pipeline/runPredreamDecayFromDb.js";

function makeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE sentences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sentence TEXT,
      weight INTEGER,
      duration INTEGER,
      last_edit_date TEXT,
      is_short_term INTEGER,
      duration_change_times INTEGER
    );
    CREATE TABLE sentence_to_normal_link (
      normal_id INTEGER,
      sentence_id INTEGER,
      weight INTEGER
    );
  `);
}

describe("runPredreamDecayFromDb", () => {
  it("decrements all durations then promotes any short-term with weight>=7 and deletes short-term depleted with weight<7", () => {
    const root = mkdtempSync(join(tmpdir(), "memok-predream-"));
    const dbPath = join(root, "t.sqlite");
    try {
      const db = new Database(dbPath);
      makeSchema(db);
      db.prepare(
        `INSERT INTO sentences (sentence, weight, duration, last_edit_date, is_short_term, duration_change_times)
         VALUES
           ('a', 7, 1, '2026-01-01', 1, 0),
           ('b', 3, 1, '2026-01-01', 1, 0),
           ('c', 1, 10, '2026-01-01', 0, 0)`,
      ).run();
      const idB = (
        db.prepare("SELECT id FROM sentences WHERE sentence = 'b'").get() as {
          id: number;
        }
      ).id;
      db.prepare(
        "INSERT INTO sentence_to_normal_link (normal_id, sentence_id, weight) VALUES (99, ?, 1)",
      ).run(idB);
      db.close();

      const out = runPredreamDecayFromDb(dbPath);
      expect(out.sentencesDurationDecremented).toBe(3);
      expect(out.promotedToLongTerm).toBe(1);
      expect(out.deletedSentences).toBe(1);

      const ro = new Database(dbPath, { readonly: true });
      const rows = ro
        .prepare(
          "SELECT id, sentence, weight, duration, is_short_term FROM sentences ORDER BY id",
        )
        .all() as {
        id: number;
        sentence: string;
        weight: number;
        duration: number;
        is_short_term: number;
      }[];
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.sentence === "a")).toMatchObject({
        duration: 0,
        is_short_term: 0,
        weight: 7,
      });
      expect(rows.find((r) => r.sentence === "c")).toMatchObject({
        duration: 9,
        is_short_term: 0,
        weight: 1,
      });
      const links = ro
        .prepare("SELECT COUNT(*) as c FROM sentence_to_normal_link")
        .get() as { c: number };
      expect(links.c).toBe(0);
      ro.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("promotes short-term with weight>=7 even when duration stays >0 after decay", () => {
    const root = mkdtempSync(join(tmpdir(), "memok-predream-"));
    const dbPath = join(root, "t.sqlite");
    try {
      const db = new Database(dbPath);
      makeSchema(db);
      db.prepare(
        `INSERT INTO sentences (sentence, weight, duration, last_edit_date, is_short_term, duration_change_times)
         VALUES ('heavy', 8, 10, '2026-01-01', 1, 0)`,
      ).run();
      db.close();

      const out = runPredreamDecayFromDb(dbPath);
      expect(out.sentencesDurationDecremented).toBe(1);
      expect(out.promotedToLongTerm).toBe(1);
      expect(out.deletedSentences).toBe(0);

      const ro = new Database(dbPath, { readonly: true });
      const row = ro
        .prepare(
          "SELECT duration, is_short_term FROM sentences WHERE sentence = 'heavy'",
        )
        .get() as {
        duration: number;
        is_short_term: number;
      };
      expect(row.duration).toBe(9);
      expect(row.is_short_term).toBe(0);
      ro.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not promote or delete when short-term row still has duration>0 after decay", () => {
    const root = mkdtempSync(join(tmpdir(), "memok-predream-"));
    const dbPath = join(root, "t.sqlite");
    try {
      const db = new Database(dbPath);
      makeSchema(db);
      db.prepare(
        `INSERT INTO sentences (sentence, weight, duration, last_edit_date, is_short_term, duration_change_times)
         VALUES ('x', 3, 5, '2026-01-01', 1, 0)`,
      ).run();
      db.close();

      const out = runPredreamDecayFromDb(dbPath);
      expect(out.sentencesDurationDecremented).toBe(1);
      expect(out.promotedToLongTerm).toBe(0);
      expect(out.deletedSentences).toBe(0);

      const ro = new Database(dbPath, { readonly: true });
      const row = ro
        .prepare(
          "SELECT duration, is_short_term FROM sentences WHERE sentence = 'x'",
        )
        .get() as {
        duration: number;
        is_short_term: number;
      };
      expect(row.duration).toBe(4);
      expect(row.is_short_term).toBe(1);
      ro.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
