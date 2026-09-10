# 260910 usage 口径矛盾与统计缺陷修复 · summary

## 问题（4 项，全部修复于 fc592d5）

1. **usage 口径矛盾（核心）**：CLIProxyAPI 转发 Gemini 系模型时 `completion_tokens` 仅含正文、
   `reasoning_tokens` 独立上报；旧逻辑按 OpenAI 口径（reasoning 计入 completion）计算
   `content = completion - reasoning` → 负数截断为 0 → TPS 显示 N/A、`reasoning > generated` 矛盾、
   token 拆分（如 `745+0` 与 `62 tokens`）不自洽。
   修复：`_reconcile_token_counts` 以 `reasoning > completion` 判据区分两种口径，流式/非流式统一接入。
2. **thinking_ms 伪值**：网关只转正文（thinking 混入 TTFT）时，`content_ttft - ttft` 产出 0.01ms 假时长。
   修复：仅当流中真实出现 reasoning 增量才计算，否则 None。
3. **统计成功率恒 100%**：解析口径下失败样本（`actual_model='error'`）被整行剔除，成功率指标失真。
   修复：失败样本回退按输入 modelid 归组（数值指标路径先过滤 success，不受影响）。
4. **paths.py SyntaxWarning**：docstring 含 `\T` 无效转义。修复：raw string。

历史数据：10 行旧样本已按新口径修复（content/generated/tps 重算，thinking 伪值清 NULL）。

## 验证

- 单测 45 passed（含 `_reconcile_token_counts` 双口径 + 边界 4 用例）
- 真实网关 gemini-3-flash 流式复测：`generated=1107 reasoning=1052 content=55 tps=419.11 thinking=None`，自洽
- UI 统计页成功率从 100% → 85%（22/26），失败模型（lite/xhigh）出现在筛选器与对比图
