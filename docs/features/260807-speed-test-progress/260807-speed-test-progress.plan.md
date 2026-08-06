# 测速进度指示 — 实施计划

## 概述

当前测速流程：前端一次 `POST /api/speed-test/batch`，后端 `asyncio.gather` 全部测试跑完后才整体返回。等待期间前端只有「测试中...」spinner，没有任何进度反馈。当选择多个模型 × 多次迭代并发测试时，用户完全不知道进行到哪一步、哪些已完成。

目标：测速过程中实时显示进度（进度条 + 每个测试完成的实时结果），并支持中途取消。

## 用户使用路径

1. 在「测速」Tab 选择多个模型，设置并发/迭代后点「开始测速」
2. 测速表单下方出现进度面板：进度条 + `X/N` 计数 + 取消按钮
3. 每个测试完成立即在进度面板插入结果行（模型名 + 成功/失败 + TPS + 延迟）
4. 全部完成后自动切到「结果」Tab 展示汇总，进度面板消失
5. 中途点「取消」：剩余测试停止，已完成的测试结果保留在进度面板并已写入历史，面板显示「测速已取消」

## 架构设计

### 推送方案：SSE 流式推送

新增 `POST /api/speed-test/batch-stream`，返回 `text/event-stream`。保留原 batch 端点（向后兼容）。

事件流：
```
event: progress
data: {"index": 3, "total": 6, "result": {...SpeedTestResult}}

event: summary
data: {"results": [...], "summary": {...BatchSummary}}
```

- 每个测试完成即推送 `progress`（`asyncio.as_completed` + `Semaphore(concurrency)` 保持并发，完成一个推一个）
- 每个完成的测试**立即** `insert_speed_test` 入库（取消后已完成部分仍保留在 history）
- 全部完成后推送 `summary`（全量 results + BatchSummary）
- **取消语义**：StreamingResponse 的 generator 在客户端断开时触发 `finally` → 取消未完成的 asyncio task（httpx 支持协程取消）

### 后端（backend/main.py）

从 batch 端点抽取共享辅助：
- `_expand_tests(req)` — tests × iterations 展开
- `_to_error_result(item, req, error, now_iso)` — 异常→error result
- `compute_summary(parsed)` — summary 计算
- `_iter_batch_results(req)` — 并发执行生成器，yield 每个完成结果；`finally` 中取消未完成任务

batch 端点与新 SSE 端点共用 `_iter_batch_results`。

### 前端

- **lib/api.ts**：新增 `streamBatchSpeedTest(params, handlers, signal)`，fetch 带 `Accept: text/event-stream` + AbortSignal，用 `ReadableStream` + `TextDecoder` 按 `\n\n` 切分 SSE 块解析
- **components/SpeedTestProgress.tsx**（新）：进度条（div + width%，项目无 progress 组件）+ X/N 计数 + 实时结果行列表 + 取消按钮
- **App.tsx**：新增 progress state、abortRef（AbortController）、cancelled 标记；`handleRunTest` 改调 `streamBatchSpeedTest`；取消后保留进度面板显示部分结果

## 实现顺序

1. backend/main.py — 抽取共享辅助 + SSE 端点
2. frontend/lib/api.ts — streamBatchSpeedTest + SSE 解析
3. frontend/components/SpeedTestProgress.tsx — 进度面板
4. frontend/App.tsx — 流式调用集成 + 取消逻辑

## 验证清单

- [ ] `curl -N` 冒烟 SSE：4 个 progress 事件逐条到达 + 最终 summary
- [ ] 客户端中途断开：服务端正常清理，无残留任务/异常
- [ ] 前端：多模型并发测速时进度条推进、实时结果逐行出现
- [ ] 完成后自动切到「结果」Tab
- [ ] 取消：剩余测试停止，已完成结果保留展示且已写入 history
- [ ] 回归：原 `/api/speed-test/batch` 行为不变

## 备注

- 实现期间项目正在进行 tpm 指标下线（token-speed 更名），本功能代码已与移除 tpm 后的 schema 保持一致
- 不引入新依赖（SSE 用 FastAPI 原生 StreamingResponse）
