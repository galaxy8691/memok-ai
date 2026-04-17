import { openSqlite } from "../../sqlite/openSqlite.js";

export type DeleteOrphanNormalWordsResult = {
  count: number;
  ids: number[];
};

/**
 * 删除「无 word_to_normal_link 且无 sentence_to_normal_link」的 normal_words。
 * 仅有句子边（仅有 sentence_to_normal_link）或仍有词锚定（word_to_normal_link）的均保留。
 */
export function deleteOrphanNormalWords(
  dbPath: string,
): DeleteOrphanNormalWordsResult {
  const db = openSqlite(dbPath);
  try {
    db.pragma("foreign_keys = ON");
    const runTx = db.transaction((): DeleteOrphanNormalWordsResult => {
      const rows = db
        .prepare(
          `SELECT nw.id AS id
           FROM normal_words nw
           WHERE NOT EXISTS (SELECT 1 FROM word_to_normal_link w WHERE w.normal_id = nw.id)
             AND NOT EXISTS (SELECT 1 FROM sentence_to_normal_link s WHERE s.normal_id = nw.id)`,
        )
        .all() as { id: number }[];
      const ids = rows
        .map((r) => r.id)
        .filter((id) => Number.isInteger(id) && id > 0);
      if (ids.length === 0) {
        return { count: 0, ids: [] };
      }
      const placeholders = ids.map(() => "?").join(", ");
      const del = db.prepare(
        `DELETE FROM normal_words WHERE id IN (${placeholders})`,
      );
      del.run(...ids);
      return { count: ids.length, ids };
    });
    return runTx();
  } finally {
    db.close();
  }
}
