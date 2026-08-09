# 测速预设值审查

> 日期: 2026-08-09
> 类型: 领域记录（预设值合理性审查，非需求开发）
> 背景: 审查 Token Speed 测速表单默认参数是否合理、是否存在会误导/报错的坑。当前预设值见 `frontend/src/components/TestParamsFields.tsx`（maxTokens=256, temperature=0.7, stream=true, disableReasoning=false, concurrency=1, iterations=1, maxRpm=-1）。

## 结论速览

预设值整体合理，但有两处真实风险需处理：

1. **`disableReasoning=false`（默认不关思考）**：DeepSeek V4、Qwen3 部分系列默认开启 thinking，测速结果会被 reasoning 污染（慢、tokens 多、max_tokens 被吃掉）。
2. **`thinking: {"type":"disabled"}` 在部分端点直接 400**：OpenAI 官方 / 旧版 vLLM 严格校验未知字段，`thinking` 非合法参数 → `400 Unknown parameter: thinking`。当前实现把 HTTP 状态码透传为 `error_message`，但**不含响应体里的具体 message**，用户看不到"为什么失败"。
3. **`max_tokens=256` + 默认开启 reasoning 的模型**：reasoning 计入 completion token 预算，256 可能全被思考吃掉 → `content` 为空，测速指标无意义（配合指标口径重定义后 `tps=None`，但用户会困惑）。

## 逐项审查

| 参数 | 当前值 | 判定 | 说明 |
|---|---|---|---|
| `stream` | true | ✅ 正确 | 业界测速全部用 streaming（TTFT/ITL 必须流式）。non-stream 无法产出 TTFT → 新口径下 `tps` 为 None。保持默认 true。 |
| `temperature` | 0.7 | ✅ 合理 | 业界常见默认。注意：DeepSeek 文档明确 thinking 模式**不支持** temperature/top_p 等（不报错但忽略），故 reasoning 模型上该参数实际无效、无害。 |
| `max_tokens` | 256 | ⚠️ 偏低 | 普通模型足够；reasoning 模型可能全被思考吃掉 → content 为空。业界固定输出长度惯例见 `260809-benchmark-metrics.research.md` B.2。 |
| `disableReasoning` | false | ⚠️ 双刃 | 见上。保持 false 避免默认 400 合理，但需错误透传 + reasoning 模型提示。 |
| `concurrency` | 1 | ✅ 合理 | 先单测再加压。 |
| `iterations` | 1 | ⚠️ 噪声大 | 单次测量计时噪声大；业界 latency 类建议 ≥10 次取 median（research E.3）。作为"快速试一下"默认可接受，但横评应提示 ≥3 次。 |
| `maxRpm` | -1 | ✅ 合理 | 不限速为默认，防护由用户开启。 |

## 各端点关闭 reasoning 的参数（无统一标准）

| 端点 | 关闭参数 | 备注 |
|---|---|---|
| Anthropic | `thinking: {"type":"disabled"}` | **与当前实现一致**（Anthropic 原生格式） |
| DeepSeek | `thinking: {"type":"disabled"}` | **与当前实现一致**；thinking 默认开启 |
| Qwen/千问 | `enable_thinking: false`（extra_body） | 当前实现**不覆盖** |
| OpenAI | `reasoning_effort: "none"` | 当前实现**不覆盖** |
| vLLM（新版） | 忽略未知字段（extra=allow） | `thinking` 被静默丢弃，无害 |
| vLLM（旧版）/ OpenAI 官方 / Mistral 兼容层 | **400 未知字段** | 当前实现的 `thinking` 会导致请求失败 |

来源: DeepSeek thinking_mode 文档 / Qwen Cloud thinking 文档 / vLLM PR #10463（extra=allow）/ vLLM issue #12864（旧版 extra_forbidden）/ OpenAI 官方 `Unknown parameter` 行为（spring-ai issue #5196 实证）。

## 建议

### 必改（影响可用性）
1. **错误透传响应体 message**：`speed_test.py` 流式/非流式 `raise_for_status()` 前，先读 `resp.text`/JSON 的 `error.message`，与状态码一起存入 `error_message`。用户勾选关闭思考时若端点 400，能看到"Unknown parameter: thinking"从而知道原因。
2. **`TestParamsFields` 文案**："关闭思考（尽量）" → "关闭思考（不支持该参数的端点可能报错）"，如实说明。

### 建议（改进横评正确性）
3. **`max_tokens` 默认 256 → 512**：reasoning 模型不至于全被思考吃掉；普通模型测速更稳。UI 可提示"测 reasoning 模型建议 ≥1024"。
4. **横评提示文案**：并发/迭代区附近提示"横评多个模型建议固定 max_tokens、迭代 ≥3 次取中位数"（与指标口径需求 260809-benchmark-metrics 的 TestParamsFields 提示合并落地）。
5. **保持 `disableReasoning` 默认 false**：默认 true 会让 OpenAI 官方端点首测即 400。测速意图上"关思考更干净"，但兼容性优先于理想口径，留给用户按模型勾选。

### 不做
- 不加 `enable_thinking`/`reasoning_effort` 联动（参数矩阵爆炸，收益低；保持单一 `thinking:disabled` 覆盖 Anthropic/DeepSeek 两大 reasoning 来源即可）。
- 不做按模型自动判定 reasoning 开关（依赖模型能力探测，超预设值范围）。
