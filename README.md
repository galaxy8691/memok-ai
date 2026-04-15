# memok-ai

**memok-ai** 是一套面向长文与对话的 **记忆抽取与存储** 工具链：用大语言模型（OpenAI 兼容 API）把文章拆成「可检索的记忆单元」，写入 **SQLite** 中的词图与句图；并提供命令行批处理、结果导入，以及 **OpenClaw** 插件形式的自动落库。

实现语言为 **Node.js 18+** 与 **TypeScript**，对外暴露稳定的 **JSON 契约** 与 CLI，便于脚本集成或二次开发。

---

## 功能概览

| 能力 | 说明 |
|------|------|
| **整篇流水线（v2）** | 从单篇 `.txt` 依次完成：核心词抽取 → 同义归一 → 记忆句生成 → 句与词表合并，得到固定形状的二元组 JSON。 |
| **一步流水线** | `article-word-pipeline` 单次调用跑完全部 LLM 阶段，适合批处理与自动化。 |
| **SQLite 导入** | 将流水线产物导入 `words`、`normal_words`、`word_to_normal_link`、`sentences`、`sentence_to_normal_link` 等表，形成可查询的关联图。 |
| **批量文章处理** | 递归扫描目录下 `.txt`，逐篇跑流水线并写入 `outputs`，支持区间与跳过已存在文件。 |
| **批量导入 outputs** | 将目录中 `*-output.json` 批量导入同一数据库。 |
| **记忆抽样** | 从已导入库中按「随机抽样词 → 规范词 → 句」路径抽取句子子集，用于复习、抽检或下游提示词上下文。 |
| **OpenClaw 插件** | 在网关侧把对话增量写入同一套 SQLite 记忆库（可配置库路径与开关）。 |

当前 CLI **仅提供 v2 整篇流水线**（无旧版 v1 子命令）。

---

## 工作原理

### 整篇流水线（概念顺序）

1. **核心词**：从全文归纳原子级核心词列表。  
2. **归一**：对核心词做同义/写法归并，得到 `original_text → new_text` 映射表。  
3. **记忆句**：生成带编号、可独立理解的记忆句列表。  
4. **合并**：把「句 ↔ 句内核心词」与归一词表打成 **二元组**：`[ sentence_core 块, nomalized 块 ]`（字段名见下文「数据契约」）。

阶段之间通过 **JSON 文件** 衔接，便于单步调试与缓存中间结果。

### 与 SQLite 的关系

导入器读取上述二元组，维护 roughly 如下关系（具体以导入实现为准）：

- **词层**：`words`（原文词）、`normal_words`（规范形）、`word_to_normal_link`（词到规范词的边）。  
- **句层**：`sentences`（句子文本及权重、时长、是否短期等）、`sentence_to_normal_link`（句所绑定的规范词）。

之后的 **`extract-memory-sentences`** 在 **已导入** 的库上，从 `words` 随机抽一部分行，沿链接走到句子，再按短期/非短期规则组装输出 JSON。

---

## 环境要求

- **Node.js** 18 或更高  
- **npm**（本仓库脚本以 npm 为准）

安装依赖：

```bash
npm install
```

---

## 快速开始

1. 复制环境变量模板并填写 API Key：

   ```bash
   cp .env.example .env
   ```

2. 对单篇文章跑通流水线（示例路径按你本地仓库为准）：

   ```bash
   npm run dev -- article-word-pipeline ./articles/article1.txt > out/awp_v2_tuple.json
   ```

3. 导入到 SQLite（需已存在与导入逻辑匹配的表结构）：

   ```bash
   npm run dev -- import-awp-v2-tuple --from-json out/awp_v2_tuple.json --db ./memok.sqlite
   ```

4. 从库中抽样若干记忆句（JSON 打到 stdout）：

   ```bash
   npm run dev -- extract-memory-sentences --db ./memok.sqlite
   ```

---

## 配置说明（`.env`）

### 必填

- **`OPENAI_API_KEY`**：OpenAI 兼容接口的密钥。

### 常用可选

- **`OPENAI_BASE_URL`**：自定义网关或代理（如兼容 OpenAI 协议的第三方端点）。  
- **各阶段专用模型**（未设置时会按代码内定义的**回退链**落到通用变量，最终可到 `MEMOK_ARTICLE_LLM_MODEL` 等）：  
  - `MEMOK_V2_ARTICLE_CORE_WORDS_LLM_MODEL` — 整篇核心词  
  - `MEMOK_V2_ARTICLE_CORE_WORDS_NORMALIZE_LLM_MODEL` — 核心词归一  
  - `MEMOK_V2_ARTICLE_SENTENCES_LLM_MODEL` — 整篇记忆句  
- **`MEMOK_V2_ARTICLE_SENTENCES_MAX_OUTPUT_TOKENS`**：记忆句阶段输出 token 上限（默认 8192）。  
- **`MEMOK_CORE_WORDS_NORMALIZE_MAX_OUTPUT_TOKENS`**：归一阶段输出上限（默认较大；部分供应商分支会再 cap）。  
- **`MEMOK_SKIP_LLM_STRUCTURED_PARSE=1`**：强制走 `json_object` 等路径、跳过部分 structured 解析分支（遇兼容问题时可试）。  
- **`MEMOK_LLM_MAX_WORKERS`**：LLM 请求并发上限（`>1` 时，`article-word-pipeline` 内部分支可并发；过大请注意速率限制）。

完整示例与注释见仓库根目录 **`.env.example`**。

---

## 本地开发与构建

查看 CLI 帮助：

```bash
npm run dev -- --help
```

开发时直接执行 TypeScript 入口（无需先 build）：

```bash
npm run dev -- <子命令> [参数]
```

编译到 `dist/`：

```bash
npm run build
```

运行单元测试：

```bash
npm test
```

安装后也可使用包内提供的 **`memok-ai`** 可执行文件（见 `package.json` 的 `bin` 字段），行为与 `node dist/cli.js` 一致。

---

## CLI 命令参考

以下均可用 `npm run dev --` 前缀；构建后可用 `node dist/cli.js`。

### `article-core-words <article.txt>`

从整篇文本抽取核心词。

**输出示例：**

```json
{ "core_words": ["..."] }
```

### `article-core-words-normalize --from-json <path>`

读取上一步 JSON，做同义归一。

**输出示例：**

```json
{ "nomalized": [{ "original_text": "...", "new_text": "..." }] }
```

### `article-sentences <article.txt>`

生成整篇记忆句。

**输出示例：**

```json
{ "sentences": [{ "sentence": "..." }] }
```

### `article-sentence-core-combine`

合并「句 + 句内核心词」与归一词表。

**参数：**

- `--from-sentences-json`：上一步 `article-sentences` 的 JSON  
- `--from-normalized-json`：`article-core-words-normalize` 的 JSON  

**输出形状：** 顶层为 **长度为 2 的数组**（二元组）：

```json
[
  { "sentence_core": [{ "sentence": "...", "core_words": ["..."] }] },
  { "nomalized": [{ "original_text": "...", "new_text": "..." }] }
]
```

### `article-word-pipeline <article.txt>`

**一步**执行 v2 流水线中全部 LLM 阶段，输出形状与 `article-sentence-core-combine` 相同。

### `import-awp-v2-tuple`

将二元组 JSON 写入 SQLite。

**常用参数：**

- `--from-json`：二元组 JSON 文件路径  
- `--db`：SQLite 文件路径  
- `--as-of YYYY-MM-DD`：可选，写入句子等的编辑日期语义（见实现说明）

**注意：** 数据库需已具备导入逻辑所依赖的表结构；若从零开始，请使用与你环境匹配的建表脚本或已有模板库。

### `extract-memory-sentences`

在已有库上做 **words → 规范词 → 句子** 的抽样阅读，结果打印到 **stdout**（UTF-8 JSON，`indent=2`）。

**参数：**

- `--db`：SQLite 路径  
- `--fraction`：对 `words` 全表行数抽样比例，默认 `0.2`（至少 1 行，表非空时）  
- `--long-term-fraction`：非短期句池上的加权抽样比例，默认与 `--fraction` 相同  

**语义摘要：**

- 从 `words` 随机抽取约 `fraction` 比例的行，经 `word_to_normal_link`、`sentence_to_normal_link` 得到候选句。  
- **短期句**（`is_short_term === true`）：候选中**全部**保留，排在输出数组前段。  
- **非长期短期句**：在候选池中按 `weight + duration` **无放回加权随机**抽取约 `longTermFraction` 对应条数（具体公式见实现与测试）。  
- 每条带 **`matched_word`: `{ word, normal_word }`**：在本次抽样词顺序下，**最先**能连到该句的那条「表层词 → 规范词」边，便于解释「因哪个词命中该句」。

---

## 批量处理文章

脚本：`npm run batch`（`tsx src/scripts/runArticlesBatch.ts`）。

**默认行为：**

- 输入目录：`articles`（递归 `.txt`）  
- 输出目录：`outputs`  
- 默认 **跳过** 已存在的结果文件（便于断点续跑）

**示例：**

```bash
npm run batch
npm run batch -- --input-dir articles/corpus_txts --output-dir outputs
npm run batch -- --input-dir articles/corpus_txts --from 0 --to 99
npm run batch -- --input-dir articles/corpus_txts --no-skip-existing
```

**参数：**

| 参数 | 含义 |
|------|------|
| `--input-dir` | 输入根目录 |
| `--output-dir` | 输出根目录 |
| `--from` / `--to` | 按排序后的文件索引区间（含端点） |
| `--skip-existing` / `--no-skip-existing` | 是否跳过已有输出 |

失败记录写入本次 **`--output-dir`** 下的 **`batch-errors.log`**（默认即 `outputs/batch-errors.log`）。

---

## 批量导入 `outputs` 到 SQLite

```bash
npm run import:outputs -- --db ./memok.sqlite
```

**默认：**

- 读取目录：`outputs`  
- 仅处理匹配 `*-output.json` 的文件  
- 允许重复导入（同一句子可能多次出现，取决于导入实现策略）

**常用参数：**

```bash
npm run import:outputs -- --input-dir outputs --db ./memok.sqlite
npm run import:outputs -- --db ./memok.sqlite --from 0 --to 99
npm run import:outputs -- --db ./memok.sqlite --as-of 2026-04-14
```

有失败条目时，错误日志固定写入仓库工作目录下的 **`outputs/import-errors.log`**（与 `--input-dir` 无关；脚本会确保 `outputs` 目录存在）。

---

## OpenClaw 扩展

本仓库可作为 **OpenClaw** 插件使用：在网关加载后，按会话把对话文本增量写入配置的 SQLite（与 CLI 导入共用同一套表语义时，即可统一查询）。

- **清单**：根目录 `openclaw.plugin.json`（扩展 id、人类可读名称、配置项说明）。  
- **配置项**：例如 **`dbPath`**（数据库文件路径）、**`enabled`**（是否启用自动保存）。  
- **环境变量**：插件侧可使用 **`MEMOK_MEMORY_DB`** 覆盖默认库路径（便于开发与多环境隔离）。

具体钩子与节流策略见 **`src/plugin.ts`** 源码注释与实现。

---

## 数据契约与字段约定

### 顶层 JSON 形状

- 流水线各阶段输出均为 **明确键名** 的对象或 **固定长度数组**（二元组），便于 `zod` 校验与自动化测试。  
- 导入与抽样 CLI 依赖这些形状；自行生成 JSON 时请保持一致。

### 为何是 `nomalized` 而不是 `normalized`？

对外 JSON 键名 **`nomalized`** 为项目长期沿用的**稳定拼写**（历史数据与下游解析已依赖该字段名）。请勿在产物中「改正」为 `normalized`，否则导入与校验会失败。

### LLM 与 token 参数

对不同供应商，请求体里 `max_tokens` 与 `max_completion_tokens` 等字段的支持程度不一；实现内已对常见兼容网关（如 DeepSeek 路径）做了分支，无需在 README 层重复罗列；若遇 400 类参数错误，可查阅源码 `src/llm/` 或提 issue 时附上完整错误响应。

---

## 常见问题

**Q: 只有文章文件，最少要执行哪几条命令？**  
A: 一条 `article-word-pipeline` 得到二元组，再 `import-awp-v2-tuple` 导入即可。

**Q: 抽样结果每次不同？**  
A: 预期行为。随机性来自 `words` 子集抽样与非短期句的加权无放回抽样；短期句集合在固定库与固定参数下相对稳定，但仍受候选收集顺序影响。

**Q: 数据库表从哪里来？**  
A: 本 README 不捆绑特定「建表 SQL」发行物；请使用你环境中已有的 memok 兼容 schema，或与团队维护的初始化脚本保持一致。

---

## 许可证

见仓库内 `package.json` 的 `license` 字段（当前为 **ISC**）。
