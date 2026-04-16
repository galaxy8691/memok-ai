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
| **梦境叙事（dreaming-pipeline）** | 从 `words` 表随机抽样至多 **10** 个词（可调），调用 LLM 写一段光怪陆离的短篇梦幻叙事（纯文本）。 |
| **OpenClaw 插件** | 在网关侧把对话增量写入同一套 SQLite 记忆库（可配置库路径与开关）。 |

当前 CLI **以 v2 整篇流水线为主**，并含 **`dream`**（词表抽样 + 梦幻叙事）等辅助命令（无旧版 v1 子命令）。

---

## 工作原理

### 整篇流水线（概念顺序）

1. **核心词**：从全文归纳原子级核心词列表。  
2. **归一**：对核心词做同义/写法归并，得到 `original_text → new_text` 映射表。  
3. **记忆句**：生成带编号、可独立理解的记忆句列表。  
4. **合并**：把「句 ↔ 句内核心词」与归一词表打成 **二元组**：`[ sentence_core 块, nomalized 块 ]`（字段名见下文「数据契约」）。  
5. **脱敏**：合并完成后会对二元组内所有字符串字段做 **`HEARTBEAT` / `HEARTBEAT_OK` / `HEARTBEAT.md`** 无害化，并剥离常见 **OpenClaw 心跳/定时提醒英文模板**、**`A scheduled reminder…` 块**、**「执行 HEARTBEAT.md 检查清单」中文清单**等（见 `src/utils/scrubOpenclawHeartbeatArtifacts.ts`），避免写入记忆库后在 OpenClaw 侧误触心跳语义。插件在 **`agent_end` / `message_sent` 落库前** 也会对整段 transcript 调用同一套清洗。

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

## 🧠 核心架构

### 设计理念（类脑模拟）

| 人脑机制 | memok 实现 |
|---------|-----------|
| **海马体索引** | 随机采样 + 词汇关联召回 |
| **突触可塑性** | 权重系统（使用即强化） |
| **睡眠记忆重放** | 梦境函数（夜间 cron 任务） |
| **主动遗忘** | 权重衰减 + 低频淘汰 |
| **自由联想** | 允许无关词激活，不强求精准匹配 |

### 数据流 Pipeline

```
原始文本输入
    ↓
【分段处理】→ 切成句子/段落
    ↓
【核心提取】→ LLM 提取 core_idea + core_words（5-10个关键词）
    ↓
【归一化】→ 同义词合并（如"AI"和"人工智能"→"AI"）
    ↓
【存储】→ SQLite（words + normal_words + sentences + 关联表）
    ↓
【召回】→ 随机抽样词汇 → 关联到句子 → 返回候选记忆
    ↓
【整合】→ 小模型根据查询整合相关记忆
```

### 数据库结构

| 表名 | 作用 |
|------|------|
| `words` | 原始词（每次出现的具体词汇） |
| `normal_words` | 归一化词（"AI"、"人工智能"统一后的标准词） |
| `word_to_normal_link` | 原始词 → 标准词的映射 |
| `sentences` | 句子内容 + 权重 + 时长 + `last_edit_date` + 是否短期 +（若 schema 已升级）**`duration_change_times`**（**当日**时长变更次数，跨日重置；默认 0） |
| `sentence_to_normal_link` | 句子 ↔ 标准词的关联（核心！）|

### 核心机制详解

#### 召回机制（非向量检索）
- **不依赖向量相似度**
- **随机采样**：从 `words` 表随机抽 20% 词汇
- **关联召回**：通过 `word_to_normal_link` → `sentence_to_normal_link` 找到相关句子
- **权重影响**：权重高、时间近的词更容易被抽中

#### 权重系统（Hebbian Learning）
- **初始权重**：新记忆默认权重
- **使用强化**：每次被召回，权重 +1
- **时间衰减**：旧记忆权重逐渐降低
- **梦境更新**：夜间批量调整权重，淘汰低权重复记忆

#### 梦境函数（夜间批处理）
```cron
每晚 3:00 AM 触发：
1. 扫描所有记忆
2. 合并相似记忆（core_idea 相似度高的合并）
3. 更新权重（使用时间衰减公式）
4. 删除权重 < 阈值的记忆（遗忘）
5. 生成"记忆摘要"供快速检索
```

### 关键特性

| 特性 | 说明 |
|------|------|
| **接受混乱** | 不追求 100% 精准召回，允许"噪音"激活联想 |
| **无需归一** | 不强求同义词完全合并，靠随机采样软关联 |
| **自我遗忘** | 主动清理低频记忆，避免数据库无限膨胀 |
| **小模型友好** | 召回后用小模型整合，不依赖大模型长上下文 |

### 与 OpenClaw 集成

```
用户发送消息
    ↓
OpenClaw 处理消息
    ↓
memok-ai 插件触发：
  - 存储当前对话到 SQLite
  - 随机召回相关历史记忆
    ↓
将候选记忆注入提示词（@@@MEMOK_RECALL_START@@@ ... @@@MEMOK_RECALL_END@@@）
    ↓
AI 根据这些记忆 + 当前查询回复
    ↓
回复被记录，形成闭环
```

### 当前实现状态

| 功能模块 | 状态 |
|---------|------|
| 存储层（SQLite）| ✅ 已实现 |
| 召回层（随机采样）| ✅ 已实现 |
| 核心提取（LLM）| ✅ 已实现（5-10词/句）|
| 梦境函数（权重更新）| 🔄 待实现 |
| FTS5 精准检索 | 🔄 待实现 |
| 记忆合并/遗忘 | 🔄 待实现 |

### 长期愿景

> 让 AI 拥有类似人脑的"模糊记忆"能力——不是精确搜索，而是"提到这个词，让我想起那次对话"的联想式回忆。

这是一个**反传统**的设计：
- 不用向量数据库（Chroma/Pinecone）
- 不做精确相似度匹配
- 允许遗忘和混乱
- 追求"记忆的形状"而非完美存储

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
- **`MEMOK_LLM_MODEL`**：**默认模型**，整篇流水线各阶段共用（一般只配这一项即可）。  
- **`MEMOK_DREAMING_LLM_MODEL`**（可选）：**`dream`** 子命令专用；未设时与 `MEMOK_LLM_MODEL` 相同。  
- **按需覆盖**：`MEMOK_V2_ARTICLE_CORE_WORDS_LLM_MODEL`、`MEMOK_V2_ARTICLE_CORE_WORDS_NORMALIZE_LLM_MODEL`、`MEMOK_V2_ARTICLE_SENTENCES_LLM_MODEL` 等（仅当某一阶段要用不同模型时再设；解析顺序见各模块 `resolveModel`）。  
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

### `dream`

从 **`words` 表**无放回随机抽样至多 **`--max-words`** 个词（默认 **10**；若表内词总数更少则全部抽中），调用 LLM 生成一段**中文梦幻叙事**，**纯文本**打印到 stdout（非 JSON）。需配置 **`OPENAI_API_KEY`**（及可选 **`OPENAI_BASE_URL`**）；可选用 **`MEMOK_DREAMING_LLM_MODEL`** 覆盖默认模型。

**手测示例：**

```bash
npm run dev -- dream --db ./memok.sqlite
```

### `sentence-relevance`

从 `sentences` 表随机抽样约 **20%**（至少 1 条，表非空），与给定 `story` 组成：

```json
{
  "story": "string",
  "sentences": [{ "id": 1, "sentence": "..." }]
}
```

交给 LLM 对每条句子做相关性评分，输出 JSON：

```json
{
  "sentences": [{ "id": 1, "score": 87 }]
}
```

约束：`score` 为 `0-100` 整数；输出条数与输入抽样条数一致；输出 id 集合必须与输入一致。

**手测示例：**

```bash
# 文件输入
npm run dev -- sentence-relevance --db ./memok.sqlite --story ./story.txt

# 直接文本输入
npm run dev -- sentence-relevance --db ./memok.sqlite --story-text "夜里我看见海上的灯塔在说话。"
```

### `story-sentence-buckets`

一键手测完整链路（无需先准备现成 story）：

1. 从 `words` 表随机抽样最多 10 个词（可调）  
2. 用这些词生成梦幻故事  
3. 从 `sentences` 表随机抽样约 20% 句子做相关性评分  
4. 输出分桶：`id_ge_50`（`score >= 50`）与 `id_lt_50`

**命令示例：**

```bash
npm run dev -- story-sentence-buckets --db ./memok.sqlite
```

可选参数：

- `--max-words`：故事生成词数上限（默认 10）
- `--fraction`：句子抽样比例（默认 0.2）

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

- **清单**：根目录 `openclaw.plugin.json`（扩展 id、人类可读名称、**捆绑技能** `skills/memok-memory`、配置项说明）。  
- **配置项**：  
  - **`dbPath`**：SQLite 路径（支持 `~/…`）。  
  - **`enabled`**：为 `false` 时整插件不注册（含保存与候选记忆）。  
  - **`memoryInjectEnabled`**：是否启用候选记忆与反馈工具（默认 `true`；与对话落库独立）。  
  - **`memoryRecallMode`**：候选记忆如何送达模型（默认 **`skill+hint`**，与 manifest 一致）。**`skill`**：仅 **`appendSystemContext`** 强制附带候选 + 工具同轮再抽样。**`skill+hint`**：同上，并额外 **`prependSystemContext` + `prependContext`** 同句提示，且在 **`appendSystemContext`** 开头再写一行 **【memok】** 说明（因部分 Web UI 不展示运行期 prepend，便于在系统区看到）。**`prepend`**：整块 **`prependContext`**（旧行为）。  
  - **`persistTranscriptToMemory`**：是否在 **`agent_end` / `message_sent`** 时把对话 transcript 再跑 **`saveTextToMemoryDb`** 写入 SQLite（**默认 `true`**）。候选记忆块由 **`@@@MEMOK_RECALL_START@@@` … `@@@MEMOK_RECALL_END@@@`** 定界，落库前会整段剥离，避免把注入内容再灌回图库；若你**完全不要**对话落库，可显式设为 **`false`**。  
  - **`extractFraction` / `longTermFraction` / `maxInjectChars`**：抽样与 CLI 相同的 `extractMemorySentencesByWordSample` 逻辑；**prepend** 模式限制 `prependContext` 长度，**skill** 模式限制工具返回文本长度。  
  - **`memoryFeedbackLogPath`**：模型调用 **`memok_report_used_memory_ids`** 且 **`sentenceIds` 非空**时，向该路径 **追加一行 JSON**（便于调试；字段含原始 **`sentenceIds`**、校验后的 **`validIds`**、**`updatedCount`**；写库失败时可能含 **`dbError`**）。与 SQLite 更新**并行**，默认 `~/.openclaw/extensions/memok-ai/memory-feedback.jsonl`。  
- **环境变量**：**`MEMOK_MEMORY_DB`** 可覆盖默认 **`dbPath`**（便于开发与多环境隔离）。

### 记忆读取与反馈（插件内）

1. **技能 `memok-memory`**（`skills/memok-memory/SKILL.md`）：说明何时先召回、再作答、再上报。网关需加载插件声明的 **`skills`** 后，Agent 才能按技能描述使用记忆流程。  
2. **`before_prompt_build` 分支**：**`prepend`** 时整块 **`prependContext`**。**`skill`** / **`skill+hint`** 时每轮在钩子内抽样，**整块候选强制写入 `appendSystemContext`**；**`skill+hint`** 另有一行极短 **`prependContext`** 提示工具与系统块位置。  
3. **Agent 工具 `memok_recall_candidate_memories`**（**`memoryInjectEnabled`** 时注册）：无参数；**`prepend`** 下可在本轮内再抽样；**`skill`** 下用于**同一轮内**自愿再抽一批并刷新候选 id。  
4. **Agent 工具 `memok_report_used_memory_ids`**：参数 `{ "sentenceIds": number[] }`。当模型**确实采用**了本轮候选（prepend 块或召回工具返回）中的条目时，应调用该工具上报对应 **`id`**（与 `[id=…]` 一致）。未采用则不应调用。  
5. **反馈写库 + JSONL**：对**本轮可校验的候选 id**（与钩子/召回工具写入会话缓存的列表一致）中实际传入的 id，在 **`sentences`** 表上更新：**`weight` 每次反馈 +1**（**不限制**）；**`last_edit_date`** 设为当日（`YYYY-MM-DD`，UTC 日期）。**`duration`**：**若原 `last_edit_date` 不是今天**，则把当日计数视为从 0 开始并 **`duration` +1**、**`duration_change_times` = 1**；**若已是今天**且 **`duration_change_times` < 3**，则 **`duration` 与 `duration_change_times` 各 +1**（即同一天内 **`duration` 最多因反馈 +3**）。不在候选内的 id 会被忽略（并打日志）。每次**非空**上报还会向 **`memoryFeedbackLogPath`** 追加一行 JSON（调试用，与写库并行）。

**说明**：候选句的抽样方式与 CLI `extract-memory-sentences` 相同，**与当前用户单句 prompt 无语义对齐**；若需「按用户词检索」，需在 read-memory-pipeline 侧另行增强。  
注入正文会对 **`HEARTBEAT` / `HEARTBEAT_OK` / `HEARTBEAT.md`** 做无害化断字，并剥离与网关相同的心跳/提醒模板片段，避免模型复述后触发 OpenClaw 心跳应答逻辑。写入记忆库的 transcript 在保存前也会走同一套逻辑，并会剔除 **`@@@MEMOK_RECALL_*@@@`** 定界块及旧版 **`【memok-ai 候选记忆】`** 回显（见 `stripMemokInjectEchoFromTranscript`）。

具体钩子、游标保存与工具实现见 **`src/plugin.ts`**。

### 排查：看不到 `@@@MEMOK_RECALL_*` / 系统提示句 / 工具？

1. **先确认网关侧插件已加载**（在装网关的机器上执行）：  
   `openclaw plugins inspect memok-ai`  
   若 JSON 里 **`toolNames`** 含 **`memok_recall_candidate_memories`** 与 **`memok_report_used_memory_ids`**，说明插件与工具注册正常；问题在「你看的界面 / 会话」而非安装包本身。

2. **默认 `memoryRecallMode: skill+hint`（以及 `skill`）时，用户气泡里往往看不到 `@@@MEMOK_RECALL_START@@@`**：整块候选在 **`appendSystemContext`**；仅 **`prepend`** 模式才把定界块放进 **`prependContext`**。

3. **skill 模式**下每轮会往 **`appendSystemContext`** 附带**完整候选块**（与 prepend 同结构，仅展示层级不同）；**不以用户气泡里是否出现定界块为准**。若完全看不到模型侧行为，再查网关是否为本实例。

4. **工具列表**：Control UI 的 **「Available Right Now」** 依赖网关的 **`tools.effective(sessionKey=…)`**（与 **Tool Configuration / 目录**不是同一数据源）。请选对**当前会话**，或发一轮消息后刷新；若仍无，检查是否连到**另一台未装插件的网关**、或 **`tools.profile` / 按 Agent 的工具策略**是否排除了插件工具。

5. **日志**：网关日志里可搜 **`[memok-ai]`**。skill / skill+hint 时每轮应出现 **`appendSystemContext recall chars=…`**（`skill+hint` 时日志带 **`+prependHint`**）；prepend 则为 **`prependContext chars=…`**。若完全没有，说明该轮 **未走带 memok 的 Agent 路径**。

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
