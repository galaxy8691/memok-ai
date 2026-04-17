import type Database from "better-sqlite3";
import { z } from "zod";
import { openSqlite } from "../sqlite/openSqlite.js";

/** 经本次 words 抽样、经哪条「词 → 规范词」边连到该句（仅保留抽样顺序下最先命中的那一对） */
export const WordMatchLinkSchema = z
  .object({
    word: z.string(),
    normal_word: z.string(),
  })
  .strict();

export type WordMatchLink = z.infer<typeof WordMatchLinkSchema>;

/** 单条句子（与 sentences 表核心列一致；不含 duration_change_times 等扩展列；is_short_term 以 JSON bool 输出） */
export const MemoryExtractedSentenceSchema = z
  .object({
    id: z.number().int(),
    sentence: z.string(),
    weight: z.number().int(),
    duration: z.number().int(),
    is_short_term: z
      .union([z.number(), z.boolean()])
      .transform((v) => v === true || v === 1),
    matched_word: WordMatchLinkSchema,
  })
  .strict();

export type MemoryExtractedSentence = z.infer<
  typeof MemoryExtractedSentenceSchema
>;

export const MemoryExtractResponseSchema = z
  .object({
    /**
     * 先为全部短期候选，再接非短期加权抽样结果；
     * 仍可通过每条 `is_short_term` 区分。
     */
    sentences: z.array(MemoryExtractedSentenceSchema),
  })
  .strict();

export type MemoryExtractResponse = z.infer<typeof MemoryExtractResponseSchema>;

export type ExtractMemorySentencesOpts = {
  /** 对 words 全表行数取样的比例，默认 0.2 */
  fraction?: number;
  /**
   * 非短期句池上的抽样比例，默认与 fraction 相同（例如 0.2）。
   * 抽取条数 k = max(1, round(非短期候选数 * longTermFraction))，且不超过池大小。
   */
  longTermFraction?: number;
};

type RawSentenceRow = {
  id: number;
  sentence: string;
  weight: number;
  duration: number;
  is_short_term: number;
};

type RawJoinRow = RawSentenceRow & {
  word_id: number;
  word: string;
  normal_word: string;
};

function parseCore(
  row: RawSentenceRow,
): Omit<MemoryExtractedSentence, "matched_word"> {
  return {
    id: row.id,
    sentence: row.sentence,
    weight: row.weight,
    duration: row.duration,
    is_short_term: row.is_short_term === 1,
  };
}

function weightScore(s: MemoryExtractedSentence): number {
  return Math.max(1, s.weight + s.duration);
}

/** 按 weightScore 加权、无放回随机抽取，抽 `pickCount` 条（pickCount 已钳到池大小） */
function weightedRandomSampleWithoutReplacement(
  items: MemoryExtractedSentence[],
  pickCount: number,
): MemoryExtractedSentence[] {
  const pool = [...items];
  const out: MemoryExtractedSentence[] = [];
  const n = Math.min(Math.max(0, pickCount), pool.length);
  for (let t = 0; t < n && pool.length > 0; t += 1) {
    let sum = 0;
    for (const p of pool) {
      sum += weightScore(p);
    }
    let r = Math.random() * sum;
    let idx = 0;
    for (let i = 0; i < pool.length; i += 1) {
      r -= weightScore(pool[i]!);
      if (r <= 0) {
        idx = i;
        break;
      }
      idx = i;
    }
    out.push(pool[idx]!);
    pool.splice(idx, 1);
  }
  return out;
}

function emptyResponse(): MemoryExtractResponse {
  return MemoryExtractResponseSchema.parse({ sentences: [] });
}

/**
 * 从 words 表随机抽取约 `fraction` 比例的行（至少 1 行，表非空），
 * 经 word_to_normal_link → sentence_to_normal_link → sentences 得到候选句；
 * - **短期**（is_short_term）：候选中全部保留，在 `sentences` 数组前段（顺序与候选迭代一致）；
 * - **非短期**：候选中按 `weight+duration` 加权、无放回随机抽取约 `longTermFraction`（默认同 fraction），
 *   接在 `sentences` 数组后段。
 * 每条 `matched_word` 为本次抽样词 id 顺序下最先能连到该句的一对（`word` / `normal_word`）；同 rank 时保留先合并到的那条。
 */
export function extractMemorySentencesByWordSample(
  dbOrPath: Database.Database | string,
  opts?: ExtractMemorySentencesOpts,
): MemoryExtractResponse {
  const fraction = opts?.fraction ?? 0.2;
  const longTermFraction = opts?.longTermFraction ?? fraction;
  const ownDb = typeof dbOrPath === "string";
  const db = ownDb ? openSqlite(dbOrPath) : dbOrPath;
  try {
    db.pragma("foreign_keys = ON");
    const countRow = db.prepare("SELECT COUNT(*) as c FROM words").get() as {
      c: number | bigint;
    };
    const n = Number(countRow.c);
    if (n <= 0) {
      return emptyResponse();
    }
    const k = Math.max(1, Math.round(n * fraction));
    const sampled = db
      .prepare("SELECT id FROM words ORDER BY RANDOM() LIMIT ?")
      .all(k) as { id: number }[];
    if (sampled.length === 0) {
      return emptyResponse();
    }
    const wordIds = sampled.map((w) => w.id);
    const wordRank = new Map<number, number>(wordIds.map((id, i) => [id, i]));
    const placeholders = wordIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT DISTINCT s.id, s.sentence, s.weight, s.duration, s.is_short_term,
                wtn.word_id AS word_id, w.word AS word, nw.word AS normal_word
         FROM word_to_normal_link wtn
         JOIN words w ON w.id = wtn.word_id
         JOIN normal_words nw ON nw.id = wtn.normal_id
         JOIN sentence_to_normal_link snl ON snl.normal_id = wtn.normal_id
         JOIN sentences s ON s.id = snl.sentence_id
         WHERE wtn.word_id IN (${placeholders})
         ORDER BY RANDOM()`,
      )
      .all(...wordIds) as RawJoinRow[];

    if (rows.length === 0) {
      return emptyResponse();
    }

    const byId = new Map<
      number,
      Omit<MemoryExtractedSentence, "matched_word"> & {
        bestRank: number;
        matched_word: WordMatchLink;
      }
    >();
    for (const row of rows) {
      const core = parseCore(row);
      const pair: WordMatchLink = {
        word: row.word,
        normal_word: row.normal_word,
      };
      const rank = wordRank.get(row.word_id) ?? Number.POSITIVE_INFINITY;
      let acc = byId.get(core.id);
      if (!acc) {
        acc = { ...core, bestRank: rank, matched_word: pair };
        byId.set(core.id, acc);
      } else if (rank < acc.bestRank) {
        acc.bestRank = rank;
        acc.matched_word = pair;
      }
    }
    const unique: MemoryExtractedSentence[] = [...byId.values()].map((acc) => {
      const { bestRank: _br, matched_word, ...core } = acc;
      return MemoryExtractedSentenceSchema.parse({
        ...core,
        matched_word,
      });
    });

    const shortTerm: MemoryExtractedSentence[] = [];
    const longPool: MemoryExtractedSentence[] = [];
    for (const s of unique) {
      if (s.is_short_term) {
        shortTerm.push(s);
      } else {
        longPool.push(s);
      }
    }
    const ln = longPool.length;
    let longSampled: MemoryExtractedSentence[] = [];
    if (ln > 0) {
      const want = Math.max(1, Math.round(ln * longTermFraction));
      const pickCount = Math.min(want, ln);
      longSampled = weightedRandomSampleWithoutReplacement(longPool, pickCount);
    }

    return MemoryExtractResponseSchema.parse({
      sentences: [...shortTerm, ...longSampled],
    });
  } finally {
    if (ownDb) {
      (db as Database.Database).close();
    }
  }
}
