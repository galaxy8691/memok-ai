import { z } from "zod";
import { openSqlite } from "../../sqlite/openSqlite.js";
import { RelevanceBucketsSchema } from "./buildRelevanceBuckets.js";

export const ResultLinkFeedbackInputSchema = z
  .object({
    words: z.array(z.string()),
    buckets: RelevanceBucketsSchema,
  })
  .strict();

export type ResultLinkFeedbackInput = z.infer<
  typeof ResultLinkFeedbackInputSchema
>;

export type ApplyResultLinkFeedbackResult = {
  matchedNormalIds: number;
  updatedSentenceRows: number;
  updatedPlus: number;
  /** 高分句与 story `words` 推得的 normal_id 之间原本无 sentence_to_normal_link，新建 weight=1 的行数 */
  insertedPlusSentenceLinks: number;
  updatedMinus: number;
  deleted: number;
  skippedConflicts: number;
  targetedPlusSentences: number;
  targetedMinusSentences: number;
};

function uniqIntIds(ids: number[]): number[] {
  return [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
}

/**
 * 高分句（`id_ge_60`）：对每个 `(sentence_id, normal_id)`，`normal_id` 来自本轮 `words` 在图上的可达集合；
 * 已有 `sentence_to_normal_link` 则 weight+1，否则 INSERT `weight=1`。
 */
export function applyResultLinkFeedback(
  dbPath: string,
  input: ResultLinkFeedbackInput,
): ApplyResultLinkFeedbackResult {
  const parsed = ResultLinkFeedbackInputSchema.parse(input);
  const plusIdsRaw = uniqIntIds(parsed.buckets.id_ge_60);
  const minusIdsRaw = uniqIntIds(parsed.buckets.id_lt_40);
  const minusSet = new Set(minusIdsRaw);
  const conflicts = plusIdsRaw.filter((id) => minusSet.has(id));
  const conflictSet = new Set(conflicts);
  const plusIds = plusIdsRaw.filter((id) => !conflictSet.has(id));
  const minusIds = minusIdsRaw.filter((id) => !conflictSet.has(id));
  const words = [...new Set(parsed.words.map((w) => w.trim()).filter(Boolean))];

  const db = openSqlite(dbPath);
  try {
    db.pragma("foreign_keys = ON");
    const runTx = db.transaction((): ApplyResultLinkFeedbackResult => {
      let updatedSentenceRows = 0;
      if (plusIds.length > 0) {
        const plusSentencePlaceholders = plusIds.map(() => "?").join(", ");
        const sentenceSql = `UPDATE sentences
                             SET weight = weight + 1,
                                 duration = duration + 1
                             WHERE id IN (${plusSentencePlaceholders})`;
        updatedSentenceRows = Number(
          db.prepare(sentenceSql).run(...plusIds).changes,
        );
      }

      let normalIds: number[] = [];
      if (words.length > 0) {
        const placeholders = words.map(() => "?").join(", ");
        const rows = db
          .prepare(
            `SELECT DISTINCT wtn.normal_id AS normal_id
             FROM words w
             JOIN word_to_normal_link wtn ON w.id = wtn.word_id
             WHERE w.word IN (${placeholders})`,
          )
          .all(...words) as { normal_id: number }[];
        normalIds = [
          ...new Set(
            rows
              .map((r) => r.normal_id)
              .filter((n) => Number.isInteger(n) && n > 0),
          ),
        ];
      }

      if (normalIds.length === 0) {
        return {
          matchedNormalIds: 0,
          updatedSentenceRows,
          updatedPlus: 0,
          insertedPlusSentenceLinks: 0,
          updatedMinus: 0,
          deleted: 0,
          skippedConflicts: conflicts.length,
          targetedPlusSentences: plusIds.length,
          targetedMinusSentences: minusIds.length,
        };
      }

      const normalPlaceholders = normalIds.map(() => "?").join(", ");
      let updatedPlus = 0;
      let insertedPlusSentenceLinks = 0;
      if (plusIds.length > 0) {
        const sel = db.prepare(
          `SELECT 1 AS ok FROM sentence_to_normal_link WHERE sentence_id = ? AND normal_id = ? LIMIT 1`,
        );
        const upd = db.prepare(
          `UPDATE sentence_to_normal_link SET weight = weight + 1 WHERE sentence_id = ? AND normal_id = ?`,
        );
        const ins = db.prepare(
          `INSERT INTO sentence_to_normal_link (sentence_id, normal_id, weight) VALUES (?, ?, 1)`,
        );
        for (const sid of plusIds) {
          for (const nid of normalIds) {
            if (sel.get(sid, nid) !== undefined) {
              updatedPlus += Number(upd.run(sid, nid).changes);
            } else {
              ins.run(sid, nid);
              insertedPlusSentenceLinks += 1;
            }
          }
        }
      }

      let updatedMinus = 0;
      let deleted = 0;
      if (minusIds.length > 0) {
        const minusPlaceholders = minusIds.map(() => "?").join(", ");
        const minusSql = `UPDATE sentence_to_normal_link
                          SET weight = weight - 1
                          WHERE sentence_id IN (${minusPlaceholders})
                            AND normal_id IN (${normalPlaceholders})`;
        updatedMinus = Number(
          db.prepare(minusSql).run(...minusIds, ...normalIds).changes,
        );
        const deleteSql = `DELETE FROM sentence_to_normal_link
                           WHERE sentence_id IN (${minusPlaceholders})
                             AND normal_id IN (${normalPlaceholders})
                             AND weight <= 0`;
        deleted = Number(
          db.prepare(deleteSql).run(...minusIds, ...normalIds).changes,
        );
      }

      return {
        matchedNormalIds: normalIds.length,
        updatedSentenceRows,
        updatedPlus,
        insertedPlusSentenceLinks,
        updatedMinus,
        deleted,
        skippedConflicts: conflicts.length,
        targetedPlusSentences: plusIds.length,
        targetedMinusSentences: minusIds.length,
      };
    });
    return runTx();
  } finally {
    db.close();
  }
}
