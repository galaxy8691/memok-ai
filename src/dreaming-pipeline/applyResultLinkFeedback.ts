import Database from "better-sqlite3";
import { z } from "zod";
import { RelevanceBucketsSchema } from "./buildRelevanceBuckets.js";

export const ResultLinkFeedbackInputSchema = z
  .object({
    words: z.array(z.string()),
    buckets: RelevanceBucketsSchema,
  })
  .strict();

export type ResultLinkFeedbackInput = z.infer<typeof ResultLinkFeedbackInputSchema>;

export type ApplyResultLinkFeedbackResult = {
  matchedNormalIds: number;
  updatedSentenceRows: number;
  updatedPlus: number;
  updatedMinus: number;
  deleted: number;
  skippedConflicts: number;
  targetedPlusSentences: number;
  targetedMinusSentences: number;
};

function uniqIntIds(ids: number[]): number[] {
  return [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
}

export function applyResultLinkFeedback(
  dbPath: string,
  input: ResultLinkFeedbackInput,
): ApplyResultLinkFeedbackResult {
  const parsed = ResultLinkFeedbackInputSchema.parse(input);
  const plusIdsRaw = uniqIntIds(parsed.buckets.id_ge_60);
  const minusIdsRaw = uniqIntIds(parsed.buckets.id_lt_40);
  const plusSet = new Set(plusIdsRaw);
  const minusSet = new Set(minusIdsRaw);
  const conflicts = plusIdsRaw.filter((id) => minusSet.has(id));
  const conflictSet = new Set(conflicts);
  const plusIds = plusIdsRaw.filter((id) => !conflictSet.has(id));
  const minusIds = minusIdsRaw.filter((id) => !conflictSet.has(id));
  const words = [...new Set(parsed.words.map((w) => w.trim()).filter(Boolean))];

  const db = new Database(dbPath);
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
        updatedSentenceRows = Number(db.prepare(sentenceSql).run(...plusIds).changes);
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
        normalIds = [...new Set(rows.map((r) => r.normal_id).filter((n) => Number.isInteger(n) && n > 0))];
      }

      if (normalIds.length === 0) {
        return {
          matchedNormalIds: 0,
          updatedSentenceRows,
          updatedPlus: 0,
          updatedMinus: 0,
          deleted: 0,
          skippedConflicts: conflicts.length,
          targetedPlusSentences: plusIds.length,
          targetedMinusSentences: minusIds.length,
        };
      }

      const normalPlaceholders = normalIds.map(() => "?").join(", ");
      let updatedPlus = 0;
      if (plusIds.length > 0) {
        const plusPlaceholders = plusIds.map(() => "?").join(", ");
        const plusSql = `UPDATE sentence_to_normal_link
                         SET weight = weight + 1
                         WHERE sentence_id IN (${plusPlaceholders})
                           AND normal_id IN (${normalPlaceholders})`;
        updatedPlus = Number(
          db.prepare(plusSql).run(...plusIds, ...normalIds).changes,
        );
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
