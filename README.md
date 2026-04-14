# memok-ai

`memok-ai` 是 `memok` 的 Node/TypeScript 版实现，当前仅复现 **v2 整篇流水线**（不含 v1）。

目标是保持与 Python 版 v2 的行为对齐：

- JSON 契约与字段名一致（包含 `nomalized` 拼写）
- LLM 提示词尽量逐字复用已调教版本
- v2 主流程与后处理一致（核心词拆分、归一补全、句子截断等）
- 支持 `article-word-pipeline` 二元组输出与 SQLite 导入

## 1. 环境准备

- Node.js 18+
- npm（本项目当前使用 npm）

安装依赖：

```bash
npm install
```

## 2. 配置环境变量

先复制示例配置：

```bash
cp .env.example .env
```

至少填写：

- `OPENAI_API_KEY`

可选：

- `OPENAI_BASE_URL`（兼容网关/代理，如 DeepSeek 兼容端点）
- 各阶段 `MEMOK_*_MODEL`
- 并发：`MEMOK_LLM_MAX_WORKERS`
- 强制 JSON object 模式：`MEMOK_SKIP_LLM_STRUCTURED_PARSE=1`

## 3. 开发与构建

开发模式（直接跑 TS CLI）：

```bash
npm run dev -- --help
```

构建：

```bash
npm run build
```

测试：

```bash
npm test
```

## 4. CLI 命令（仅 v2）

### 4.1 抽取整篇核心词

```bash
npm run dev -- article-core-words ./articles/article1.txt > out/article_core_words_v2.json
```

输出形状：

```json
{ "core_words": ["..."] }
```

### 4.2 核心词同义归一

```bash
npm run dev -- article-core-words-normalize --from-json out/article_core_words_v2.json > out/article_core_words_nomalized_v2.json
```

输出形状：

```json
{ "nomalized": [{ "original_text": "...", "new_text": "..." }] }
```

### 4.3 生成整篇记忆句

```bash
npm run dev -- article-sentences ./articles/article1.txt > out/article_sentences_v2.json
```

输出形状：

```json
{ "sentences": [{ "sentence": "..." }] }
```

### 4.4 合并句子与归一词表

```bash
npm run dev -- article-sentence-core-combine --from-sentences-json out/article_sentences_v2.json --from-normalized-json out/article_core_words_nomalized_v2.json > out/article_sentence_core_tuple_v2.json
```

输出形状（顶层数组，长度 2）：

```json
[
  { "sentence_core": [{ "sentence": "...", "core_words": ["..."] }] },
  { "nomalized": [{ "original_text": "...", "new_text": "..." }] }
]
```

### 4.5 一步跑完 v2 流水线

```bash
npm run dev -- article-word-pipeline ./articles/article1.txt > out/awp_v2_tuple.json
```

输出形状与 `article-sentence-core-combine` 相同（也是二元组 JSON 数组）。

## 5. 导入 SQLite

```bash
npm run dev -- import-awp-v2-tuple --from-json out/awp_v2_tuple.json --db ./memok.sqlite
```

指定导入日期（写入 `last_edit_date`）：

```bash
npm run dev -- import-awp-v2-tuple --from-json out/awp_v2_tuple.json --db ./memok.sqlite --as-of 2026-04-14
```

注意：导入前请确保数据库已存在对应表结构（与 Python 版 schema 一致）。

## 5.1 批量处理 articles 到 outputs

新增批处理脚本会递归扫描输入目录下所有 `.txt`，顺序执行 `article-word-pipeline` 并输出到 `outputs`。

默认执行：

```bash
npm run batch
```

等价于：

- 输入目录：`articles`
- 输出目录：`outputs`
- 默认跳过已存在结果文件（便于断点续跑）

常用参数：

```bash
npm run batch -- --input-dir articles/corpus_txts --output-dir outputs
npm run batch -- --input-dir articles/corpus_txts --from 0 --to 99
npm run batch -- --input-dir articles/corpus_txts --no-skip-existing
```

参数说明：

- `--input-dir`：输入目录（递归找 `.txt`）
- `--output-dir`：输出目录
- `--from` / `--to`：按排序后的索引区间处理（包含边界）
- `--skip-existing`（默认）/ `--no-skip-existing`

失败文件会记录到：`outputs/batch-errors.log`。

## 5.2 批量把 outputs 导入 SQLite

当 `outputs` 里已有很多 `*-output.json` 时，可以一次性导入：

```bash
npm run import:outputs -- --db ./memok.sqlite
```

默认行为：

- 输入目录：`outputs`
- 只处理 `*-output.json`
- 使用导入台账表 `imported_outputs`，默认跳过已导入文件（支持断点续跑）

常用参数：

```bash
npm run import:outputs -- --input-dir outputs --db ./memok.sqlite
npm run import:outputs -- --db ./memok.sqlite --from 0 --to 99
npm run import:outputs -- --db ./memok.sqlite --no-skip-imported
npm run import:outputs -- --db ./memok.sqlite --as-of 2026-04-14
```

失败文件会记录到：`outputs/import-errors.log`。

## 6. 与 Python 版对齐说明

- 仅实现 v2，不实现 v1 子命令
- 提示词基线来自 Python v2 三个模块，并有一致性测试保护
- `MEMOK_LLM_MAX_WORKERS > 1` 时，`article-word-pipeline` 会并发执行两条分支

## 7. 常见问题

- **Q: 为什么字段是 `nomalized` 不是 `normalized`？**  
  A: 为了兼容旧产物和 Python 版契约，保留历史拼写。

- **Q: DeepSeek/兼容网关下 token 参数不同怎么办？**  
  A: 已内置分支：DeepSeek 路径优先 `max_tokens`，其他路径优先 `max_completion_tokens`。
