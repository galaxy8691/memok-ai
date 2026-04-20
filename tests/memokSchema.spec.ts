import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createFreshMemokSqliteFile } from "../src/sqlite/memokSchema.js";

describe("memokSchema", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    dirs.length = 0;
  });

  it("createFreshMemokSqliteFile creates expected tables", () => {
    const dir = mkdtempSync(join(tmpdir(), "memok-schema-"));
    dirs.push(dir);
    const dbPath = join(dir, "tables.sqlite");
    createFreshMemokSqliteFile(dbPath);
    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name",
        )
        .all() as { name: string }[];
      const names = rows.map((r) => r.name);
      expect(names).toEqual([
        "dream_logs",
        "normal_words",
        "sentence_to_normal_link",
        "sentences",
        "word_to_normal_link",
        "words",
      ]);
    } finally {
      db.close();
    }
  });

  it("createFreshMemokSqliteFile writes a non-empty file", () => {
    const dir = mkdtempSync(join(tmpdir(), "memok-schema-"));
    dirs.push(dir);
    const dbPath = join(dir, "fresh.sqlite");
    createFreshMemokSqliteFile(dbPath);
    expect(existsSync(dbPath)).toBe(true);
    expect(readFileSync(dbPath).length).toBeGreaterThan(0);
    const db = new Database(dbPath, { readonly: true });
    try {
      const n = db
        .prepare("SELECT COUNT(*) as c FROM sqlite_master WHERE type='index'")
        .get() as { c: number };
      expect(n.c).toBeGreaterThanOrEqual(4);
    } finally {
      db.close();
    }
  });

  it("createFreshMemokSqliteFile refuses existing file without replace", () => {
    const dir = mkdtempSync(join(tmpdir(), "memok-schema-"));
    dirs.push(dir);
    const dbPath = join(dir, "exists.sqlite");
    createFreshMemokSqliteFile(dbPath);
    expect(() => createFreshMemokSqliteFile(dbPath)).toThrow(/already exists/);
  });

  it("createFreshMemokSqliteFile with replace overwrites", () => {
    const dir = mkdtempSync(join(tmpdir(), "memok-schema-"));
    dirs.push(dir);
    const dbPath = join(dir, "rep.sqlite");
    createFreshMemokSqliteFile(dbPath);
    const db1 = new Database(dbPath);
    try {
      db1.prepare("INSERT INTO words (word) VALUES (?)").run("only");
    } finally {
      db1.close();
    }
    createFreshMemokSqliteFile(dbPath, { replace: true });
    const db2 = new Database(dbPath, { readonly: true });
    try {
      const c = db2.prepare("SELECT COUNT(*) as c FROM words").get() as {
        c: number;
      };
      expect(c.c).toBe(0);
    } finally {
      db2.close();
    }
  });
});
