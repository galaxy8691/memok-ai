import { z } from "zod";
import { openSqlite } from "../../sqlite/openSqlite.js";
import { NormalWordRelevanceBucketsSchema } from "./buildRelevanceBuckets.js";

export const NormalWordLinkFeedbackInputSchema = z
  .object({
    words: z.array(z.string()),
    normalWordBuckets: NormalWordRelevanceBucketsSchema,
  })
  .strict();

export type NormalWordLinkFeedbackInput = z.infer<
  typeof NormalWordLinkFeedbackInputSchema
>;

export type ApplyNormalWordLinkFeedbackResult = {
  matchedWordIds: number;
  updatedPlus: number;
  /** 高分 normal_id 与本轮 story `words` 之间原本无 link，新建 weight=1 的行数 */
  insertedPlusLinks: number;
  updatedMinus: number;
  deleted: number;
  skippedConflicts: number;
  targetedPlusNormalWords: number;
  targetedMinusNormalWords: number;
};

function uniqIntIds(ids: number[]): number[] {
  return [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))];
}

/**
 * 根据 normal_word 分桶与本轮故事关键词 `words`，回写 `word_to_normal_link`：
 * - `id_ge_60` 的 normal_id：已有 link 则 weight + 1；与本轮 `words` 对应 `word_id` 尚无 link 则 **INSERT weight=1**
 * - `id_lt_40` 的 normal_id：weight - 1；若 weight <= 0 则删除该行
 * - 同一 normal_id 同时出现在高低分桶则跳过（与句子侧冲突规则一致）
 */
export function applyNormalWordLinkFeedback(
  dbPath: string,
  input: NormalWordLinkFeedbackInput,
): ApplyNormalWordLinkFeedbackResult {
  const parsed = NormalWordLinkFeedbackInputSchema.parse(input);
  const plusIdsRaw = uniqIntIds(parsed.normalWordBuckets.id_ge_60);
  const minusIdsRaw = uniqIntIds(parsed.normalWordBuckets.id_lt_40);
  const minusSet = new Set(minusIdsRaw);
  const conflicts = plusIdsRaw.filter((id) => minusSet.has(id));
  const conflictSet = new Set(conflicts);
  const plusIds = plusIdsRaw.filter((id) => !conflictSet.has(id));
  const minusIds = minusIdsRaw.filter((id) => !conflictSet.has(id));
  const words = [...new Set(parsed.words.map((w) => w.trim()).filter(Boolean))];

  const db = openSqlite(dbPath);
  try {
    db.pragma("foreign_keys = ON");
    const runTx = db.transaction((): ApplyNormalWordLinkFeedbackResult => {
      let wordIds: number[] = [];
      if (words.length > 0) {
        const placeholders = words.map(() => "?").join(", ");
        const rows = db
          .prepare(
            `SELECT DISTINCT w.id AS word_id FROM words w WHERE w.word IN (${placeholders})`,
          )
          .all(...words) as { word_id: number }[];
        wordIds = [
          ...new Set(
            rows
              .map((r) => r.word_id)
              .filter((n) => Number.isInteger(n) && n > 0),
          ),
        ];
      }

      if (wordIds.length === 0) {
        return {
          matchedWordIds: 0,
          updatedPlus: 0,
          insertedPlusLinks: 0,
          updatedMinus: 0,
          deleted: 0,
          skippedConflicts: conflicts.length,
          targetedPlusNormalWords: plusIds.length,
          targetedMinusNormalWords: minusIds.length,
        };
      }

      const wordPlaceholders = wordIds.map(() => "?").join(", ");

      let updatedPlus = 0;
      let insertedPlusLinks = 0;
      if (plusIds.length > 0) {
        const sel = db.prepare(
          `SELECT 1 AS ok FROM word_to_normal_link WHERE word_id = ? AND normal_id = ? LIMIT 1`,
        );
        const upd = db.prepare(
          `UPDATE word_to_normal_link SET weight = weight + 1 WHERE word_id = ? AND normal_id = ?`,
        );
        const ins = db.prepare(
          `INSERT INTO word_to_normal_link (word_id, normal_id, weight) VALUES (?, ?, 1)`,
        );
        for (const wid of wordIds) {
          for (const nid of plusIds) {
            if (sel.get(wid, nid) !== undefined) {
              updatedPlus += Number(upd.run(wid, nid).changes);
            } else {
              ins.run(wid, nid);
              insertedPlusLinks += 1;
            }
          }
        }
      }

      let updatedMinus = 0;
      let deleted = 0;
      if (minusIds.length > 0) {
        const minusNormPh = minusIds.map(() => "?").join(", ");
        const minusSql = `UPDATE word_to_normal_link
                          SET weight = weight - 1
                          WHERE normal_id IN (${minusNormPh})
                            AND word_id IN (${wordPlaceholders})`;
        updatedMinus = Number(
          db.prepare(minusSql).run(...minusIds, ...wordIds).changes,
        );
        const deleteSql = `DELETE FROM word_to_normal_link
                           WHERE normal_id IN (${minusNormPh})
                             AND word_id IN (${wordPlaceholders})
                             AND weight <= 0`;
        deleted = Number(
          db.prepare(deleteSql).run(...minusIds, ...wordIds).changes,
        );
      }

      return {
        matchedWordIds: wordIds.length,
        updatedPlus,
        insertedPlusLinks,
        updatedMinus,
        deleted,
        skippedConflicts: conflicts.length,
        targetedPlusNormalWords: plusIds.length,
        targetedMinusNormalWords: minusIds.length,
      };
    });
    return runTx();
  } finally {
    db.close();
  }
}
