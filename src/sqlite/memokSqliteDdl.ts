/**
 * 包内 SQLite 初始化与加固用 DDL（不通过 `memok-ai` / `memok-ai/bridge` 根入口导出）。
 * 由 `memokSchema`、`persistDreamPipelineLog`、`hardenDb` 引用。
 */

/** `dream_logs` 建表片段（与 `persistDreamPipelineLogToDb` 一致，嵌入 `memokCoreTablesDdl`）。 */
export const dreamLogsTableDdl = `CREATE TABLE IF NOT EXISTS dream_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dream_date TEXT NOT NULL,
  ts TEXT NOT NULL,
  status TEXT NOT NULL,
  log_json TEXT NOT NULL
);`;

/** `word_to_normal_link` 清理与索引（与 `hardenDb` 行为一致）。 */
export const memokWordToNormalLinkHardenDdl = `
DELETE FROM word_to_normal_link WHERE normal_id IS NULL;
DELETE FROM word_to_normal_link
WHERE normal_id IS NOT NULL
  AND rowid NOT IN (
    SELECT MIN(rowid)
    FROM word_to_normal_link
    WHERE normal_id IS NOT NULL
    GROUP BY word_id, normal_id
  );
CREATE INDEX IF NOT EXISTS idx_word_to_normal_link_word_id ON word_to_normal_link(word_id);
CREATE INDEX IF NOT EXISTS idx_word_to_normal_link_normal_id ON word_to_normal_link(normal_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_word_to_normal_link_word_normal ON word_to_normal_link(word_id, normal_id) WHERE normal_id IS NOT NULL;
`.trim();

/** `sentence_to_normal_link` 清理与索引（与 `hardenDb` 行为一致）。 */
export const memokSentenceToNormalLinkHardenDdl = `
DELETE FROM sentence_to_normal_link
WHERE rowid NOT IN (
  SELECT MIN(rowid)
  FROM sentence_to_normal_link
  GROUP BY sentence_id, normal_id
);
CREATE INDEX IF NOT EXISTS idx_sentence_to_normal_link_sentence_id ON sentence_to_normal_link(sentence_id);
CREATE INDEX IF NOT EXISTS idx_sentence_to_normal_link_normal_id ON sentence_to_normal_link(normal_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sentence_to_normal_link_sentence_normal ON sentence_to_normal_link(sentence_id, normal_id);
`.trim();

/** 两张 link 表的加固脚本（幂等）。 */
export const memokLinkHardenDdl =
  `${memokWordToNormalLinkHardenDdl}\n${memokSentenceToNormalLinkHardenDdl}`.trim();

/**
 * 仅 `CREATE TABLE`（含 `dream_logs`），不含 link 表加固；与 `importAwpV2Tuple` 所假设的核心结构一致。
 *
 * **外键**：`word_to_normal_link` / `sentence_to_normal_link` 声明 `REFERENCES … ON DELETE CASCADE`；
 * 执行前须 `PRAGMA foreign_keys = ON`。
 */
export const memokCoreTablesDdl = `
CREATE TABLE IF NOT EXISTS words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS normal_words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS sentences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sentence TEXT,
  weight INTEGER,
  duration INTEGER,
  last_edit_date TEXT,
  is_short_term INTEGER,
  duration_change_times INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS word_to_normal_link (
  word_id INTEGER NOT NULL REFERENCES words(id) ON DELETE CASCADE,
  normal_id INTEGER NOT NULL REFERENCES normal_words(id) ON DELETE CASCADE,
  weight INTEGER
);
CREATE TABLE IF NOT EXISTS sentence_to_normal_link (
  normal_id INTEGER NOT NULL REFERENCES normal_words(id) ON DELETE CASCADE,
  sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
  weight INTEGER
);

${dreamLogsTableDdl}
`.trim();

/** 建表 + link 加固（去重 + 索引）的完整脚本（`applyMemokSqliteSchema` 单次 `exec`）。 */
export const memokInitDatabaseDdl =
  `${memokCoreTablesDdl.trim()}\n${memokLinkHardenDdl}\n`.trim();

/** 与 {@link memokInitDatabaseDdl} 相同（兼容旧名）。 */
export const memokFullSchemaDdl = memokInitDatabaseDdl;
