# memok-ai

[English](./README.md) | 简体中文 · 官网：[memok-ai.com](https://www.memok-ai.com/)

**Gitee 镜像（本核心仓 / 中文 README）：** [gitee.com/wik20/memok-ai](https://gitee.com/wik20/memok-ai)。克隆本核心仓可用 Gitee。**OpenClaw 插件** 的安装与说明见独立仓库 [memok-ai-openclaw](https://github.com/galaxy8691/memok-ai-openclaw)。在 Gitee 网页端可将本仓库 **「展示 README」** 设为 `README.zh-CN.md`，便于只阅读中文版。

**双远端推送（示例）：** `git remote add gitee https://gitee.com/wik20/memok-ai.git`（若尚未添加），之后与 GitHub 相同分支一并推送即可，例如 `git push origin main` 与 `git push gitee main`（将 `origin` / `gitee` 换成你的 remote 名）。Gitee 与 GitHub 可保持同一分支内容；仅首页展示语言通过上述 README 设置区分。

`memok-ai` 是一个基于 Node.js + TypeScript 的记忆流水线项目，用 OpenAI 兼容接口提取长文/对话记忆并写入 SQLite，支持召回、强化和 dreaming 流程。

## 功能概览

- 一步式文章流水线（`article-word-pipeline`），输出稳定 JSON 二元组
- SQLite 导入工具（`words` / `normal_words` / `sentences` 及关联表）
- dreaming 编排（`dreaming-pipeline` = `predream` + story-word-sentence 多轮）
- 稳定入口 **`memok-ai-core/openclaw-bridge`**（由本包导出，插件侧常以 npm 别名 `memok-ai-core` 依赖本仓库）

网关安装、对话侧召回/上报、定时 dreaming、`openclaw memok setup` 均在 **[memok-ai-openclaw](https://github.com/galaxy8691/memok-ai-openclaw)** 维护，不在本核心仓。

### 与「纯向量库」路线的差异

| | memok-ai | 常见托管向量库 |
| --- | --- | --- |
| 部署 | 本机 SQLite | 云端 API + 计费 |
| 召回依据 | 词 / 规范词图、权重、抽样 | 向量相似度 |
| 可解释性 | 结构化表可排查 | 多为相似度分数 |
| 隐私 | 默认数据不出机 | 通常需上传宿主外 |

这是取舍，不是断言检索效果一定优于或劣于向量方案。

一句话：memok 追求可联想、可强化、可维护（含遗忘）的闭环，不依赖单独部署 embedding 服务或第三方向量索引，更接近「结构化笔记图」，而非通用语义检索黑盒。

## 环境要求

- Node.js **≥20**（建议 LTS）
- npm

安装依赖：

```bash
npm install
```

### 关于首次安装耗时（请先看）

首次 `npm install` 的耗时主要来自 **`better-sqlite3` 等原生模块**（预编译下载或本地编译）以及其余 JS 依赖，常见 **数分钟级**（视网络与磁盘而定）；若日志长时间停在某个包的 **`install`/`postinstall`**，多为正常编译或下载，不是死机。

建议：

- **不要用** `--loglevel verbose` 日常安装，否则几千行 `npm http cache` 会像「卡死」。
- 项目根目录 **`.npmrc`** 已配置 **npmmirror** 并关闭镜像站不支持的 `audit` 请求。
- **同一台机器、同一 npm 缓存**下第二次安装或后续 `npm ci` 会快很多。

## 安装方法

### 1）作为 CLI 本地使用

```bash
cp .env.example .env
npm run build
npm run dev -- --help
```

### 2）作为 OpenClaw 插件使用

请使用 **[memok-ai-openclaw](https://github.com/galaxy8691/memok-ai-openclaw)**：安装脚本、境内镜像、环境变量与排障均以该仓库文档为准（本核心仓不再附带安装脚本）。

## 命令行参考

`npm run dev -- --help` 与各子命令的 `--help` 为**英文**说明（与代码中 Commander 文案一致）。下表为中文用途速查（示例仍用 `npm run dev --`；安装 CLI 后可改用 `memok-ai`）。

| 子命令 | 说明 |
| --- | --- |
| `article-core-words <文章路径>` | 从文章文本抽取 core words |
| `article-core-words-normalize` | 读取 core_words JSON，做同义词归一 |
| `article-sentences <文章路径>` | 抽取面向记忆的句子 |
| `article-sentence-core-combine` | 合并 sentences 与 normalize 输出为二元组 |
| `article-word-pipeline <文章路径>` | 一步跑完整 article-word 流水线 |
| `extract-memory-sentences --db …` | 从 SQLite 按词抽样关联记忆句 |
| `dreaming-pipeline --db …` | predream 衰减 + story-word-sentence 全流程 |
| `predream-decay --db …` | 仅 predream（duration 与短期句处理） |
| `story-word-sentence-buckets --db …` | 单轮完整分桶+回写+清理 |
| `story-word-sentence-pipeline --db …` | 同一库上多轮 buckets（随机轮数） |
| `harden-db --db …` | 清理无效/重复 link 并建索引 |
| `import-awp-v2-tuple --from-json … --db …` | 将 AWP v2 元组 JSON 导入库 |

## 快速示例（CLI）

执行文章流水线：

```bash
npm run dev -- article-word-pipeline ./articles/article1.txt > out/awp_v2_tuple.json
```

导入 SQLite：

```bash
npm run dev -- import-awp-v2-tuple --from-json out/awp_v2_tuple.json --db ./memok.sqlite
```

抽样记忆句：

```bash
npm run dev -- extract-memory-sentences --db ./memok.sqlite
```

## Dreaming

一键运行并输出合并报告：

```bash
npm run dev -- dreaming-pipeline --db ./memok.sqlite
```

`dreaming-pipeline` 子命令将合并后的 JSON 报告输出到标准输出；本核心仓不包含、也不会写入 `dream_logs` 表。若使用 OpenClaw 插件，是否在 SQLite 中持久化定时运行（含 `dream_logs` 等表结构）以插件仓文档为准。

## 配置优先级说明（重要）

对 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`MEMOK_LLM_MODEL`：

1. 进程已有环境变量优先
2. **仅在使用 OpenClaw 插件时：** `openclaw memok setup` 写入的配置只补齐缺失值（详见 [memok-ai-openclaw](https://github.com/galaxy8691/memok-ai-openclaw)）
3. `.env` 主要用于本地开发与 CLI 调试

## 贡献指南

欢迎提交贡献。详细规范请见：[CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。
