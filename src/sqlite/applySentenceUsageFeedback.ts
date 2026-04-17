import { openSqlite } from "./openSqlite.js";

export type ApplySentenceUsageFeedbackOptions = {
  /** 与 `awpV2Import` 一致，默认 `YYYY-MM-DD`（UTC） */
  lastEditDate?: string;
};

/**
 * Agent 确认采用某条候选句时：`weight` 每次 +1；`last_edit_date` 更新为当日。
 * `duration_change_times` 表示**当天**已累计的时长变更次数（非「终身」）。
 * 下方 SQL 的 `CASE` 按顺序**只命中第一个**成立分支，故**每条反馈**在 `duration` 上最多 +1，不存在「跨日规则 + 同日规则」叠成 +2。
 * - 若原 `last_edit_date` 不是今天：仅本分支 → `duration` +1，`duration_change_times` = 1（当日第 1 次变更）；
 * - 否则若已是今天且 `duration_change_times` < 3：`duration` +1，`duration_change_times` +1；
 * - 否则（今日已满 3 次）：`duration` 不变（`weight` 仍 +1）。
 */
export function applySentenceUsageFeedback(
  dbPath: string,
  sentenceIds: number[],
  opts?: ApplySentenceUsageFeedbackOptions,
): { updatedCount: number } {
  const ids = [
    ...new Set(
      sentenceIds.filter(
        (n) => typeof n === "number" && Number.isInteger(n) && n > 0,
      ),
    ),
  ];
  if (ids.length === 0) {
    return { updatedCount: 0 };
  }
  const dateStr = opts?.lastEditDate ?? new Date().toISOString().slice(0, 10);
  const db = openSqlite(dbPath);
  try {
    db.pragma("foreign_keys = ON");
    const stmt = db.prepare(
      `UPDATE sentences SET
        weight = weight + 1,
        last_edit_date = ?,
        -- CASE 自上而下仅一条生效；与 duration_change_times 的 CASE 对应同一套条件
        duration = duration + CASE
          WHEN last_edit_date IS NULL OR last_edit_date != ? THEN 1
          WHEN COALESCE(duration_change_times, 0) < 3 THEN 1
          ELSE 0
        END,
        duration_change_times = CASE
          WHEN last_edit_date IS NULL OR last_edit_date != ? THEN 1
          WHEN COALESCE(duration_change_times, 0) < 3 THEN COALESCE(duration_change_times, 0) + 1
          ELSE COALESCE(duration_change_times, 0)
        END
      WHERE id = ?`,
    );
    const run = db.transaction(() => {
      let changes = 0;
      for (const id of ids) {
        changes += Number(stmt.run(dateStr, dateStr, dateStr, id).changes);
      }
      return changes;
    });
    return { updatedCount: run() };
  } finally {
    db.close();
  }
}
