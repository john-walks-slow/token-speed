# 调研：2026 年仍可用的免费 LLM API 提供方

日期：2026-09-20
目的：为 token-speed（LLM API 测速/巡检）筛选「无需付费、无需绑信用卡、OpenAI 兼容（或可适配）、支持 chat completions」的提供方。
已覆盖不重复调研：Groq、NVIDIA NIM、Google Gemini、OpenCode Zen。已排除：SambaNova / Cerebras / Together / Fireworks（绑卡或付费）。

## 结论速览

| 提供方 | 真免费（无卡） | OpenAI 兼容 base_url | 免费层限额 | 判断 |
|---|---|---|---|---|
| Cloudflare Workers AI | 是 | `https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1` | 10,000 Neurons/天；文本默认 300 RPM | **强烈推荐加入** |
| Z.ai（智谱国际站） | 是（邮箱注册） | `https://api.z.ai/api/paas/v4/` | GLM-4.7/4.5/4.6V-Flash 永久 $0；约 1 并发 ~1 RPS | **强烈推荐加入** |
| 智谱 bigmodel.cn（国内站） | 是（手机号+实名） | `https://open.bigmodel.cn/api/paas/v4/` | Flash 系列长期免费，限速不限量 | **推荐加入**（国内直连） |
| OpenRouter `:free` | 是 | `https://openrouter.ai/api/v1` | 20 RPM；50 请求/天（曾购 $10 额度则 1000/天） | **推荐加入**（统一入口） |
| Kilo Code Gateway | 是（可匿名） | `https://api.kilo.ai/api/gateway`（v1 路径同样有效） | 匿名 200 请求/小时/IP，仅 `:free` 模型 | **推荐加入**（零注册成本） |
| ModelScope API-Inference | 是（需实名） | `https://api-inference.modelscope.cn/v1/` | 2000 次/天（全部模型共享） | **推荐加入**（国内直连，模型阵容强） |
| Mistral La Plateforme | 是（需手机验证） | `https://api.mistral.ai/v1` | ~1 RPS / 500K TPM / ~1B tokens/月 | 可加，注意手机验证门槛 |
| Cohere trial key | 是 | 不兼容（`https://api.cohere.com/v2/chat`，自有响应结构） | 1000 次/月，20 RPM | 不推荐（需适配器 + 条款禁商用/生产） |
| GitHub Models | — | — | — | **已死**，2026-07-30 全线退役（实测 410） |
| Hugging Face Inference Providers | 是 | `https://router.huggingface.co/v1` | 仅 $0.10/月 额度 | 不推荐（额度太小） |
| SiliconFlow 硅基流动 | 是（需实名） | `https://api.siliconflow.cn/v1` | 小模型永久免费 + 新用户赠金 | 可选（国内直连备选） |
| Alibaba Model Studio（国际站） | 是 | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | 每模型 1M tokens，90 天一次性 | 不推荐（一次性额度，无长期监控价值） |
| OVHcloud AI Endpoints | 是（可匿名） | `https://oai.endpoints.kepler.ai.cloud.ovh.net/v1` | 匿名约 2 RPM/模型 | 可选（低优先级） |

---

## 一、逐家详情

### 1. Cloudflare Workers AI —— 强烈推荐

- **真免费**：Workers Free 计划含每天 10,000 Neurons 免费额度，注册无需信用卡。额度每日 00:00 UTC 重置。来源：[官方定价页](https://developers.cloudflare.com/workers-ai/platform/pricing/)、[DEV 实测文章](https://dev.to/build996/cloudflare-workers-ai-free-edge-ai-inference-with-47-models-b66)（明确写明 "10,000 neurons per day — free, no credit card required"）。
- **OpenAI 兼容**：提供 `/v1/chat/completions` 与 `/v1/embeddings`，官方文档 [OpenAI compatible API endpoints](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/)。base_url 需含 account_id：
  ```
  https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1
  ```
  实测该路由存在（用假 account_id 返回 Cloudflare 标准路由错误而非 404）。
- **可用模型（免费计划内）**：`@cf/meta/llama-3.3-70b-instruct`、`@cf/meta/llama-3.1-8b-instruct`、`@cf/openai/gpt-oss-120b`、`@cf/openai/gpt-oss-20b`、Qwen3 30B、QwQ 32B、Gemma 3/4、Mistral Small 3.1 等。注意 frontier 模型（`@cf/moonshotai/kimi-k2.6`、`kimi-k2.7-code`、`@cf/zai-org/glm-5.2`）**免费计划不可用**（返回 403 提示升级）。来源：[定价页](https://developers.cloudflare.com/workers-ai/platform/pricing/)、[Workers AI Changelog](https://developers.cloudflare.com/changelog/product/workers-ai/)。
- **限额**：文本生成默认 300 请求/分钟（小模型更高，如 qwen1.5-0.5b 为 1500 RPM；frontier 模型 20 RPM/账号）。来源：[Limits 页](https://developers.cloudflare.com/workers-ai/platform/limits/)。
- **Neurons 换算参考**（第三方按官方定价页推算，仅计输出 token）：Llama 3.3 70B 约 49K tokens/天、gpt-oss-120b 约 147K、Llama 3.1 8B 约 287K。来源：[klymentiev.com 评测](https://klymentiev.com/blog/free-llm-api)。
- **特殊 header**：无，标准 `Authorization: Bearer {api_token}`。但 base_url 内嵌 account_id，配置项比一般 provider 多一个字段。
- **数据政策**：Cloudflare 不用你的内容训练模型。
- **判断**：值得加入巡检。免费额度按天重置、模型阵容实（Llama 3.3 70B 在 Groq/OpenRouter 下架后这里是少数仍免费的托管处）、无绑卡。对 token-speed 的意义：需要在 provider 配置中支持「base_url 带 account_id 占位符」。

### 2. Z.ai（智谱国际站）—— 强烈推荐

- **真免费**：邮箱或 Google/GitHub 注册即可，无需中国手机号、无需卡。来源：[Z.ai 开发者指南（baeseokjae）](https://baeseokjae.github.io/posts/z-ai-api-developer-guide-2026/)、[GLM Free API（toolfreebie）](https://toolfreebie.com/glm-free-api/)。
- **免费模型**（定价页 $0/$0，非试用额度）：`glm-4.7-flash`（~200K 上下文，主打 coding/agent）、`glm-4.5-flash`（128K）、`glm-4.6v-flash`（视觉，128K）。来源：[layer3labs 定价核查](https://www.layer3labs.io/guides/z-ai-pricing)（2026-09-02 核对）、[官方文档](https://docs.z.ai/guides/llm/glm-4.7?id=GLM4.7Flash)。
- **OpenAI 兼容 base_url**：`https://api.z.ai/api/paas/v4/`（官方推荐）；另有 `https://api.z.ai/api/openai/v1` 的说法（见 baeseokjae 指南）。另有 Anthropic 兼容端点 `https://api.z.ai/api/anthropic`（token-speed 已支持 Anthropic 协议，这是个额外加分项）。
- **限额**：官方不公布数字；第三方实测约 1 并发、~1 RPS（部分来源称 1000 请求/天）。错误码 429/1302 表示限速。来源：[toolfreebie](https://toolfreebie.com/glm-free-api/)、[free-llm.com](https://free-llm.com/provider/z-ai)、[TokenMix](https://tokenmix.ai/blog/glm-free-api-access-tiers-2026)。
- **特殊 header**：无必需项（文档示例带 `Accept-Language`，非必需）。
- **注意**：免费层默认参与数据训练的说法主要出现在国内站/其他家；Z.ai 免费模型条款为非商业研究用途的 carve-out（来源：[wotai 排名](https://wotai.co/blog/best-free-llm-apis)）。
- **判断**：值得加入。注册零门槛、模型独家（GLM 系）、还带 Anthropic 兼容端点。限速低但对巡检（低频定时测速）完全够用。

### 3. 智谱 BigModel（open.bigmodel.cn，国内站）—— 推荐（与 Z.ai 二选一或都加）

- **真免费**：手机号注册 + 实名认证，无需绑卡。来源：[ChooseAI 2026 价格核查](https://www.chooseai.net/news/6812/)。
- **免费模型**：`glm-4.7-flash`、`glm-4.5-flash`（即将下线）、`glm-4-flash-250414`、`glm-4v-flash`（视觉）等 Flash 系列长期免费，不限并发但有速率限制。来源：[官方免费模型文档](https://docs.bigmodel.cn/cn/guide/models/free/glm-4-flash-250414)、[TheRouter 指南](https://therouter.ai/zh/blog/zhipu-glm-api-complete-guide/)。
- **OpenAI 兼容 base_url**：`https://open.bigmodel.cn/api/paas/v4/`（官方 [OpenAI 兼容文档](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction)）。模型名小写无前缀，如 `glm-4.7-flash`。
- **新用户赠金**：注册赠送额度（网上说法 2000 万 token 不一，以控制台实际为准），但长期免费只依赖 Flash 系列。
- **判断**：值得加入，特别是「本地 App 在国内直连」场景（无墙、延迟低）。与 Z.ai 是同一模型家族的两个平台、key 不互通，可分别作为两条 provider 记录。巡检版（Azure 跑）则 Z.ai 更合适。

### 4. OpenRouter `:free` 模型 —— 推荐（作为统一入口/兜底）

- **真免费**：`:free` 后缀模型 $0 余额即可调用，无需卡。来源：[OpenRouter FAQ](https://openrouter.ai/docs/faq)、[官方限额文档](https://openrouter.ai/docs/api_reference/limits)。
- **OpenAI 兼容 base_url**：`https://openrouter.ai/api/v1`，标准 OpenAI SDK 直接可用。
- **限额**：20 请求/分钟；50 请求/天（账号级，所有 free 模型共享，UTC 午夜重置）；若曾累计购买过 $10 额度则升为 1000 请求/天。账号余额为负时连 free 模型都会 402。来源：[官方 limits](https://openrouter.ai/docs/api_reference/limits)、[apisrouter 解读](https://apisrouter.com/openrouter-free-tier-limits)。
- **当前免费模型（2026-09-20 实测 `GET /api/v1/models`，共 24 个）**：`z-ai/glm-5.2:free`、`qwen/qwen3.8-27b:free`、`google/gemma-4-31b-it:free`、`google/gemma-4-26b-a4b-it:free`、`nvidia/nemotron-3-ultra-550b-a55b:free`（1M 上下文）、`nvidia/nemotron-3-super-120b-a12b:free`、`nvidia/nemotron-3.5-lightning:free`、`cohere/north-mini-code:free`、`poolside/laguna-s-2.1:free`、`poolside/laguna-xs-2.1:free`、`thinkingmachines/inkling:free`、`thinkingmachines/inkling-small:free`、`inclusionai/ling-3.0-flash-*:free`、`nex-agi/nex-n2.5-pro/mini:free`、`liquid/lfm-2.5-2.6b:free`、`dots-studio/dots-3-note-preview:free`、`openrouter/free`（自动选免费模型的路由器）等。
- **风险**：免费阵容轮换极快——2026 年 6 月的免费模型（DeepSeek R1、Llama 3.3 70B、Qwen3 Coder 等）到 9 月已全部转为付费；上游 provider 容量不足时即使个人配额没用也会 429（第三方 9/11 测 19 个免费模型有 4 个被拒）。来源：[klymentiev](https://klymentiev.com/blog/free-llm-api)、[teamday 追踪](https://www.teamday.ai/blog/best-free-ai-models-openrouter-2026)、[costgoat 列表](https://costgoat.com/pricing/openrouter-free-models)。
- **判断**：值得加入，但定位是「统一入口/兜底」而非主力。测速巡检应选 1-2 个稳定的 `:free` 模型（如 `z-ai/glm-5.2:free`）并预期模型 ID 可能随时失效。注意国内访问需代理（巡检版在 Azure 无此问题）。

### 5. Kilo Code Gateway（api.kilo.ai）—— 推荐（零注册成本）

- **真免费**：`:free` 模型**支持完全匿名访问**（无任何 key），按 IP 限流 200 请求/小时。来源：[官方 Authentication 文档](https://kilo.ai/docs/gateway/authentication)、[Models & Providers](https://kilo.ai/docs/gateway/models-and-providers)。
- **实测（2026-09-20）**：`POST https://api.kilo.ai/api/gateway/chat/completions`，model `stepfun/step-3.7-flash:free`，无有效 key（Bearer none）即成功返回 chat.completion，响应为标准 OpenAI 结构（带额外 `reasoning` 字段）。完全 OpenAI 兼容。
- **免费模型**：`stepfun/step-3.7-flash:free`、`poolside/laguna-s-2.1:free`、`poolside/laguna-xs-2.1:free`、`nvidia/nemotron-3-ultra-550b-a55b:free`、`tencent/hy3:free`、`openrouter/free`、`kilo-auto/free`（自动路由，注意该路由可能转发到会记录 prompt 的 provider 如 NVIDIA 免费端点）。
- **判断**：值得加入。是 OpenCode Zen 之外又一个「零注册」提供方，且实测可用。限流按 IP，巡检版固定 Azure 出口 IP 需注意 200/小时上限。匿名请求即无 key，token-speed 的 api_key 需支持留空。

### 6. ModelScope API-Inference（魔搭）—— 推荐（国内直连、阵容最强）

- **真免费**：注册（支付宝/GitHub 登录）+ 绑定阿里云账号实名认证，无需付费。来源：[ModelScope 指南（GitHub）](https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep/blob/main/docs/MODELSCOPE_GUIDE.md)、[freellmapihub 条目](https://freellmapihub.com/p/modelscope)。
- **额度**：每日 2000 次调用（所有模型共享，0 点重置，永久免费不扣费）；主力模型（Qwen3-235B、Qwen3-Coder-480B、DeepSeek-V4、GLM 等）单模型每日约 500 次，DeepSeek-R1 约 200 次。有并发/QPS 限制且动态调整。来源：[faxai 详解](https://www.faxai.cn/archives/1779)、[官方公告](https://developer.aliyun.com/article/1651776)。
- **OpenAI 兼容 base_url**：`https://api-inference.modelscope.cn/v1/`，key 为 SDK Token（`ms-` 前缀）。同时支持 Anthropic 协议（`https://api-inference.modelscope.cn`，同一 key）。模型 ID 带 org 前缀，如 `deepseek-ai/DeepSeek-V4-Pro`、`Qwen/Qwen3-235B-A22B-Instruct`。
- **实测（2026-09-20）**：`GET /v1/models` 可匿名访问，返回大量模型（DeepSeek-V4-Pro、V4.1-Flash 等）；`/v1/chat/completions` 无 key 返回 401（端点正常）。
- **判断**：值得加入。免费额度大（2000 次/天）、模型阵容在免费层里最强（DeepSeek-V4-Pro、Qwen3-Coder-480B 级别），且国内直连。实名认证是一次性门槛。条款为非商用体验用途。

### 7. Mistral La Plateforme / Mistral AI Studio —— 可加，有门槛

- **真免费**：Free mode（原 Experiment 计划）无需信用卡，**但需手机号短信验证（一号一账号）**。来源：[官方激活文档](https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key)（"Free mode: API access is enabled by default with no credit card required"）、[aicreditmart 指南](https://aicreditmart.com/ai-credits-providers/mistral-ai-free-tier-la-plateforme-access-guide-2026/)。
- **免费内容**：全模型阵容可用（Mistral Large、Medium、Small、Codestral、Devstral 等）。限额约 1 RPS / 500K TPM / 1B tokens/月（官方已不再公开发布具体数字，需在 admin.mistral.ai/plateforme/limits 查看）。来源：[官方 rate limit 帮助页](https://help.mistral.ai/en/articles/698531)、[seminal.ai](https://seminal.ai/reference/providers/mistral/)。第三方（klymentiev，2026-09）称 Free 计划含每月 $10 额度。
- **OpenAI 兼容 base_url**：`https://api.mistral.ai/v1`。
- **注意**：Free mode 下 API 请求默认可能用于训练（可在 Admin Console → Privacy 关闭）。
- **判断**：可以加。1 RPS 对低频巡检够用；月度 1B token 上限宽裕。门槛是手机验证。国内访问需代理。

### 8. Cohere —— 不推荐

- **真免费**：注册即自动创建 trial/evaluation key，免费，无需卡。来源：[官方定价 FAQ](https://cohere.com/pricing)、[rate limits](https://docs.cohere.com/docs/rate-limits)。
- **限额**：所有端点合计 **1000 次/月**；Chat 20 RPM；Rerank 10 RPM；Embed 2000 inputs/min。来源：[官方 rate limits](https://docs.cohere.com/docs/rate-limits)。
- **OpenAI 兼容**：**不兼容**。端点 `https://api.cohere.com/v2/chat`，响应为 Cohere 自有结构（`message.content[0].text`、finish_reason 为 COMPLETE/MAX_TOKENS），需要适配层。来源：[ComparEdge 分析](https://comparedge.com/tools/cohere/api)。
- **条款**：trial key 明确禁止 production/commercial 使用；[wotai 排名](https://wotai.co/blog/best-free-llm-apis)指出其免费条款甚至禁止 "personal, family, or household purposes"（Tier 4 skip）。
- **判断**：不推荐加入巡检。额度按月且小、API 不兼容需写适配器、条款最严。价值密度低于其他选项。

### 9. GitHub Models —— 已死，排除

- **2026-06-16 停止新客户，2026-07-30 全线退役**（playground、catalog、inference API、BYOK 全部下线，含存量客户）。来源：[GitHub Changelog 7-30](https://github.blog/changelog/2026-07-30-github-models-is-now-retired/)、[7-01 公告](https://github.blog/changelog/2026-07-01-github-models-is-being-fully-retired-on-july-30-2026/)。
- **实测（2026-09-20）**：`POST https://models.github.ai/inference/chat/completions` 返回 **HTTP 410 Gone**。
- **判断**：不加入。官方推荐的替代是 Microsoft Foundry（需 Azure 订阅）或 Copilot（非通用 API）。

### 10. Hugging Face Inference Providers —— 不推荐（额度太小）

- 免费账号每月仅 **$0.10 额度**（按 partner 定价消耗，约够 3.8 万～59 万输出 token，看模型）。PRO（$9/月）含 $2。来源：[官方定价文档](https://huggingface.co/docs/inference-providers/main/en/pricing)。
- **OpenAI 兼容 base_url**：`https://router.huggingface.co/v1`（chat 专用，server 端自动选最快 provider），HF token 鉴权。来源：[官方文档](https://huggingface.co/docs/inference-providers/main/en/index)。
- **判断**：不值得作为巡检目标——$0.10/月 连每日一次的持续测速都撑不了几个月，且用完即 402。除非未来额度政策变化。

### 11. SiliconFlow 硅基流动 —— 可选（国内备选）

- **真免费**：注册（+86 手机号或国际站邮箱）无需付费；使用全部免费模型需实名认证。新用户赠金中国站 ¥14-16 / 国际站 $1（2026-06 公告）。来源：[getmodelkey 教程](https://www.getmodelkey.com/zh/guides/how-to-get-silicon-flow-api-key/)、[yangmao.ai](https://yangmao.ai/zh/providers/siliconflow/)。
- **免费模型**：小模型永久免费（Qwen3-8B、Qwen2.5-7B、GLM-4-9B 等 14 个左右），限速内免费。来源：[官方免费模型列表](https://docs.siliconflow.com/quickstart/models)。
- **OpenAI 兼容 base_url**：`https://api.siliconflow.cn/v1`（国际站 `https://api.siliconflow.com/v1`）。来源：[官方 Quick Start](https://docs.siliconflow.com/en/userguide/quickstart)。
- **判断**：可选。免费模型偏小（8B 级），测速参考价值一般；但国内直连 + 免费小模型适合做「延迟基线」监控项。优先级低于 ModelScope。

### 12. Alibaba Cloud Model Studio（国际站，DashScope）—— 不推荐（一次性额度）

- 新用户激活（新加坡区域）每模型赠 1M tokens，**90 天有效，一次性**，无需卡。OpenAI 兼容 base_url `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`。来源：[官方免费额度文档](https://docs.modelstudio.console.alibabacloud.com/en/model-studio/new-free-quota)、[aicreditmart 指南](https://aicreditmart.com/ai-credits-providers/alibaba-cloud-model-studio-free-token-quota-guide-2026/)。
- **判断**：不推荐。90 天过期的一次性额度不适合长期巡检；且额度用尽/过期后行为依赖账户状态（未补全账户信息会直接报错）。若要测 Qwen 官方 API，走 ModelScope 更稳。

### 13. 其他低优先级/匿名选项（简要）

- **OVHcloud AI Endpoints**：匿名访问约 2 请求/分钟/模型，无需注册，OpenAI 兼容（`https://oai.endpoints.ai.cloud.ovh.net/v1`）。可用但限额极低。来源：[wotai](https://wotai.co/blog/best-free-llm-apis)、[freellm.net](https://freellm.net/providers/)。
- **Ollama Cloud**：免费云推理（GLM-4.7、Kimi K2、gpt-oss、Qwen3 等），限 1 并发、5 小时会话上限。来源：[wotai](https://wotai.co/blog/best-free-llm-apis)、[freellm.net](https://freellm.net/providers/)。细节本次未深挖，如需要可补查。
- **LLM7.io / Pollinations**：完全匿名免费（GPT-OSS 20B、Llama 3.1 等），无需任何 key，但质量/稳定性差，仅适合当「无门槛探活点」。来源：[wotai](https://wotai.co/blog/best-free-llm-apis)。
- **已确认 2026 年转为付费/绑卡的**（不浪费精力）：Cerebras（7/16 起 $5 试用需绑卡）、Together（$5 最低充值）、SambaNova（新账号不再送额度）、Fireworks（$1 一次性试用）、Scaleway（需卡）、Nebius（$1 需卡）、Vercel AI Gateway（需绑卡）。来源：[klymentiev 变更时间线](https://klymentiev.com/blog/free-llm-api)。

---

## 二、对 token-speed 的实施相关提示

1. **已覆盖四家的最新变化（顺带核实）**：
   - **Groq 免费层 2026-08-16 起移除了 Llama 3.3 70B / 3.1 8B**（转 enterprise-only），现为 gpt-oss-120b/20b、qwen3.6/3.8-27b、gpt-oss-safeguard-20b 等：30 RPM / 1K RPD / 8K TPM / 200K TPD（每模型）。若巡检配置里还挂着 Llama 模型 ID 需要换。来源：[Groq 官方 rate limits](https://console.groq.com/docs/rate-limits)、[klymentiev](https://klymentiev.com/blog/free-llm-api)、[dev.to 提醒](https://dev.to/build996/groqs-14400-requests-a-day-is-not-for-the-chat-models-1m12)。
   - **OpenCode Zen** 被第三方描述为 "promo, can change" 的匿名访问（DeepSeek V4 Flash、Nemotron），与已知一致。来源：[wotai](https://wotai.co/blog/best-free-llm-apis)。
2. **配置形态差异**，token-speed 的 provider 模型需要支持：
   - base_url 内嵌变量（Cloudflare 的 account_id）；
   - api_key 可留空/匿名（Kilo、OpenCode Zen、ModelScope 匿名探活）；
   - 模型 ID 带 org 前缀（ModelScope、OpenRouter、SiliconFlow）vs 裸名（bigmodel、Z.ai、Mistral）。
3. **国内直连 vs 需代理**（本地 App 场景）：直连可用：bigmodel.cn、ModelScope、SiliconFlow。需代理：Cloudflare、Z.ai（api.z.ai）、OpenRouter、Kilo、Mistral、HF、NVIDIA、Groq。GH Actions 巡检版跑在 Azure，全部无障碍。
4. **免费层 churn 风险**：2026 年内 GitHub Models 死亡、Cerebras/Together 转付费、Groq 砍模型、OpenRouter 免费阵容全换血。巡检配置里的模型 ID 应视为易变项，看板最好能显式暴露「模型不可用（404/410）」与「限流（429）」的区别。

## 三、主要来源索引

- Cloudflare：[定价](https://developers.cloudflare.com/workers-ai/platform/pricing/) / [OpenAI 兼容](https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/) / [Limits](https://developers.cloudflare.com/workers-ai/platform/limits/) / [Changelog](https://developers.cloudflare.com/changelog/product/workers-ai/)
- Z.ai：[官方 OpenAI 兼容文档](https://docs.z.ai/guides/develop/openai/python) / [layer3labs 定价核查](https://www.layer3labs.io/guides/z-ai-pricing) / [toolfreebie](https://toolfreebie.com/glm-free-api/) / [baeseokjae 指南](https://baeseokjae.github.io/posts/z-ai-api-developer-guide-2026/)
- bigmodel.cn：[OpenAI 兼容](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction) / [免费模型](https://docs.bigmodel.cn/cn/guide/models/free/glm-4-flash-250414) / [ChooseAI](https://www.chooseai.net/news/6812/) / [TheRouter](https://therouter.ai/zh/blog/zhipu-glm-api-complete-guide/)
- OpenRouter：[FAQ](https://openrouter.ai/docs/faq) / [Limits](https://openrouter.ai/docs/api_reference/limits) / [免费模型集合](https://openrouter.ai/collections/free-models) / [costgoat 快照](https://costgoat.com/pricing/openrouter-free-models)
- Kilo：[Authentication（匿名访问）](https://kilo.ai/docs/gateway/authentication) / [Models & Providers](https://kilo.ai/docs/gateway/models-and-providers)
- ModelScope：[官方公告（阿里云开发者社区）](https://developer.aliyun.com/article/1651776) / [faxai 详解](https://www.faxai.cn/archives/1779) / [ARIS 指南](https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep/blob/main/docs/MODELSCOPE_GUIDE.md) / [freellmapihub](https://freellmapihub.com/p/modelscope)
- Mistral：[激活与 API key](https://docs.mistral.ai/getting-started/quickstarts/studio/activate-and-generate-api-key) / [rate limits 帮助](https://help.mistral.ai/en/articles/698531-why-am-i-hitting-api-rate-limits-and-how-do-i-increase-them) / [usage-limits 文档](https://docs.mistral.ai/admin/billing-usage/usage-limits)
- Cohere：[rate limits](https://docs.cohere.com/docs/rate-limits) / [定价 FAQ](https://cohere.com/pricing) / [going-live](https://docs.cohere.com/docs/going-live)
- GitHub Models：[退役公告](https://github.blog/changelog/2026-07-30-github-models-is-now-retired/) / [时间线](https://github.blog/changelog/2026-07-01-github-models-is-being-fully-retired-on-july-30-2026/)
- Hugging Face：[Inference Providers 定价](https://huggingface.co/docs/inference-providers/main/en/pricing) / [概览](https://huggingface.co/docs/inference-providers/main/en/index)
- SiliconFlow：[Quick Start](https://docs.siliconflow.com/en/userguide/quickstart) / [免费模型列表](https://docs.siliconflow.com/quickstart/models) / [getmodelkey 教程](https://www.getmodelkey.com/zh/guides/how-to-get-silicon-flow-api-key/)
- Alibaba Model Studio：[免费额度](https://docs.modelstudio.console.alibabacloud.com/en/model-studio/new-free-quota) / [定价](https://www.alibabacloud.com/help/en/model-studio/model-pricing)
- 横向对比（2026-09 核查）：[klymentiev.com — 17 家对比](https://klymentiev.com/blog/free-llm-api)、[wotai.co — live-probed 排名](https://wotai.co/blog/best-free-llm-apis)、[freellm.net 提供方目录](https://freellm.net/providers/)
- Groq 现状：[官方 rate limits](https://console.groq.com/docs/rate-limits)
