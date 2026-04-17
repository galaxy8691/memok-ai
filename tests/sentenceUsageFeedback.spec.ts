import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applySentenceUsageFeedback } from "../src/sqlite/applySentenceUsageFeedback.js";

function openMemokSchemaDb(dir: string): string {
  const dbPath = join(dir, "t.sqlite");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE sentences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sentence TEXT,
      weight INTEGER,
      duration INTEGER,
      last_edit_date TEXT,
      is_short_term INTEGER,
      duration_change_times INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.prepare(
    "INSERT INTO sentences (sentence, weight, duration, last_edit_date, is_short_term, duration_change_times) VALUES (?, ?, ?, ?, 1, ?)",
  ).run("a", 1, 7, "2026-01-01", 0);
  db.prepare(
    "INSERT INTO sentences (sentence, weight, duration, last_edit_date, is_short_term, duration_change_times) VALUES (?, ?, ?, ?, 0, ?)",
  ).run("b", 2, 10, "2026-06-16", 0);
  db.close();
  return dbPath;
}

describe("applySentenceUsageFeedback", () => {
  it("跨日时 last_edit_date 非今日：duration+1，duration_change_times 从 1 计", () => {
    const root = mkdtempSync(join(tmpdir(), "memok-suf-"));
    try {
      const dbPath = openMemokSchemaDb(root);
      const { updatedCount } = applySentenceUsageFeedback(dbPath, [1, 1], {
        lastEditDate: "2026-06-15",
      });
      expect(updatedCount).toBe(1);
      const db = new Database(dbPath, { readonly: true });
      const row = db
        .prepare(
          "SELECT weight, duration, last_edit_date, duration_change_times FROM sentences WHERE id = 1",
        )
        .get() as {
        weight: number;
        duration: number;
        last_edit_date: string;
        duration_change_times: number;
      };
      db.close();
      expect(row.weight).toBe(2);
      expect(row.duration).toBe(8);
      expect(row.last_edit_date).toBe("2026-06-15");
      expect(row.duration_change_times).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("同日最多 3 次 duration；第 4 次仅 weight+1", () => {
    const root = mkdtempSync(join(tmpdir(), "memok-suf-"));
    try {
      const dbPath = openMemokSchemaDb(root);
      const day = "2026-06-20";
      applySentenceUsageFeedback(dbPath, [2], { lastEditDate: day });
      applySentenceUsageFeedback(dbPath, [2], { lastEditDate: day });
      applySentenceUsageFeedback(dbPath, [2], { lastEditDate: day });
      const db = new Database(dbPath, { readonly: true });
      const row3 = db
        .prepare(
          "SELECT weight, duration, duration_change_times FROM sentences WHERE id = 2",
        )
        .get() as {
        weight: number;
        duration: number;
        duration_change_times: number;
      };
      db.close();
      expect(row3.weight).toBe(5);
      expect(row3.duration).toBe(13);
      expect(row3.duration_change_times).toBe(3);

      applySentenceUsageFeedback(dbPath, [2], { lastEditDate: day });
      const db4 = new Database(dbPath, { readonly: true });
      const row4 = db4
        .prepare(
          "SELECT weight, duration, duration_change_times FROM sentences WHERE id = 2",
        )
        .get() as {
        weight: number;
        duration: number;
        duration_change_times: number;
      };
      db4.close();
      expect(row4.weight).toBe(6);
      expect(row4.duration).toBe(13);
      expect(row4.duration_change_times).toBe(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("同日已满 3 次后，换日第一次可再 duration+1 且计数重置为 1", () => {
    const root = mkdtempSync(join(tmpdir(), "memok-suf-"));
    try {
      const dbPath = openMemokSchemaDb(root);
      const day = "2026-06-20";
      applySentenceUsageFeedback(dbPath, [2], { lastEditDate: day });
      applySentenceUsageFeedback(dbPath, [2], { lastEditDate: day });
      applySentenceUsageFeedback(dbPath, [2], { lastEditDate: day });
      applySentenceUsageFeedback(dbPath, [2], { lastEditDate: "2026-06-21" });
      const db = new Database(dbPath, { readonly: true });
      const row = db
        .prepare(
          "SELECT weight, duration, duration_change_times, last_edit_date FROM sentences WHERE id = 2",
        )
        .get() as {
        weight: number;
        duration: number;
        duration_change_times: number;
        last_edit_date: string;
      };
      db.close();
      expect(row.weight).toBe(6);
      expect(row.duration).toBe(14);
      expect(row.duration_change_times).toBe(1);
      expect(row.last_edit_date).toBe("2026-06-21");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
