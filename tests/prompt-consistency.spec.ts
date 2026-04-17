import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  JSON_MODE_USER_SUFFIX_ARTICLE_CORE_WORDS,
  SYSTEM_PROMPT_ARTICLE_CORE_WORDS,
} from "../src/article-word-pipeline/v2/articleCoreWords.js";
import {
  JSON_MODE_USER_SUFFIX_ARTICLE_CORE_WORDS_NORMALIZE,
  SYSTEM_PROMPT_ARTICLE_CORE_WORDS_NORMALIZE,
} from "../src/article-word-pipeline/v2/articleCoreWordsNormalize.js";
import {
  JSON_MODE_USER_SUFFIX_ARTICLE_SENTENCES,
  SYSTEM_PROMPT_ARTICLE_SENTENCES,
} from "../src/article-word-pipeline/v2/articleSentences.js";

const PY_ROOT = "/home/wik20/memok/src/memok/article_word/v2";

function extractTripleQuoted(content: string, varName: string): string {
  const re = new RegExp(`${varName}\\s*=\\s*"""([\\s\\S]*?)"""`, "m");
  const m = content.match(re);
  if (!m) {
    throw new Error(`Cannot extract ${varName}`);
  }
  return m[1];
}

function extractConcatString(content: string, varName: string): string {
  const re = new RegExp(`${varName}\\s*=\\s*\\(([\\s\\S]*?)\\)`, "m");
  const m = content.match(re);
  if (!m) {
    throw new Error(`Cannot extract ${varName}`);
  }
  const quoted: string[] = [];
  const qre = /(['"])((?:\\.|(?!\1).)*)\1/g;
  let q = qre.exec(m[1]);
  while (q) {
    quoted.push(q[2]);
    q = qre.exec(m[1]);
  }
  return quoted
    .join("")
    .replaceAll('\\"', '"')
    .replaceAll("\\'", "'")
    .replaceAll("\\n", "\n");
}

describe("prompt consistency with python baseline", () => {
  it("keeps v2 prompt texts aligned", () => {
    const pyCorePath = `${PY_ROOT}/article_core_words_llm.py`;
    const pyNormPath = `${PY_ROOT}/article_core_words_normalize_llm.py`;
    const pySentPath = `${PY_ROOT}/article_sentence_llm.py`;
    if (![pyCorePath, pyNormPath, pySentPath].every((p) => existsSync(p))) {
      return;
    }
    const pyCore = readFileSync(pyCorePath, "utf-8");
    const pyNorm = readFileSync(pyNormPath, "utf-8");
    const pySent = readFileSync(pySentPath, "utf-8");

    expect(SYSTEM_PROMPT_ARTICLE_CORE_WORDS).toBe(
      extractTripleQuoted(pyCore, "SYSTEM_PROMPT"),
    );
    expect(JSON_MODE_USER_SUFFIX_ARTICLE_CORE_WORDS.trim()).toBe(
      extractConcatString(pyCore, "JSON_MODE_USER_SUFFIX").trim(),
    );

    expect(SYSTEM_PROMPT_ARTICLE_CORE_WORDS_NORMALIZE).toBe(
      extractTripleQuoted(pyNorm, "SYSTEM_PROMPT"),
    );
    expect(JSON_MODE_USER_SUFFIX_ARTICLE_CORE_WORDS_NORMALIZE.trim()).toBe(
      extractConcatString(pyNorm, "JSON_MODE_USER_SUFFIX").trim(),
    );

    expect(SYSTEM_PROMPT_ARTICLE_SENTENCES).toBe(
      extractTripleQuoted(pySent, "SYSTEM_PROMPT"),
    );
    expect(JSON_MODE_USER_SUFFIX_ARTICLE_SENTENCES.trim()).toBe(
      extractConcatString(pySent, "JSON_MODE_USER_SUFFIX").trim(),
    );
  });
});
