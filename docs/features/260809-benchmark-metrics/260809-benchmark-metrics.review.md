# 检视报告

## 概要

检视范围：测速指标口径 canonical 化（tps 重定义、reasoning 多厂商兼容、thinking_ms 新增、统计 median 化、前端新口径展示）。整体实现与计划一致，核心路径正确，无阻塞问题；存在若干聚合口径/标签一致性、流式 token 计数精度、边界展示的建议修改项。

## 需求对齐

- tps 重定义为「回答阶段生成速度」：公式、content_ttft_ms 起算、不可算置 None，均符合计划。
- reasoning 读取链（completion_tokens_details → output_tokens_details → 顶层 reasoning_tokens）+ 流式 delta `reasoning_content`/`reasoning`，符合计划。
- thinking_ms = content_ttft − ttft，符合计划。
- 统计 median 化：batch summary 按 (base_url, model) 分组取 median、/api/stats avg_tps 与 tests_by_model 改 median，符合计划。
- 前端主展示切新口径、tps null → N/A、TestParamsFields 横评提示，符合计划。
- 验证声明（pytest 37 passed、tsc -b、vite build）与改动规模匹配；test_speed_test.py 对 _extract_reasoning_tokens / _median / compute_summary 的覆盖与实现逻辑一致。

## 阻塞问题

无。

## 建议修改

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1 | backend/speed_test.py:164-168（stream 无 usage 时 `content_tokens = content_chunk_count`） | 新口径的分子 content_tokens 在端点未返回 usage 时退化为「chunk 数」而非 token 数。本工具面向任意 OpenAI-compatible 端点，多数端点流式需 `stream_options: {"include_usage": true}` 才返回 usage；对按 chunk 批吐多 token 的网关，生成速度会被系统性低估。这是旧逻辑沿用，但作为本期「canonical 化」的主指标影响被放大。 | 流式 payload 追加 `stream_options: {"include_usage": True}`（对不支持该字段的端点兼容处理）；同时把 chunk 兜底明确标注为近似口径（如注释或在文档注明），避免「tok/s」名实不符。 |
| S2 | backend/database.py:242-247（get_stats 内联 median）与 :144 `_median` | 已新增 `_median` helper，但 get_stats 的 `median_tps` 仍手写一份相同逻辑，属于重复代码，后续口径调整易漏改一处。 | get_stats 改为 `median_tps = _median(tps_vals)`，仅对空列表置 None/0。 |
| S3 | backend/database.py:250-265（tests_by_model 按 model 分组、`count` 语义变化） | ① tests_by_model 仅按 `model` 分组，与 main.py `compute_summary` 按 `(base_url, model)` 分组不一致，同模型多 provider 会在 stats 端被合并、batch 端分离；② `count` 由「成功样本数」变为「有 tps 的成功样本数」，语义漂移（全 non-stream 的模型 count 变 0 甚至消失）。前端暂未消费该字段，但 API 语义应明确。 | 统一按 (base_url, model) 分组（或至少文档注明口径），并将 count 改为成功样本数、另加 `tps_sample_count` 字段区分。 |
| S4 | backend/main.py:189-192（`reps` 为空时 avg_tps=0、best_model=""/best_tps=0）；frontend SpeedTestResults.tsx:71-91 | 当 batch 全为 non-stream（或无 tps 样本）时，汇总卡显示「中位生成速度 0 tok/s」与空最佳模型，会把「不可算」误显示为「0」。 | 汇总结果区分「无速度样本」状态：avg_tps/best_tps 返回 null，前端显示 N/A；或至少用文案提示无可用样本。 |
| S5 | backend/main.py:183-187 + frontend SpeedTestResults.tsx:57（best_model 仅模型名） | best_model 只带 model 名；当同模型名来自多个 provider 时，前端 `successResults.find(r => r.model === summary.best_model)` 取到的是首个同名记录，可能展示错误 provider 标签（best_tps 数值正确）。 | 让 BatchSummary 增加 `best_base_url`（或直接让 best_model 携带 provider 标识），前端用 (base_url, model) 精确匹配。 |
| S6 | frontend SpeedTestResults.tsx:73,81 | 汇总卡标签「中位生成速度」/「平均延迟」与实际值不一致：avg_tps 实为各组中位的平均（mean of medians），avg_latency_ms 亦为各组中位延迟的平均；与 StatsPanel 聚合卡「中位生成速度/中位延迟」（pooled median）口径不同、标签也不统一。 | 标签与值口径对齐：例如改「生成速度(各组中位均值)」，或在多模型时标注口径；并评估与统计页 pooled median 的口径差异是否需要统一说明。 |
| S7 | backend/speed_test.py:20-21（_extract_reasoning_tokens docstring） | docstring 声称「Gemini: thoughts_token_count（见调用方按需加总）」，但函数未读取该字段、调用方也未加总，注释与实际不符，易误导后续维护。 | 修正注释：说明 Gemini 的 reasoning 不计入 completion_tokens，content_tokens 天然正确，无需加总；或将 Gemini 字段纳入读取（注意跨厂商加总语义）。 |
| S8 | frontend SpeedTestResults.tsx:96-131（batch 各模型详情行） | 计划要求「reasoning 模型补 thinking_ms 展示」，单次视图已实现，但批量视图的每模型详情行只显示 tps/延迟/TTFT/reasoning+content tokens，未显示思考耗时与内容 TTFT。 | 在批量详情行对 reasoning 模型补充 `thinking_ms`（思考耗时）展示，保持两处口径一致。 |

## 非阻塞问题

| ID  | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | frontend StatsPanel.tsx:496,533,589-603 | 时序图小多图与单图的参考线/「avg」标签仍用 mean，而本需求将 median 定为 canonical 统计口径，展示层存在 mean 残留（虽已标注 avg，不误导）。 | 后续可将参考线改为 median 或保持均值并明确标注，保持全局口径统一。 |
| N2 | backend/database.py:231-236 | get_stats 的 `avg_latency_ms`、`avg_ttft_ms` 仍为 mean；调研建议延迟类用 median，但计划仅把速度/模型分组改为 median，属按计划范围执行。 | 记录备忘：如后续把延迟也 median 化，需同步调整。 |
| N3 | backend/database.py:144 与 backend/main.py:150 | `_median` 在两处重复实现，逻辑相同。 | 可提取到公共模块（如 backend/stats_util.py）供两处引用。 |
| N4 | backend/speed_test.py:311（_batch_error_result）与 backend/main.py:124（_to_error_result） | 两个失败兜底 dict 构造器字段高度重复，本期已同步加 thinking_ms/tps=None，但后续新增字段存在漏改漂移风险。 | 合并为单一构造器或从 SpeedTestResult 派生。 |
| N5 | backend/speed_test.py:222 | 异常兜底用 `'start' in dir()` 判断变量是否已定义，脆弱且非常规。 | 将 `start` 初始化置于 try 外（或提前赋 None），改为显式判空。 |
| N6 | frontend StatsPanel.tsx:227,414 | 聚合卡「中位生成速度」在全选记录 tps 均为 null（如全 non-stream）时显示 0，属不可算误展示。 | 无有效 tps 样本时显示 N/A。 |

## 准入结论

**结论**：`条件准入`

**说明**：核心口径（tps 公式、reasoning 读取链、thinking_ms、median 聚合）实现正确且与计划一致，无阻塞问题。建议在合并前或后续迭代处理 S1（流式 token 计数精度）、S4（无速度样本显示 0）、S5（best_model 多 provider 歧义）等建议修改项。
