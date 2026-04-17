import { readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import {
  type ArticleCoreWordsNomalizedData,
  type ArticleSentenceCoreCombinedData,
  AwpV2TupleSchema,
} from "../article-word-pipeline/v2/schemas.js";
import { openSqlite } from "./openSqlite.js";

export function parseAwpV2TupleJson(
  data: unknown,
): [ArticleSentenceCoreCombinedData, ArticleCoreWordsNomalizedData] {
  const parsed = typeof data === "string" ? JSON.parse(data) : data;
  const tuple = AwpV2TupleSchema.parse(parsed);
  return [tuple[0], tuple[1]];
}

function getOrCreateWordId(
  db: Database.Database,
  table: "words" | "normal_words",
  text: string,
  cache: Map<string, number>,
): number {
  if (cache.has(text)) {
    return cache.get(text)!;
  }
  const row = db.prepare(`SELECT id FROM ${table} WHERE word = ?`).get(text) as
    | { id?: number }
    | undefined;
  if (row?.id !== undefined) {
    cache.set(text, row.id);
    return row.id;
  }
  const info = db.prepare(`INSERT INTO ${table} (word) VALUES (?)`).run(text);
  const id = Number(info.lastInsertRowid);
  cache.set(text, id);
  return id;
}

function wordNormalLinkExists(
  db: Database.Database,
  wordId: number,
  normalId: number,
): boolean {
  const row = db
    .prepare(
      "SELECT 1 FROM word_to_normal_link WHERE word_id = ? AND normal_id = ?",
    )
    .get(wordId, normalId) as Record<string, unknown> | undefined;
  return row !== undefined;
}

function sentenceNormalLinkExists(
  db: Database.Database,
  sentenceId: number,
  normalId: number,
): boolean {
  const row = db
    .prepare(
      "SELECT 1 FROM sentence_to_normal_link WHERE sentence_id = ? AND normal_id = ?",
    )
    .get(sentenceId, normalId) as Record<string, unknown> | undefined;
  return row !== undefined;
}

function normalIdForText(
  db: Database.Database,
  text: string,
  cache: Map<string, number>,
): number | undefined {
  if (cache.has(text)) {
    return cache.get(text);
  }
  const row = db
    .prepare("SELECT id FROM normal_words WHERE word = ?")
    .get(text) as { id?: number } | undefined;
  if (row?.id === undefined) {
    return undefined;
  }
  cache.set(text, row.id);
  return row.id;
}

export function importAwpV2Tuple(
  db: Database.Database,
  sentenceCore: ArticleSentenceCoreCombinedData,
  normalized: ArticleCoreWordsNomalizedData,
  opts?: { today?: string },
): void {
  db.pragma("foreign_keys = ON");
  const dateStr = opts?.today ?? new Date().toISOString().slice(0, 10);
  const wordsCache = new Map<string, number>();
  const normalsCache = new Map<string, number>();

  for (const pair of normalized.nomalized) {
    const ow = pair.original_text.trim();
    const nw = pair.new_text.trim();
    if (!ow && !nw) {
      continue;
    }
    if (!ow || !nw) {
      continue;
    }
    const wordId = getOrCreateWordId(db, "words", ow, wordsCache);
    const normalId = getOrCreateWordId(db, "normal_words", nw, normalsCache);
    if (!wordNormalLinkExists(db, wordId, normalId)) {
      db.prepare(
        "INSERT INTO word_to_normal_link (word_id, normal_id, weight) VALUES (?, ?, 1)",
      ).run(wordId, normalId);
    }
  }

  for (const item of sentenceCore.sentence_core) {
    const sentence = item.sentence.trim();
    if (!sentence) {
      continue;
    }
    const info = db
      .prepare(
        "INSERT INTO sentences (sentence, weight, duration, last_edit_date, is_short_term, duration_change_times) VALUES (?, 1, 7, ?, 1, 0)",
      )
      .run(sentence, dateStr);
    const sentenceId = Number(info.lastInsertRowid);
    const seen = new Set<number>();
    for (const w of item.core_words) {
      const key = w.trim();
      if (!key) {
        continue;
      }
      const nid = normalIdForText(db, key, normalsCache);
      if (nid === undefined) {
        throw new Error(
          `core_words 中的锚点 ${JSON.stringify(key)} 在 normal_words 中不存在；请先保证 nomalized 覆盖该 new_text`,
        );
      }
      if (seen.has(nid)) {
        continue;
      }
      seen.add(nid);
      if (!sentenceNormalLinkExists(db, sentenceId, nid)) {
        db.prepare(
          "INSERT INTO sentence_to_normal_link (normal_id, sentence_id, weight) VALUES (?, ?, 1)",
        ).run(nid, sentenceId);
      }
    }
  }
}

export function importAwpV2TupleFromPaths(
  jsonPath: string,
  dbPath: string,
  opts?: { today?: string },
): void {
  const raw = JSON.parse(readFileSync(jsonPath, "utf-8"));
  const [sc, nm] = parseAwpV2TupleJson(raw);
  const db = openSqlite(dbPath);
  try {
    const tx = db.transaction(() => {
      importAwpV2Tuple(db, sc, nm, opts);
    });
    tx();
  } finally {
    db.close();
  }
}
