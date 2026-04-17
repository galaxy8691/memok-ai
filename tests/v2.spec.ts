import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { _internalArticleCoreWordsNormalize } from "../src/article-word-pipeline/v2/articleCoreWordsNormalize.js";
import {
  combineArticleSentenceCoreV2,
  dumpArticleSentenceCoreCombineTupleV2Json,
} from "../src/article-word-pipeline/v2/articleSentenceCoreCombine.js";
import {
  importAwpV2Tuple,
  parseAwpV2TupleJson,
} from "../src/sqlite/awpV2Import.js";

describe("v2 pure logic", () => {
  it("combine returns tuple shape", () => {
    const [combined, normalized] = combineArticleSentenceCoreV2(
      {
        sentences: [{ sentence: "a" }, { sentence: "b" }],
      },
      {
        nomalized: [
          { original_text: "A", new_text: "x" },
          { original_text: "B", new_text: "x" },
          { original_text: "C", new_text: "y" },
        ],
      },
    );
    expect(combined.sentence_core).toHaveLength(2);
    expect(combined.sentence_core[0].core_words).toEqual(["x", "y"]);
    const raw = dumpArticleSentenceCoreCombineTupleV2Json(
      combined,
      normalized,
      null,
    );
    const tuple = parseAwpV2TupleJson(raw);
    expect(tuple[0].sentence_core[1].sentence).toBe("b");
  });

  it("canonicalize new_text keeps Python-compatible rules", () => {
    expect(
      _internalArticleCoreWordsNormalize.canonicalizeNewText(
        "UTC+02:00",
        "UTC+02:00",
      ),
    ).toBe("时间");
    expect(
      _internalArticleCoreWordsNormalize.canonicalizeNewText(
        "2017年12月28日",
        "2017年12月28日",
      ),
    ).toBe("日期");
    expect(
      _internalArticleCoreWordsNormalize.canonicalizeNewText("95%", "95%"),
    ).toBe("比例");
    expect(
      _internalArticleCoreWordsNormalize.canonicalizeNewText(
        "技巧★★★",
        "技巧★★★",
      ),
    ).toBe("技巧");
  });

  it("imports tuple into sqlite", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE words (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT UNIQUE);
      CREATE TABLE normal_words (id INTEGER PRIMARY KEY AUTOINCREMENT, word TEXT UNIQUE);
      CREATE TABLE word_to_normal_link (word_id INTEGER, normal_id INTEGER, weight INTEGER);
      CREATE TABLE sentences (id INTEGER PRIMARY KEY AUTOINCREMENT, sentence TEXT, weight INTEGER, duration INTEGER, last_edit_date TEXT, is_short_term INTEGER, duration_change_times INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE sentence_to_normal_link (normal_id INTEGER, sentence_id INTEGER, weight INTEGER);
    `);
    importAwpV2Tuple(
      db,
      {
        sentence_core: [{ sentence: "Mars", core_words: ["火星"] }],
      },
      {
        nomalized: [{ original_text: "火星", new_text: "火星" }],
      },
      { today: "2026-04-14" },
    );
    const words = db.prepare("SELECT COUNT(*) as c FROM words").get() as {
      c: number;
    };
    const links = db
      .prepare("SELECT COUNT(*) as c FROM sentence_to_normal_link")
      .get() as { c: number };
    expect(words.c).toBe(1);
    expect(links.c).toBe(1);
    db.close();
  });
});
