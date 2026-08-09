# 测速指标口径 Canonical 化 — 开发总结

> 日期: 2026-08-09
> 类型: 需求开发
> 计划: [260809-benchmark-metrics.plan.md](./260809-benchmark-metrics.plan.md)
> 检视: [260809-benchmark-metrics.review.md](./260809-benchmark-metrics.review.md)
> 验证: [260809-benchmark-metrics.validation.md](./260809-benchmark-metrics.validation.md)

## 背景

主指标 `tps = tokens_generated / total_latency_ms` 有两项偏差：含 TTFT（输出越长 TPS 越高，数学必然）与含 reasoning tokens（各厂商暴露策略不一致，且把"想得多"的模型速度拉低）。业界共识是 per-request 生成速度排除 TTFT、reasoning 单独展示、统计用 median。

## 变更

- **tps 重定义**为回答阶段生成速度 `content_tokens / ((total_latency_ms − content_ttft_ms)/1000)`，从首个回答 token 起算，reasoning 时长与 reasoning tokens 一并排除。non-stream 或无 content 时 `tps = None`（前端 N/A）。旧数据忽略口径不一致、不回算。
- **reasoning 读取多厂商兼容**：`completion_tokens_details.reasoning_tokens` → `output_tokens_details.reasoning_tokens` → `output_tokens_details.thinking_tokens` → 顶层 `reasoning_tokens`；流式 delta 兼容 `reasoning_content` 与 `reasoning`。
- **新增 `thinking_ms`** = `content_ttft_ms − ttft_ms`（思考耗时）。
- **统计 median 化**：batch summary 按 (base_url, model) 分组成功样本取 P50 代表值聚合与排名；`/api/stats` avg_tps 与 tests_by_model 改 median。无设置开关。
- **前端**：标签 TPS → 生成速度(tok/s)；统计卡/柱状图改 median；tps null 显示 N/A；SpeedTestResults 新增「思考耗时」卡；TestParamsFields 加横评提示。

## 验证

- 后端单测：新增 `backend/test_speed_test.py`（13 用例：reasoning 读取兼容、median、summary 聚合），全量 37 passed。
- 前端 `tsc -b` 无错、`vite build` 成功。
- 实机验证：见 validation.md（待用户确认）。

## 关键决策备注

- 用 `content_ttft_ms` 而非 `ttft_ms` 起算：对 reasoning 模型，思考阶段不计入生成速度，比 AA 的"最后 80% 块"近似更精确。非 reasoning 模型两者近似相等，退化为标准 decode speed。
- ITL（逐 token 间隔分布）本期未采集：需逐 chunk 记时且与 output_speed 同信息，列为后续可选增强。
