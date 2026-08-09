# 测速指标口径 Canonical 化 — 实施计划

> 日期: 2026-08-09
> 类型: 需求开发
> 调研: [260809-benchmark-metrics.research.md](./260809-benchmark-metrics.research.md)

## 背景

当前主指标 `tps = tokens_generated / total_latency_ms` 含两项偏差：

1. **含 TTFT**：e2e ≈ TTFT + 输出长度×ITL，输出越长 TPS 越高（数学必然）。横评长短不一的模型时，长输出模型系统性占优。
2. **含 reasoning**：reasoning 暴露策略各厂商不一致（OpenAI/DeepSeek 计入 completion_tokens，Gemini 单独字段，Anthropic 走 thinking_tokens，流式 chunk 字段各异），且 reasoning 计入分子会把"想得多"的模型速度拉低。

业界（vLLM / NVIDIA GenAI-Perf / MLPerf / Artificial Analysis / OpenRouter）共识：
- per-request 生成速度**一律排除 TTFT**；TTFT 作为独立延迟指标单独展示，不合成单一分。
- reasoning 从生成速度分子**剔除、单独展示**；reasoning 计时不计入生成阶段。
- 统计口径：延迟/速度类用 **median(P50)**（长尾下 mean 被慢样本拉偏），失败样本排除。

## 需求

1. `tps` 重定义为**回答阶段生成速度**：`content_tokens / ((e2e − content_ttft)/1000)`，排除 TTFT、reasoning tokens 与 reasoning 时长。
2. TTFT 单独展示：`ttft_ms`（首 token，含 reasoning）与 `content_ttft_ms`（首个回答 token）并存。
3. reasoning 字段读取多厂商兼容；无法拆分时降级并标注。
4. 新增 `thinking_ms`（reasoning 耗时 = `content_ttft_ms − ttft_ms`）。
5. 统计聚合/排名从 mean 改 median（P50），做死不做设置。
6. 前端主展示切到新口径；`tps` 不可算时显示 N/A。

## 架构决策

- **新 tps 公式从 `content_ttft_ms` 起算，而非 `ttft_ms`**：分母 `e2e − content_ttft` 从首个回答 token 起、分子用 content_tokens，reasoning 时长与 reasoning tokens 全部排除。对 reasoning 模型公平（AA 用"最后 80% 块"近似；我们直接用首个回答 token 起算，更精确且无需近似）。非 reasoning 模型 `content_ttft ≈ ttft`，公式退化为标准 decode speed。
- **`tps` 可空**：non-stream 无 TTFT 信息、或流式中模型从未输出 content（仅 usage）时 `tps = None`，前端显示 N/A。**旧数据忽略口径不一致，不回算、不迁移。**
- **reasoning 读取链**（usage 层）：`completion_tokens_details.reasoning_tokens`（OpenAI/DeepSeek）→ `output_tokens_details.reasoning_tokens`（Responses）→ `output_tokens_details.thinking_tokens`（Anthropic 兼容层）→ 顶层 `reasoning_tokens`（xAI）。流式 chunk 层兼容 `delta.reasoning`（现有 `delta.reasoning_content`）。
- **统计 median 化**：单次 batch run 内同 (provider, model) 对的 tps/ttft/latency 用 P50 聚合与排名；失败样本排除后计算。不加配置开关。
- **ITL 本期不采集**：业界四大指标之一、衡量流式逐 token 间隔分布，需逐 chunk 记时且与 output_speed 同信息（平均 1/ITL ≈ output_speed）。列为可选后续增强，不阻塞本期。

## 改动清单

### 后端

- `speed_test.py`：
  - `tps = content_tokens / ((total_latency_ms − content_ttft_ms)/1000)`，仅 stream 且 `content_ttft_ms` 非空时计算，否则 `None`。
  - reasoning 读取链扩展（usage 多字段 + 流式 `delta.reasoning`）。
  - 新增 `thinking_ms = content_ttft_ms − ttft_ms`（两者均非空时）。
  - `_batch_error_result` 的 `tps` 改 `None` 一致。
- `models.py`：`tps: Optional[float]`；`SpeedTestResult` / `SpeedTestHistory` 增 `thinking_ms: Optional[float]`。
- `database.py`：迁移增 `thinking_ms` 列；`insert_speed_test` 写入。
- `main.py`：`compute_summary` 改为按 (base_url, model) 分组成功样本 → 每组取 median → `avg_tps` 取各组代表值的平均、`best_model` 取代表值最高的组；`_to_error_result` 字段一致。
- `database.py get_stats`：`avg_tps` 改 median（Python 端取数算，SQL 不提供 median）。

### 前端

- `types.ts`：`tps: number | null`；`thinking_ms?: number | null`。
- `StatsPanel.tsx`：聚合卡与模型对比柱状图改 median；metric 标签 `TPS` → `生成速度(tok/s)`；`tps` 为 null 的记录从速度聚合/绘图排除。
- `HistoryList.tsx`：`tps` null → `N/A`。
- `SpeedTestResults.tsx` / `SpeedTestProgress.tsx`：新口径展示；reasoning 模型补 `thinking_ms` 展示。
- `TestParamsFields.tsx`：横评提示文案（固定 max_tokens 保持一致；多迭代建议 ≥3 次取中位）。

## 验证

- `pytest backend/test_scheduler.py`。
- `tsc -b` + `vite build`。
- 手工 smoke：reasoning 模型（如 DeepSeek-R1）与非 reasoning 模型各测，核对 `tps = content_tokens/(e2e−content_ttft)`、`thinking_ms > 0`；non-stream `tps = N/A`；统计卡显示中位数而非均值。
