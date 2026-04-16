---
name: memok-memory
description: 使用网关每轮自动附带的 memok 候选记忆句，并在采用后上报 id（与 memok_report_used_memory_ids 配合）。
---

# Memok 候选记忆（memok-ai）

## 候选从哪来

网关插件在**每轮模型回复前**（`before_prompt_build`）会从 SQLite 抽样候选句，通过 **`appendSystemContext`** 写入**系统侧**上下文（**不会**像旧版那样把整块候选 `prepend` 进用户气泡）。

若配置为 **`memoryRecallMode: skill+hint`**，对话区可能还有**一行极短**的 `prependContext` 提示（不含大块定界正文）；**完整列表仍在系统上下文定界块内**。

你应在作答前阅读本轮系统上下文中 **`@@@MEMOK_RECALL_START@@@` … `@@@MEMOK_RECALL_END@@@`** 内的列表与 `[id=…]`。

## 何时采用

候选为**随机抽样**，**未必**与当前用户问题相关，请自行判断是否采用；采用时在回复中自然使用，**不要**向用户复述整段定界块或系统说明。

## 若同一轮需要再抽一次（可选）

可调用工具 **`memok_recall_candidate_memories`**（无参数），得到一批新候选并刷新本轮可校验的 id 列表。

## 反馈

若**确实使用**了某条候选句（来自系统附带块或上述工具返回），在本轮内调用 **`memok_report_used_memory_ids`**，传入 `{ "sentenceIds": [ ... ] }`（正整数 id）。未采用则**不要**调用。

## 说明

数据库路径与抽样比例由网关侧 memok-ai 插件配置决定。
