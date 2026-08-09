# LLM 测速 Benchmark 指标与统计口径调研报告

- 日期：2026-08-09
- 主题：业界评测/横评多个模型速度指标的标准方法和统计口径
- 背景：自建 LLM API 测速工具（任意 OpenAI-compatible 端点），当前将 TTFT 计入 TPS、将 reasoning tokens 计入 TPS，需对照业界标准修正。

---

## 0. 结论速览（TL;DR）

1. **TTFT 不应计入 per-request 的生成速度（TPS/ITL/TPOT）**。业界共识：Output Speed / decode throughput / TPOT 全部**排除 TTFT**，TTFT 作为独立延迟指标单独展示。vLLM、NVIDIA GenAI-Perf、MLPerf、Artificial Analysis、OpenRouter 均如此。
2. **"全文 tokens/总耗时"这种 e2e TPS 有一个专有名字叫 E2E Speed / TPS per user，属于"端到端吞吐"，它天然"输出越长 TPS 越高"**，这是该指标的固有特性而非 bug。公平横评时要么(a)用排除 TTFT 的 decode 速度指标，要么(b)固定输出长度后再比较 e2e 指标，要么(c)用合成指标（如 AA 的 "Total Response Time for 100 Output Tokens"）把 TTFT 和输出速度统一到同一输出长度上。
3. **公平横评的核心是"控制变量 + 分开展示 + 统一 token 计数"**：
   - 分开展示 TTFT 和 Output Speed（不要合成一个数字）；OpenRouter、AA、vLLM 全部拆开。
   - 固定输入长度、固定 max_tokens（或固定期望输出长度）、同一 prompt、同一并发度、streaming。
   - 不同模型 tokenizer 不同 → 用统一 tokenizer（tiktoken o200k_base）计数，或用服务端 usage 数。AA 明确用 tiktoken 统一计数以保证可比。
4. **reasoning tokens 处理没有统一标准**，厂商暴露策略差异巨大：
   - OpenAI：`usage.output_tokens_details.reasoning_tokens`（Responses）/ `usage.completion_tokens_details.reasoning_tokens`（Chat Completions），计入 output/completion_tokens，内容不暴露（只有 summary）。
   - Anthropic：`usage.output_tokens_details.thinking_tokens`，thinking blocks 在 content 里（可流式），计入 output_tokens。
   - DeepSeek：`usage.completion_tokens_details.reasoning_tokens`，同时有 `reasoning_content` 字段（OpenAI 兼容格式里）。
   - Gemini：`usage_metadata.thoughts_token_count`，**单独字段、不计入 candidates_token_count**（与其他家不同！）。
   - xAI Grok：顶层 `reasoning_tokens`（gRPC 才有，REST 不暴露）。
   - **benchmark 时必须显式声明"是否把 reasoning 计入速度"**。AA 的做法：对不暴露全部 reasoning 的模型用"最后 80% 输出块"算 output speed；TTFT 定义为首个 token（含 reasoning）；另设 Time-to-First-Answer-Token 和 Thinking Time 单独呈现。
5. **统计口径**：推荐 median(P50) 为主指标，配合 p90/p95/p99；对并发/容量用 mean。重复次数建议 ≥10（便宜时 30–100+）；P99 需要 ~1000 样本才有 10% 相对误差的置信度。异常值处理：warmup + 明确离群定义，不要在计算中偷偷丢弃，要报告。
6. 本项目推荐改动（详见 §G）：per-request TPS = (completion_tokens − reasoning_tokens) / (e2e − TTFT)（排除 TTFT 与 reasoning），额外展示 TTFT、reasoning tokens、输出长度分布，并按"输出长度桶"分组展示。

---

## A. 业界测速工具/benchmark 的指标定义

### A.1 常用指标清单与准确定义

业界（vLLM、NVIDIA GenAI-Perf、MLPerf、Artificial Analysis、llm-speed、kubernetes-sigs/inference-perf 等）的指标高度收敛，但**公式细节各家略有差异**，必须先声明口径再比较。

| 指标 | 定义 | 主流公式/口径 | 来源 |
|---|---|---|---|
| **TTFT**（Time To First Token） | 从发送请求到收到第一个输出 token 的时间。包含网络、排队、prefill、首 token 序列化。 | `t_first_token − t_request_sent`。需 streaming 才能测。 | [QAInsights](https://qainsights.com/how-to-measure-time-to-first-token-ttft-in-ai-systems/)、[NVIDIA NIM metrics](https://docs.nvidia.com/nim/benchmarking/llm/latest/metrics.html)、[OpenAI Help Center](https://help.openai.com/en/articles/1000499-troubleshooting-api-errors-and-latency) |
| **ITL**（Inter-Token Latency） | 相邻输出 token 之间的时间间隔。衡量 decode 流式平滑度。 | 每次 token 间间隔的集合；平均为 `(e2e_latency − TTFT) / (output_tokens − 1)`（AIPerf/GenAI-Perf 口径，**排除 TTFT 与首 token**）。 | [NVIDIA GenAI-Perf](https://developer.nvidia.com/blog/llm-benchmarking-fundamental-concepts/)、[NVIDIA NIM metrics](https://docs.nvidia.com/nim/benchmarking/llm/latest/metrics.html)、[vLLM benchmark_serving.py](https://github.com/vllm-project/vllm/blob/v0.8.2/benchmarks/benchmark_serving.py) |
| **TPOT**（Time Per Output Token） | 每个输出 token 的平均生成时间；= 1 / per-token 速度。 | vLLM：`(e2e − TTFT) / (output_tokens − 1)`（"Time per Output Token (excl. 1st token)"）。MLPerf 作为 server scenario 的 SLO（如 ≤200ms）。 | [vLLM benchmark_serving.py](https://github.com/vllm-project/vllm/blob/v0.8.2/benchmarks/benchmark_serving.py)、[MLPerf Llama2 70B](https://mlcommons.org/2024/03/mlperf-llama2-70b/)、[MLPerf docs](https://docs.mlcommons.org/inference/) |
| **TBT**（Tokens Between Tokens / Time Between Tokens） | 与 ITL 近似，有时特指"上一个 token 到下一个 token"的间隔（JmPotato 工具定义为 `last_token_at − first_token_at`）。MLPerf 官方将其与 TPOT 并列称呼。 | 各家略有差异：有的指 token 间隔本身，有的指首尾区间。 | [JmPotato/llm-provider-benchmark](https://github.com/JmPotato/llm-provider-benchmark)、[MLCommons Llama2 70B](https://mlcommons.org/2024/03/mlperf-llama2-70b/) |
| **Output Speed / Output TPS（per-request）** | 单个请求"开始生成后"每秒收到的输出 token 数。**排除 TTFT**。 | AA：`output_tokens / (time after first token)`；"average number of tokens received per second, after the first token is received"。 | [Artificial Analysis methodology](https://artificialanalysis.ai/methodology)、[OpenRouter blog](https://openrouter.ai/blog/insights/evaluate-llm-provider-performance/) |
| **Decode throughput（系统/聚合）** | 整个 benchmark 期间所有并发请求输出的总 token / 总时长。是系统吞吐（含 TTFT 混叠），与 per-request decode 速度不同。 | vLLM：`sum(actual_output_lens) / dur_s`；GenAI-Perf：`total_output_tokens / (T_last_response − T_first_request)`。vLLM issue 指出该指标混入 TTFT 会低估。 | [vLLM PR #8164](https://github.com/vllm-project/vllm/pull/8164)、[vLLM issue #23820](https://github.com/vllm-project/vllm/issues/23820)、[NVIDIA GenAI-Perf](https://developer.nvidia.com/blog/llm-benchmarking-fundamental-concepts/) |
| **Total token throughput** | (输入+输出) token / 总时长。 | vLLM 有 `total_token_throughput`。注意 vLLM 曾将 input/output throughput 混用 e2e 时间导致低估 prefill。 | [vLLM PR #8164](https://github.com/vllm-project/vllm/pull/8164)、[vLLM benchmark_serving.py](https://github.com/vllm-project/vllm/blob/v0.8.2/benchmarks/benchmark_serving.py) |
| **TPS per user** | 单客户端视角：`output_seq_len / e2e_latency`（**含 TTFT**）。输出越长越接近 1/ITL。 | NVIDIA NIM 明确给出该公式，并指出"TPS per user 随输出长度增长而渐近 1/ITL"。 | [NVIDIA NIM metrics](https://docs.nvidia.com/nim/benchmarking/llm/latest/metrics.html) |
| **E2E latency / E2EL** | 请求发送到完整响应收到的时间。 | vLLM：client side from sending request to receiving complete response。 | [vLLM benchmark_serving.py](https://github.com/vllm-project/vllm/blob/v0.8.2/benchmarks/benchmark_serving.py) |
| **E2E Speed（合成口径）** | 含 TTFT 的 per-request 吞吐：`output_tokens / e2e`。AA-AgentPerf 正用它替代 Output Speed + TTFT 两个指标。 | "Per-request output tokens per second across the full request, including the wait for the first token." | [AA-AgentPerf methodology](https://artificialanalysis.ai/methodology/agentperf) |
| **TTLT** | Time to last token = e2e。 | QAInsights 用 TTLT 命名。 | [QAInsights](https://qainsights.com/how-to-measure-time-to-first-token-ttft-in-ai-systems/) |
| **Prefill throughput / prefill tok/s** | 输入 prompt token / prefill 耗时。本地后端可测；API 一般用 TTFT 反推。 | llm-speed：`prompt_tokens / prefill_wall_seconds`。 | [llm-speed methodology](https://llm-speed.com/methodology) |
| **RPS / request throughput** | 每秒完成的请求数。 | vLLM：`completed / dur_s`；也有 goodput（满足 SLO 的请求数/秒）。 | [vLLM benchmark_serving.py](https://github.com/vllm-project/vllm/blob/v0.8.2/benchmarks/benchmark_serving.py) |
| **Goodput** | 满足 SLO 的请求吞吐（TTFT/TPOT/E2EL 阈值）。 | vLLM `--goodput "ttft:... tpot:... e2el:..."`。 | [vLLM benchmark_serving.py](https://github.com/vllm-project/vllm/blob/v0.8.2/benchmarks/benchmark_serving.py)、[DistServe](https://arxiv.org/abs/2401.09670) |

### A.2 关键出处（指标定义权威源）

- **vLLM `benchmark_serving.py`**（业界事实上最常用的 serving benchmark 实现）：
  - TPOT = `(e2e − TTFT) / (output_tokens − 1)`，标题明写 "Time per Output Token (excl. 1st token)"。
  - 输出 `mean/median/std/percentiles`（默认 P99，可配）的 TTFT、TPOT、ITL、E2EL。
  - 聚合吞吐：`output_throughput = sum(actual_output_lens) / dur_s`、`total_token_throughput = (total_input + total_output) / dur_s`、`request_throughput = completed / dur_s`、`request_goodput`。
  - 源码：https://github.com/vllm-project/vllm/blob/v0.8.2/benchmarks/benchmark_serving.py （当前版本在 `vllm/benchmarks/serve.py`）
- **NVIDIA GenAI-Perf / NIM**：
  - ITL = `(e2e_latency − TTFT) / (Total_output_tokens − 1)`，"does not include the first token... so that ITL is a characteristic of the decoding part of the request processing only"。
  - TPS per system = `Total_output_tokens / (T_last − T_first)`；TPS per user = `OSL / e2e_latency`。
  - https://docs.nvidia.com/nim/benchmarking/llm/latest/metrics.html 与 https://developer.nvidia.com/blog/llm-benchmarking-fundamental-concepts/
- **MLPerf Inference**（官方 SLO 定义）：
  - 明确划分 prompt 阶段（TTFT）与 generation 阶段（TPOT）；吞吐用 tokens/s。
  - 示例：Llama2 70B Server 场景 TTFT ≤ 2000ms、TPOT ≤ 200ms；Llama 3.1 405B P99 TTFT 6s、TPOT 175ms；Llama3.1-8B Interactive 场景 TTFT ≤ 0.5s、TPOT ≤ 30ms。
  - https://mlcommons.org/2024/03/mlperf-llama2-70b/ 、https://docs.mlcommons.org/inference/ 、https://mlcommons.org/2025/04/llm-inference-v5/
- **Artificial Analysis**（API 横评最常被引用）：
  - Output Speed：after first token 的平均 tokens/s。
  - TTFT、Time to First Answer Token、Total Response Time for 100 Output Tokens（合成指标，统一输出长度）。
  - https://artificialanalysis.ai/methodology 、https://artificialanalysis.ai/methodology/performance-benchmarking
- **kubernetes-sigs/inference-perf metrics 文档**（定义了 TTFT/TPOT/Normalized TPOT/ITL 的对照）：
  - https://github.com/kubernetes-sigs/inference-perf/blob/main/docs/metrics.md

---

## B. 业界如何 fair 横评多个模型

### B.1 总体原则：分开展示，控制变量，统一口径

- **TTFT 与 Output Speed 分开展示，不要合成单一分数**。OpenRouter 官方博客直接给出"4 个指标决定 provider 表现：latency(TTFT)、throughput(output tok/s)、uptime、quantization"，并强调"一个 provider 首 token 很快但全文很慢是常见的"，必须分开看。来源：https://openrouter.ai/blog/insights/evaluate-llm-provider-performance/
- **Artificial Analysis**：首页/API 同时提供 `median_output_tokens_per_second` 与 `median_time_to_first_token_seconds` 两个独立字段，另有端到端响应时间。来源：https://artificialanalysis.ai/data-api 、https://artificialanalysis.ai/api-reference/
- **vLLM**：TTFT/TPOT/ITL/E2EL 各自独立输出 mean/median/percentiles，不合成。来源：https://github.com/vllm-project/vllm/blob/v0.8.2/benchmarks/benchmark_serving.py

### B.2 是否要求相同 max_tokens / 相同输出长度

**没有强制要求"输出长度完全相同"，但业界普遍通过固定 workload 形状 + 统一 token 计数来保证可比**：

- **AA**：固定 workload 形状（1k 输入/至少 1k 输出、10k 输入/至少 1.5k 输出、10k 输入/至少 2k 输出等），用 **tiktoken o200k_base 统一 tokenizer 计数**，"so that the same text is represented as the same number of tokens"。来源：https://artificialanalysis.ai/methodology/performance-benchmarking
- **llm-speed**：固定 byte-identical prompt + 固定输出长度（如 128 输入/256 输出；4096 输入/1024 输出），suite 版本化（suite-v1），每次结果都 pin 版本。来源：https://llm-speed.com/methodology
- **MLPerf**：固定 dataset（OpenORCA），固定每 sample 的输入输出长度分布，吞吐用 tokens/s 来消除 query 长度差异。来源：https://mlcommons.org/2024/03/mlperf-llama2-70b/
- **ray-project/llmperf**：用 LlamaTokenizer 统一计数，"to ensure that the prompts are consistent across different LLM APIs"。来源：https://github.com/ray-project/LLMPerf
- **vLLM benchmark_serving**：支持用 sonnet dataset 固定 input/output length（`--sonnet-input-len/--sonnet-output-len`）。来源：https://github.com/vllm-project/vllm/blob/main/benchmarks/benchmark_serving.py

**核心洞察**：比较 per-token 速度（TPOT/ITL/Output Speed）时**不需要**输出长度一致（因为已经归一化到 per token）；比较 e2e 延迟/含 TTFT 的吞吐时**必须**输出长度一致，否则越长越慢/越快都有偏差。AA 的 "Total Response Time for 100 Output Tokens" 就是为了解决"不同模型输出长度不同"而把响应时间归一化到 100 个输出 token 的合成指标。来源：https://artificialanalysis.ai/methodology/performance-benchmarking

### B.3 并发/吞吐测试的标准做法

- **MLPerf server scenario**：查询按 Poisson 分布到达（模拟在线负载），满足 TTFT/TPOT SLO 前提下的最大可持续吞吐；offline scenario 则一次性灌入全部查询测吞吐。来源：https://docs.mlcommons.org/inference/ 、[FlexBench 文档](https://github.com/flexaihq/flexbench)
- **Artificial Analysis System Load Test (AA-SLT)**：
  - 固定并发数、请求完成后立即补发（稳定负载）。
  - 并发阶梯：1, 2, 4, 8, 16, 32, 64, 之后每档 +64 直到吞吐平台期。
  - 每档 3 分钟（不含 ramp-up/cool-down）；workload 1000 输入/1000 输出 token；streaming 开启。
  - 指标：System Output Throughput（聚合 tok/s）、Response rate、E2E latency（median）、Output Speed（median）。
  - 来源：https://artificialanalysis.ai/methodology/system-load-test
- **vLLM**：`--request-rate` 控制请求到达速率（恒定或泊松）；`--num-prompts` 控制请求数；用 QPS 扫描看吞吐-延迟曲线。来源：https://github.com/vllm-project/vllm/tree/main/benchmarks
- **IETF LLM Benchmarking Methodology 草案**（draft-gaikwad-llm-benchmarking-methodology）：
  - 建议负载 25%/50%/75%/90% of saturation 多档。
  - 饱和检测：队列深度持续增长 / 完成率 < 90% 到达率 / P99 > 10× P50。
  - 报告最优工作点（最高吞吐且满足 SLO）、knee point（P99 超过最小 P99 的 2 倍）、saturation point（吞吐首次下降）。
  - 来源：https://datatracker.ietf.org/doc/draft-gaikwad-llm-benchmarking-methodology/
- **OpenRouter**：rolling 5 分钟窗口的 p50/p75/p90/p99 吞吐与延迟，用于实时路由决策（`preferred_min_throughput` / `preferred_max_latency` 支持多百分位）。来源：https://openrouter.ai/docs/guides/routing/provider-selection

### B.4 不同模型输出长度不同时如何归一对齐

主流三种做法：

1. **统一 tokenizer 计数**（AA 用 tiktoken o200k_base，llmperf 用 LlamaTokenizer）：同一段文本各模型算成相同 token 数 → 消除 tokenizer 差异。AA 明确："All 'tokens per second' metrics refer to OpenAI tokens"。来源：https://artificialanalysis.ai/methodology
2. **固定输出长度**（llm-speed、vLLM sonnet、MLPerf 固定 OSL 分布）：强制 max_tokens 一致，比较 e2e 或 per-token 都可。
3. **合成归一化指标**（AA 的 "Total Response Time for 100 Output Tokens" = TTFT + 100/output_speed）：把不同输出长度换算到同一长度再比较 e2e。来源：https://artificialanalysis.ai/methodology/performance-benchmarking

---

## C. 首字延迟(TTFT) 应不应计入 TPS —— 业界口径

**结论：per-request 的生成速度指标（Output Speed / decode TPS / TPOT / ITL）一律排除 TTFT；TTFT 单独作为延迟指标展示。** 若要把两者合并，需用"含 TTFT 的 e2e 速度"这一独立指标并固定输出长度。

逐家证据：

| 机构/工具 | 口径 | 来源 |
|---|---|---|
| **Artificial Analysis** | Output Speed = "average number of tokens received per second, **after the first token is received**"。TTFT 是独立指标。另有 "Total Response Time for 100 Output Tokens" 把 TTFT+OutputSpeed 合成但固定到 100 token。 | https://artificialanalysis.ai/methodology/performance-benchmarking |
| **OpenRouter** | Throughput (output speed) = "output tokens generated per second **after generation begins**"；与 TTFT 分开评估。 | https://openrouter.ai/blog/insights/evaluate-llm-provider-performance/ |
| **vLLM** | TPOT = `(e2e − TTFT)/(out−1)`，标题明写 excl. 1st token；ITL 逐 token 间隔，天然不含 TTFT。聚合 `output_throughput` 用总时长（会混入 TTFT，社区认为它低估、建议另设单独指标）。 | https://github.com/vllm-project/vllm/blob/v0.8.2/benchmarks/benchmark_serving.py 、https://github.com/vllm-project/vllm/issues/23820 |
| **NVIDIA GenAI-Perf / NIM** | ITL 显式 `(e2e − TTFT)/(out−1)`，明确"excluding TTFT"；TPS per user 才用 `OSL/e2e`（含 TTFT）。 | https://docs.nvidia.com/nim/benchmarking/llm/latest/metrics.html 、https://developer.nvidia.com/blog/llm-benchmarking-fundamental-concepts/ |
| **MLPerf** | TTFT 和 TPOT 是两个独立 latency SLO；吞吐用 tokens/s。 | https://mlcommons.org/2024/03/mlperf-llama2-70b/ |
| **llm-speed** | Decode tok/s "computed from wall-clock time **between the first generated token and the last generated token**"，明确排除 prefill。 | https://llm-speed.com/methodology |
| **kubernetes-sigs/inference-perf** | TPOT = `(e2e − TTFT)/(out−1)`；另有 Normalized TPOT = `e2e/out`（含 TTFT 的每 token 平均，专门用于跨用例归一比较）。 | https://github.com/kubernetes-sigs/inference-perf/blob/main/docs/metrics.md |
| **OpenAI Help Center** | 监控仪表盘把 "Token Velocity"（独立于 prompt 大小）与 "Time to First Token" 作为**两个不同指标**。 | https://help.openai.com/en/articles/1000499-troubleshooting-api-errors-and-latency |

**对你项目当前实现的直接影响**：
- "全文 tokens / 总耗时" 实际上就是 **TPS per user（含 TTFT）**，业界确实有人用，但它**不是 decode 速度**，而且输出越长 TPS 越高是数学必然（`OSL/e2e` 中 e2e ≈ TTFT + OSL×ITL，当 OSL 大时 → 1/ITL）。这与 NVIDIA NIM 文档的 TPS-per-user 定义一致。
- 若要给用户一个"生成快不快"的公平指标，应该用 **output speed = (输出 token − reasoning token) / (e2e − TTFT)**（per-request decode 速度），TTFT 单独展示。
- 若要 e2e 综合指标，必须固定 max_tokens/输出长度，否则不可比。

---

## D. reasoning/thinking tokens 的业界处理

### D.1 各家 OpenAI-compatible / 原生 API 的暴露差异（无统一标准）

| 厂商/API | reasoning token 计数字段 | 是否计入 output/completion_tokens | 内容暴露方式 |
|---|---|---|---|
| **OpenAI Responses API** | `usage.output_tokens_details.reasoning_tokens` | **计入** `output_tokens`（计费、占 context） | 不暴露原始推理；可选 `summary`；`reasoning` output item | 
| **OpenAI Chat Completions API** | `usage.completion_tokens_details.reasoning_tokens` | **计入** `completion_tokens` | 不暴露；`max_completion_tokens` 限制 reasoning+可见 |
| **Anthropic Claude（extended/adaptive thinking）** | `usage.output_tokens_details.thinking_tokens`（流式时在最后 message_delta 才有） | **计入** `output_tokens`（`max_tokens` 内） | `thinking` content block 明文（或 `display: "summarized"/"omitted"`）；流式 `thinking_delta` 事件 |
| **DeepSeek（thinking mode）** | `usage.completion_tokens_details.reasoning_tokens`（OpenAI 兼容） | **计入** `completion_tokens` | `reasoning_content` 字段与 `content` 平级；工具调用时必须回传 |
| **Google Gemini** | `usage_metadata.thoughts_token_count`（camelCase `thoughtsTokenCount`；新版 `total_thought_tokens`） | **不计入** `candidates_token_count`，单独字段，但按 output 价格计费 | 只输出 `summary` + 加密 `signature`；`thinkingBudget` 控制 |
| **xAI Grok** | 顶层 `reasoning_tokens`（gRPC proto 才有；REST 不暴露） | — | — |

来源：
- OpenAI reasoning guide（Responses `output_tokens_details.reasoning_tokens`）：https://developers.openai.com/api/docs/guides/reasoning
- OpenAI token counting（output_tokens 含非可见 token）：https://developers.openai.com/api/docs/guides/token-counting
- OpenAI Chat Completions 兼容字段（`usage.completion_tokens_details.reasoning_tokens` / `max_completion_tokens`）：[runcycles 博客](https://runcycles.io/blog/budgeting-reasoning-tokens-governing-extended-thinking-before-it-bills)、[AIPerf vendor-usage-fields](https://github.com/ai-dynamo/aiperf/blob/main/docs/reference/vendor-usage-fields.md)
- Anthropic extended thinking（`usage.output_tokens_details.thinking_tokens`）：https://platform.claude.com/docs/en/build-with-claude/extended-thinking 、https://platform.claude.com/docs/en/build-with-claude/thinking
- Anthropic streaming thinking（`thinking_delta` 事件）：https://platform.claude.com/docs/en/build-with-claude/streaming
- DeepSeek thinking mode（`reasoning_content`）：https://api-docs.deepseek.com/guides/thinking_mode 、DeepSeek create-chat-completion（`completion_tokens_details.reasoning_tokens`）：https://api-docs.deepseek.com/api/create-chat-completion
- Gemini tokens（`thoughts_token_count`，不计入 candidates）：https://ai.google.dev/gemini-api/docs/generate-content/tokens 、https://ai.google.dev/gemini-api/docs/generate-content/thinking
- AIPerf 对各厂商 usage 字段的交叉核验表（含 xAI Grok 顶层 `reasoning_tokens`）：https://github.com/ai-dynamo/aiperf/blob/main/docs/reference/vendor-usage-fields.md
- 三厂商对比（OpenAI/Anthropic/Google reasoning API 差异）：https://zenn.dev/sioois/articles/c07e2f8a1ffa2a?locale=en 、https://dev.to/multigrid/hidden-reasoning-tokens-billed-invisible-and-yours-to-handle-4i7m

**关键注意点（对测速工具非常重要）**：
1. **流式 chunk 里 reasoning 的字段名不一致**：OpenAI 兼容生态里，DeepSeek/Qwen3/GLM/gpt-oss 等把思考内容放在 `delta.reasoning_content` 或 `delta.reasoning`，而不是 `delta.content`。若工具只解码 `delta.content`，整个思考阶段 content 为空 → **TTFT 计时不会在思考开始时停止，整个 reasoning 时长被算进 TTFT（或"prefill 时间"）**，速度指标严重失真。此 bug 在 [anubis-oss issue #17](https://github.com/uncSoft/anubis-oss/issues/17) 被详细记录并修复（修复方式：TTFT 在首个非空 reasoning 或 content chunk 触发；reasoning tokens/时长单独跟踪并从 output tok/s 中剔除）。
2. **Anthropic 流式**：thinking 走 `content_block_delta` 里的 `thinking_delta`；text 走 `text_delta`；token 计数在 `message_delta` 且是累计值。https://platform.claude.com/docs/en/build-with-claude/streaming
3. **Gemini 的 thoughts_token_count 不计入 candidates_token_count**，如果你直接用 `candidates_token_count` 当输出 token，会漏掉思考 token；而 OpenAI/Anthropic/DeepSeek 的 reasoning 是计入 output/completion 的。**跨厂商时必须显式区分"可见 token"与"计费 output token"。**

### D.2 benchmark 时是否把 reasoning 计入速度指标 —— Artificial Analysis 的处理

AA 是目前对 reasoning 模型速度口径讲得最清楚的一家：

- **Output Speed 定义不变**（after first token 的平均 tokens/s），但：
  - "For reasoning models that do not expose all reasoning tokens in the response, we calculate output speed **using the last 80% of answer chunks**. This ensures measured output speeds are consistent and more closely reflect user experience." 来源：https://artificialanalysis.ai/methodology/performance-benchmarking
- **TTFT 定义**：对 reasoning 模型，TTFT = 收到**第一个 reasoning token** 的时间。
- **Time to First Answer Token**：对 reasoning 模型，是"thinking 结束后的首个回答 token"时间（单独指标）。
- **Thinking Time**：reasoning 模型输出 reasoning token 的时间。用 "Average Reasoning Tokens"（60 道多样 prompt 的平均 reasoning token 数，未知时默认 2k）换算。
- **端到端响应时间** = 输入时间（TTFT）+ thinking 时间 + 回答时间（如 500 输出 token / output speed）。来源：https://artificialanalysis.ai/methodology
- **AA-AgentPerf**：SLO 表用 P25 Output Speed（不细分 reasoning），并明确"正在从 Output Speed + TTFT 两个指标转向综合的 E2E Speed（含等待首 token 的整段吞吐）"；测 reasoning 模型时用"creator 推荐参数 + 最大 thinking effort"。来源：https://artificialanalysis.ai/methodology/agentperf

其他工具：
- **lm-eval-harness**：提供 `think_end_token` 与 `enable_thinking` 模型参数，把 Qwen3/DeepSeek-R1 的 CoT 剥离后再算评测指标（这是质量评测，不是速度）。来源：https://github.com/EleutherAI/lm-evaluation-harness/blob/main/docs/interface.md
- **anubis-oss**：修复后 "reasoning tokens and reasoning_duration are tracked separately and excluded from the output tokens/sec figure, so the headline tok/s is the visible-output rate, not visible+thinking"。来源：https://github.com/uncSoft/anubis-oss/issues/17
- **FlexBench / MLPerf 系**：MLPerf v5.0 的 reasoning 相关模型（DeepSeek-R1-Distill 等）沿用 TTFT+TPOT 口径，未把 reasoning 单列。来源：https://github.com/flexaihq/flexbench

**业界结论**：**没有统一标准**。做法分三派：
- (a) 把 reasoning 当作普通输出 token 一起算（最粗，会把"想得多"的模型速度拉低）；
- (b) 把 reasoning 单独跟踪并从 output speed 分子剔除（AA 用"最后 80% 块"，anubis 用 usage 拆分）；
- (c) 完全不区分（早期工具，会污染 TTFT 和吞吐，已被认定为 bug）。
推荐：(b)，并把 reasoning token 数、thinking 时长作为**附加展示维度**，而不是混进单一速度数字。

---

## E. 统计口径

### E.1 集中趋势：mean vs median

- **Latency 类指标（TTFT、ITL、TPOT、E2EL）**：**推荐 median(P50) 为主指标**，因为延迟呈右偏长尾，mean 被少量慢请求拉高（"一个 10s 超时把 1000 个 <100ms 请求的 mean 拉高 10ms"）。来源：https://www.statstest.com/percentiles-latency-comparing-p50-p95-correctly
- **吞吐/容量类指标（RPS、系统 tok/s、总产出）**：**用 mean（总 token / 总时长）**，因为 Little's Law 只有 mean 成立，容量规划需要每个毫秒都算。来源：https://modulovalue.com/blog/statistical-methods-for-reliable-benchmarks/
- Artificial Analysis 官方：性能指标用 **median (P50)** over past 72h（100k 输入 workload 例外：past 14 天，每周测一次）。来源：https://artificialanalysis.ai/methodology/performance-benchmarking
- OpenRouter：p50/p75/p90/p99 都跟踪（rolling 5 min）。来源：https://openrouter.ai/docs/guides/routing/provider-selection
- vLLM benchmark_serving：mean/median/std/percentiles 全输出，默认 percentiles 含 P99。来源：https://github.com/vllm-project/vllm/blob/v0.8.2/benchmarks/benchmark_serving.py
- IETF 草案：TTFT 要求报 P50/P90/P95/P99/P99.9 + mean + min + max。来源：https://datatracker.ietf.org/doc/draft-gaikwad-llm-benchmarking-methodology/

### E.2 尾部分位数（P95/P99）的样本量要求

- P99 的可靠估计需要很多样本：n=1000 时只有 ~10 个样本落在 P99 之上，不确定度很大。StatsTest 给出 P99 有效样本量约为 mean 的 ~50 倍；"P99 comparisons require roughly 100× the data of mean comparisons"。来源：https://www.statstest.com/percentiles-latency-comparing-p50-p95-correctly
- IETF 草案量化：**P99 在 95% 置信度下达到 10% 相对误差，至少 1000 样本；P99.9 至少 10000 样本**，报告必须声明样本数。来源：https://datatracker.ietf.org/doc/draft-gaikwad-llm-benchmarking-methodology/
- 分位数置信区间用 **bootstrap**（重抽样 1000+ 次）而非公式。来源：https://www.statstest.com/percentiles-latency-comparing-p50-p95-correctly
- 经验法则：测延迟至少 20 次才有意义的 p95（否则索引越界/无意义）。来源：https://theneuralbase.com/langsmith/learn/intermediate/aggregate-metrics-mean-p50-p95/

### E.3 重复次数 / warmup / 异常值 / 顺序随机化

- **warmup**：先跑若干次预热（KV cache、JIT/内核编译、模型加载），丢弃 warmup 计时。来源：https://apxml.com/courses/quantized-llm-deployment/chapter-3-performance-evaluation-quantized-llms/measuring-inference-latency-throughput 、https://modulovalue.com/blog/statistical-methods-for-reliable-benchmarks/
- **重复次数**：benchstats 建议**至少 10 次重复**（`--benchmark_repetitions=10`）配合非参数检验（Brunner-Munzel / Mann-Whitney U），并启用随机交错以消除顺序偏差。来源：https://github.com/Arech/benchstats
- **样本量取决于变异性**（不是固定值）：先跑 pilot 样本，动态计算置信区间，收敛到目标精度后停止。来源：https://htor.inf.ethz.ch/blog/index.php/2016/04/14/how-many-measurements-do-you-need-to-report-a-performance-number/
- **CV%（变异系数）**：<10% 优秀、10–20% 良好、20–50% 仅方向性、>50% 基本是噪声。来源：https://modulovalue.com/blog/statistical-methods-for-reliable-benchmarks/
- **异常值**：不要把 outlier 静默删除。做法：(a) 报告 mean 和 median 的差来提示偏态；(b) 对已知异常（超时、GC、网络抖动）单独调查；(c) 异常值过滤前必须明确定义规则。来源：https://theneuralbase.com/langsmith/learn/intermediate/aggregate-metrics-mean-p50-p95/ 、https://modulovalue.com/blog/statistical-methods-for-reliable-benchmarks/
- **顺序随机化**：多个模型对比时随机化测量顺序，避免热机漂移造成系统偏差。来源：https://modulovalue.com/blog/statistical-methods-for-reliable-benchmarks/
- **min（fastest）也有意义**：作为"机器能达到的潜力"的存在性证明（噪声只会让测量变慢）。来源：https://modulovalue.com/blog/statistical-methods-for-reliable-benchmarks/

### E.4 并发测试的统计细节

- AA-SLT：每档并发 3 分钟，持续补发请求（稳定负载），报 median；测到吞吐平台期为止。来源：https://artificialanalysis.ai/methodology/system-load-test
- IETF 草案：多档负载（25/50/75/90% of saturation），报每档 offered load、achieved tok/s、TTFT/TPOT/E2E 的 P50/P95/P99、success rate。来源：https://datatracker.ietf.org/doc/draft-gaikwad-llm-benchmarking-methodology/
- AA-AgentPerf：稳态过滤（所有 agent 活跃 ≥30s 才计入），phase 至少 30 trajectories / 每 agent 3 条 / 稳态 10 分钟。来源：https://artificialanalysis.ai/methodology/agentperf
- vLLM：`--request-rate` 支持恒定速率或 Poisson；`--metric-percentiles` 可选任意百分位。来源：https://github.com/vllm-project/vllm/blob/v0.8.2/benchmarks/benchmark_serving.py

---

## F. 现成开源 benchmark 工具 / metrics 库

### F.1 服务端/托管端点测速工具（与你的工具最相关）

| 工具 | 说明 | 指标 | 来源 |
|---|---|---|---|
| **vLLM benchmark_serving.py**（`vllm bench serve`） | 业界事实标准 serving benchmark；支持 OpenAI 兼容后端 | TTFT/TPOT/ITL/E2EL 的 mean/median/std/percentiles；output/total token throughput；request throughput；goodput（SLO） | https://github.com/vllm-project/vllm/blob/v0.8.2/benchmarks/benchmark_serving.py |
| **ray-project/llmperf** | 对任意 LLM API 做 load test + correctness test；并发请求测 ITL 与吞吐 | inter-token latency、generation throughput、TTFT；LlamaTokenizer 统一计数 | https://github.com/ray-project/LLMPerf （2025 年归档，社区用 infermark 接替） |
| **infermark** | 继承 llmperf/llm-bench 的生态位；任意 OpenAI-compatible 端点 | TTFT、ITL、吞吐、P50–P99、RPS、错误率；并发阶梯、warmup | https://github.com/stef41/infermark |
| **NVIDIA GenAI-Perf** | 官方工具；定义 TTFT/ITL/TPS per system/user/RPS | 同上；AIPerf 是其后续收集器 | https://developer.nvidia.com/blog/llm-benchmarking-fundamental-concepts/ 、https://docs.nvidia.com/nim/benchmarking/llm/latest/metrics.html |
| **AIPerf**（ai-dynamo） | NVIDIA NIM 生态的采集器；对各家 vendor usage 字段做了交叉核验（含 reasoning 字段） | 兼容 OpenAI/Anthropic/DeepSeek/Gemini/xAI 的 usage 字段 | https://github.com/ai-dynamo/aiperf/blob/main/docs/reference/vendor-usage-fields.md |
| **Artificial Analysis llm-performance-benchmark**（pypi） | AA 官方测速脚本（OpenAI-compatible） | TTFT、Output tokens/s；tiktoken cl100k_base 统一计数 | https://pypi.org/project/llm-performance-benchmark/ |
| **llm-speed** | 本地后端（llama.cpp/MLX/vLLM/ollama）跨机可复现测速，suite 版本化 + 签名 | decode tok/s、prefill tok/s、TTFT、p50/p95 decode latency | https://llm-speed.com/methodology 、https://github.com/coder543/llm-speed-benchmark |
| **iopsystems/llm-perf**（Rust） | OpenAI-compatible 高并发测速 | RPS、in/out tok/s、TTFT/TPOT/ITL/E2E 百分位、TTFT/ITL 按输入长度分桶 | https://github.com/iopsystems/llm-perf |
| **sgl-project/genai-bench** | SGLang 生态，token 级性能 + 实时 UI + Excel 报告 | TTFT/E2E/TPOT、吞吐、RPS、错误率，按流量场景与并发分档 | https://github.com/sgl-project/genai-bench |
| **JmPotato/llm-provider-benchmark** | LiteLLM 多 provider，指标命名最全（含 TBT） | TTFT/TPOT/ITL/TBT/E2E/TPS/RPS/Goodput/Error Rate；P50/P90/P95/P99 | https://github.com/JmPotato/llm-provider-benchmark |
| **agent-bench / bench-my-llm / aibench / llm-perf-bench** 等 | 社区 CLI，功能类似 | TTFT、total、tok/s、p50/p95/p99、cost、accuracy | https://github.com/arcane-bear/agent-bench 、https://github.com/ManasVardhan/bench-my-llm 、https://github.com/steipete/aibench 、https://github.com/philschmid/llmperf-bench |

### F.2 质量评测框架（不是速度，但规定了如何公平比较）

- **lm-eval-harness**（EleutherAI）：质量评测事实标准；支持 `think_end_token`/`enable_thinking` 剥离 CoT；报告 SE（bootstrap 或闭式）。**它不测速度。** 来源：https://github.com/EleutherAI/lm-evaluation-harness/ 、https://arxiv.org/abs/2405.14782
- **HELM**（Stanford CRFM）：多指标（accuracy + efficiency 等 7 类）横评，强调标准化、可复现。来源：https://crfm.stanford.edu/helm/ 、https://arxiv.org/abs/2211.09110
- **MLPerf Inference**：官方 LLM 基准，TTFT/TPOT SLO + tokens/s 吞吐。来源：https://mlcommons.org/2024/03/mlperf-llama2-70b/
- **FlexBench / LLM-Inference-Bench**：MLPerf-compliant 或加速器横评。来源：https://github.com/flexaihq/flexbench 、https://github.com/argonne-lcf/LLM-Inference-Bench

### F.3 关于 "FastBench" 的说明

搜索 "FastBench" 未找到 LLM 测速领域的**权威同名工具**（同名命中是 Node.js 微基准 `mcollina/fastbench`，与 LLM 无关）。与用户列表中其他工具并列的、可类比的新近项目是 **llm-speed、infermark、genai-bench、agent-bench** 等（见 F.1）。若用户指的是某个特定项目，需确认准确名称。

---

## G. 对本项目的综合建议（综合以上调研）

### G.1 指标定义（推荐）

per-request 速度指标改为：
```
output_speed (tok/s) = (completion_tokens − reasoning_tokens) / (e2e_latency − ttft)
decode_tok_per_sec    = (completion_tokens − reasoning_tokens) / (e2e_latency − ttft)   # 同上
ttft (s)              = first_token_at − request_started_at   # 独立展示
```
- 分子用 `completion_tokens − reasoning_tokens`（可见/回答 token），或明确标注 "含 reasoning" 的另一种口径并同时展示 reasoning 数。
- 分母用 `e2e − ttft`（排除 TTFT）。若后端不支持流式/无法测 TTFT，则降级为 `completion_tokens / e2e` 并标注 "e2e 口径（含 TTFT）"。
- 聚合系统吞吐另算：`sum(output_tokens) / total_duration`（可含 TTFT，用于并发场景，不与 per-request decode 速度混淆）。

### G.2 展示（推荐）

- **分开展示**：TTFT、Output Speed、reasoning tokens（可选 Thinking Time）三个维度并列，不合成单一分数。
- 若用户需要单一"综合分"，用合成指标并固定输出长度（如 "Time to Generate 100 Answer Tokens" = ttft + 100 / output_speed），AA 的做法。
- 按**输入长度桶**和**输出长度桶**分组展示（vLLM/llm-perf 都支持按 ISL 分桶），以暴露"输出越长 TPS 越高"的效应并让用户看到可比组内的数字。

### G.3 reasoning 处理（推荐）

- 解析流式 chunk 时**同时读取 `delta.content`、`delta.reasoning_content`、`delta.reasoning`、`thinking_delta`**，TTFT 在首个**任一非空内容**到达时停止（否则 reasoning 阶段会被误算进 TTFT —— 这是 anubis 踩过的坑）。
- 从 usage 读取 reasoning 拆分：优先 `completion_tokens_details.reasoning_tokens`（OpenAI/DeepSeek）→ `output_tokens_details.reasoning_tokens`（OpenAI Responses）→ `output_tokens_details.thinking_tokens`（Anthropic）→ `thoughts_token_count`（Gemini，注意该字段**不计入** candidates_token_count，需自行加总）。
- 速度指标默认用"可见/回答 token"，同时展示 reasoning token 数。对无法从 usage 拆分 reasoning 的厂商（部分网关/代理），标注"reasoning 已计入"。

### G.4 统计（推荐）

- 主指标用 **median(P50)**，同时报 p90/p95/p99；吞吐/容量用 mean。
- 每模型建议 **≥10 次**重复（预算允许 30–100 次），每次**先 warmup 再计时**。
- 报样本数；P99 若要可信需 ~1000 样本（本项目展示用 p50/p95 即可，样本不足时明确标注）。
- 异常值：记录并单独标注（如超时、429/限流、非 2xx），**不静默删除**；可提供"排除失败请求"和"全部请求"两个版本。
- 并发测试：固定并发阶梯（1/2/4/8/16/32/64）每档稳定时长，找吞吐平台期；或按用户配置的并发数测试。

### G.5 明确的"无统一标准"项

- **reasoning tokens 是否计入速度**：无统一标准。AA 用"最后 80% 块"近似；anubis/各家自建工具用 usage 拆分；有些厂商（Gemini）把 thoughts 单独字段。→ 本项目推荐"拆分展示、默认剔除"。
- **e2e 吞吐的口径**：TPS per user（含 TTFT）与 decode speed（不含 TTFT）并存。→ 本项目推荐两者都算，明确标签。
- **并发度选择**：无统一值，取决于你的定位。→ 推荐参考 AA-SLT 阶梯（1→2→4→8→16→32→64）或让用户自配。
- **token 计数**：无统一标准。AA 用 tiktoken o200k_base；llmperf 用 LlamaTokenizer；本工具面向任意 OpenAI-compatible 端点，建议默认用**服务端 usage**（最接近计费口径），并提供"按统一 tokenizer 重计"选项作对照。

---

## 附：主要来源 URL 汇总

**指标定义**
- vLLM benchmark_serving.py：https://github.com/vllm-project/vllm/blob/v0.8.2/benchmarks/benchmark_serving.py
- vLLM 关于 output throughput 混入 TTFT 的讨论：#23820 https://github.com/vllm-project/vllm/issues/23820 、PR #8164 https://github.com/vllm-project/vllm/pull/8164
- NVIDIA NIM Metrics：https://docs.nvidia.com/nim/benchmarking/llm/latest/metrics.html
- NVIDIA GenAI-Perf 概念：https://developer.nvidia.com/blog/llm-benchmarking-fundamental-concepts/
- MLPerf Llama2 70B：https://mlcommons.org/2024/03/mlperf-llama2-70b/ ；MLPerf v5.0：https://mlcommons.org/2025/04/llm-inference-v5/ ；MLPerf docs：https://docs.mlcommons.org/inference/
- kubernetes-sigs/inference-perf metrics：https://github.com/kubernetes-sigs/inference-perf/blob/main/docs/metrics.md
- IETF LLM Benchmarking Methodology 草案：https://datatracker.ietf.org/doc/draft-gaikwad-llm-benchmarking-methodology/
- QAInsights TTFT：https://qainsights.com/how-to-measure-time-to-first-token-ttft-in-ai-systems/
- OpenAI Help Center latency：https://help.openai.com/en/articles/1000499-troubleshooting-api-errors-and-latency

**横评方法论**
- Artificial Analysis methodology：https://artificialanalysis.ai/methodology 、https://artificialanalysis.ai/methodology/performance-benchmarking 、AA-SLT https://artificialanalysis.ai/methodology/system-load-test 、AA-AgentPerf https://artificialanalysis.ai/methodology/agentperf 、AA API https://artificialanalysis.ai/data-api
- OpenRouter provider evaluation：https://openrouter.ai/blog/insights/evaluate-llm-provider-performance/ 、routing https://openrouter.ai/docs/guides/routing/provider-selection
- llm-speed methodology：https://llm-speed.com/methodology
- ray-project/llmperf：https://github.com/ray-project/LLMPerf

**reasoning tokens**
- OpenAI reasoning guide：https://developers.openai.com/api/docs/guides/reasoning
- OpenAI token counting：https://developers.openai.com/api/docs/guides/token-counting
- Anthropic extended thinking：https://platform.claude.com/docs/en/build-with-claude/extended-thinking ；thinking 总览 https://platform.claude.com/docs/en/build-with-claude/thinking ；streaming https://platform.claude.com/docs/en/build-with-claude/streaming
- DeepSeek thinking mode：https://api-docs.deepseek.com/guides/thinking_mode ；API reference https://api-docs.deepseek.com/api/create-chat-completion
- Gemini tokens：https://ai.google.dev/gemini-api/docs/generate-content/tokens ；thinking https://ai.google.dev/gemini-api/docs/generate-content/thinking
- AIPerf vendor usage 字段交叉核验：https://github.com/ai-dynamo/aiperf/blob/main/docs/reference/vendor-usage-fields.md
- anubis-oss thinking-token TTFT bug：https://github.com/uncSoft/anubis-oss/issues/17
- 三家对比：https://zenn.dev/sioois/articles/c07e2f8a1ffa2a?locale=en 、https://dev.to/multigrid/hidden-reasoning-tokens-billed-invisible-and-yours-to-handle-4i7m
- runcycles reasoning 计费：https://runcycles.io/blog/budgeting-reasoning-tokens-governing-extended-thinking-before-it-bills

**统计口径**
- StatsTest percentiles：https://www.statstest.com/percentiles-latency-comparing-p50-p95-correctly
- Hoefler 测量次数：https://htor.inf.ethz.ch/blog/index.php/2016/04/14/how-many-measurements-do-you-need-to-report-a-performance-number/
- modulovalue 统计方法：https://modulovalue.com/blog/statistical-methods-for-reliable-benchmarks/
- benchstats：https://github.com/Arech/benchstats
- LangSmith 聚合：https://theneuralbase.com/langsmith/learn/intermediate/aggregate-metrics-mean-p50-p95/
- 量化部署测量：https://apxml.com/courses/quantized-llm-deployment/chapter-3-performance-evaluation-quantized-llms/measuring-inference-latency-throughput

**工具**
- lm-eval-harness：https://github.com/EleutherAI/lm-evaluation-harness/ 、docs/interface https://github.com/EleutherAI/lm-evaluation-harness/blob/main/docs/interface.md
- HELM：https://crfm.stanford.edu/helm/ 、https://github.com/stanford-crfm/helm 、https://arxiv.org/abs/2211.09110
- infermark：https://github.com/stef41/infermark
- genai-bench：https://github.com/sgl-project/genai-bench
- iopsystems llm-perf：https://github.com/iopsystems/llm-perf
- AA 测速脚本 pypi：https://pypi.org/project/llm-performance-benchmark/
- FlexBench：https://github.com/flexaihq/flexbench
