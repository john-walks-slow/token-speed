# Patrol 拆分代码调查报告（260920）

仓库：`/root/projects/token-speed`。目标：摸清 patrol 相关代码全貌与桌面版耦合点，为拆分独立仓库（GH Actions 定时测速 + 静态看板）做准备。

## 1. patrol 完整文件清单

### 1.1 核心 Python 文件（backend/）

| 文件 | 行数 | 角色 |
|---|---|---|
| `backend/patrol_runner.py` | 169 | GH Actions 巡检入口，`python -m backend.patrol_runner` |
| `backend/patrol_config.py` | 135 | 巡检配置数据类（PatrolConfig / PatrolTarget） |
| `backend/speed_test.py` | 520 | 测速内核（桌面版与巡检共用） |
| `backend/rate_limit.py` | 46 | 按分钟令牌桶限流，全局单例 `limiter` |
| `backend/url_utils.py` | 13 | `normalize_base_url`，纯函数无依赖 |
| `backend/network_settings.py` | 70 | **桌面专属**（SQLite settings 表，见 §2.2） |
| `backend/test_patrol.py` | 231 | patrol_config / patrol_runner 单测 |

**patrol_runner.py 内容摘要**：
- 依赖仅 `httpx` + `.patrol_config` + `.speed_test.execute_batch_tests`，**不 import database.py**。
- `discover_models(base_url, api_key, timeout, discover_url)`：拉上游模型列表，兼容 OpenAI `{data:[{id}]}` 与 Cloudflare `{result:[{id,name}]}` 两种形状（自带 httpx 调用，不走 speed_test.list_models）。
- `run_patrol(config_path, data_dir=DEFAULT_DATA_DIR, only_providers=None)`：加载配置 → discover → `cfg.to_tests(discovered)` → `execute_batch_tests(..., sink=json_sink)` → 逐条收集 → 私有端点 base_url 替换为 `"(private)"`（含 error_message 中的 URL 脱敏）→ 追加写 `website/data/YYYY-MM-DD.jsonl`（每行一个完整 run 记录：run_id/started_at/finished_at/status/total/success/failed/results）。
- `apply_extra_env(raw)`：解析多行 `KEY=VALUE` 注入 env（`setdefault`，真实环境变量优先）。
- `main()`：环境变量 `PATROL_CONFIG`（默认 `config/patrol.json`）、`PATROL_DATA_DIR`（默认 `website/data/`）、`PATROL_PROVIDERS`（逗号分隔白名单）、`PATROL_EXTRA_ENV`。

**patrol_config.py 内容摘要**：
- `@dataclass PatrolTarget`：provider_name / base_url / api_key_env / protocol("openai"|"anthropic") / models / discover / discover_url / whitelist / blacklist（regex，fullmatch，先 whitelist 后 blacklist）。
  - `resolve_api_key()` 从 env 读 key；`resolve_base_url()` 支持 `"$ENV"` / `"${ENV}"` 引用（即私有端点）；`is_private` = base_url 以 `$` 开头。
- `@dataclass PatrolConfig`：prompt / max_tokens / temperature / stream / concurrency / iterations / max_rpm / timeout / targets。
  - `to_tests(discovered)`：展开为 execute_batch_tests 所需 tests 列表（每 model 一条 dict，含 model/base_url/api_key/provider_id("")/provider_name/protocol），**api_key 在此解析为明文传入 core，不落盘**。
- `load_patrol_config(path)`：从 JSON 加载，字段一一对应 snake_case。
- 依赖仅标准库（os/re/json/dataclasses）。

### 1.2 speed_test.py 被巡检用到的部分

巡检只用到 `execute_batch_tests` 一个入口，其调用链：

- `execute_batch_tests(tests, prompt, max_tokens, temperature, stream, concurrency, iterations, schedule_id=None, max_rpm=-1, on_progress=None, sink=None, timeout=None) -> list[dict]`（L416）
  - 按 `(base_url, api_key)` 分桶，每桶一个 `Semaphore(concurrency)`；桶内按模型 round-robin × iterations 展开；`limiter.acquire(key, max_rpm)` 限流；异常以 `_batch_error_result` 兜底；结束后逐条调 `sink`。
  - → `run_speed_test(base_url, api_key, model, prompt, max_tokens, temperature, stream, provider_id, provider_name, protocol, timeout) -> dict`（L174）：openai 走 `{base}/chat/completions`（stream 时加 `stream_options.include_usage`），anthropic 走 `{base}/messages`（x-api-key + anthropic-version，不发 temperature）。返回 dict 字段：id/base_url/model/actual_model/provider_id/provider_name/response_content/prompt/max_tokens/temperature/ttft_ms/content_ttft_ms/total_latency_ms/tokens_generated/reasoning_tokens/content_tokens/input_tokens/thinking_ms/tps/itl_ms/success/error_message/created_at。
  - 辅助函数（巡检路径全部依赖）：`_reconcile_token_counts`、`_extract_reasoning_tokens`、`_extract_input_tokens`、`_raise_for_openai_error`、`_extract_stream_chunk`、`_compute_itl`、`_batch_error_result`。
  - **`list_models`（L131）巡检不用**（runner 自带 `discover_models`），仅桌面版 main.py 的 API 端点用。

### 1.3 speed_test.py 传递依赖链（逐个确认）

```
speed_test.py
 ├─ from .rate_limit import limiter          # 纯 asyncio，无外部依赖 ✅ 可带走
 ├─ from .network_settings import client_kwargs as net_client_kwargs  # ⚠️ 见 §2.2
 └─ from .url_utils import normalize_base_url # 纯 re，无依赖 ✅ 可带走

network_settings.py
 └─ from . import database                    # ⚠️ 桌面专属链

database.py
 ├─ from .paths import is_frozen, db_path     # 桌面专属（%APPDATA%/PyInstaller）
 └─ 标准库 sqlite3/threading/shutil/uuid/json
```

### 1.4 website/ 目录

| 文件 | 行数 | 说明 |
|---|---|---|
| `website/index.html` | 722 | 静态看板，纯 HTML+CSS+原生 JS，零依赖零构建 |
| `website/data/README.md` | 7 | 说明 JSONL 产出 |
| `website/data/2026-09-20.jsonl` | 17 行（886KB） | 巡检结果数据（git tracked） |

**对桌面版前端的引用**：无（`grep -ril patrol frontend/src` 为空；index.html 不加载任何 frontend/ 资源）。但 index.html 中硬编码了指向本仓库的链接，拆分时需处理：
- L185/L192/L242/L244：`https://github.com/john-walks-slow/token-speed`（brand、GitHub 按钮、footer 的 "GitHub"/"桌面版" 链接）
- L243：`.../token-speed/actions`
- L334 注释"与 StatsPanel 逻辑对齐"（仅注释，非代码依赖）

### 1.5 config/patrol.json.example 结构

顶层字段：`_comment`（说明 $ENV 引用与密钥不落盘）、`prompt`、`max_tokens`(256)、`temperature`(null)、`stream`(true)、`concurrency`(1)、`iterations`(1)、`max_rpm`(20)、`timeout`(300)、`targets[]`。

每个 target：`provider_name`、`base_url`、`api_key_env`、`protocol`、`models[]`、`discover`、`discover_url`、`whitelist[]`、`blacklist[]`。example 含 4 个 target：Groq（显式 models）、NVIDIA NIM（discover+blacklist）、Google Gemini（显式 models）、OpenRouter（discover+whitelist `.*:free`）。

实际 `config/patrol.json`（git tracked，本仓库自用）与 example 差异：多 Cloudflare Workers AI（含自定义 `discover_url`）与 ModelScope 两个 target、NVIDIA/OpenRouter blacklist 大幅扩充、timeout=120（example 为 300）。**patrol.json 含真实 provider 的 account id（Cloudflare URL 里的 account 路径），拆分时注意 example 化**。

### 1.6 GitHub workflows

`.github/workflows/patrol.yml`（57 行）：
- 触发：`schedule: cron '13 */6 * * *'`（每 6 小时，13 分错峰）+ `workflow_dispatch`（input `providers` 逗号分隔筛选）。
- `permissions: contents: write`（需提交结果）。
- 步骤：checkout → setup-python 3.12 → `pip install httpx==0.27.0`（**巡检唯一 pip 依赖**）→ Run patrol（env：GROQ/NVIDIA/GEMINI/CLOUDFLARE/OPENROUTER/MODELSCOPE 六个 `*_API_KEY` secrets、`PATROL_EXTRA_ENV`、`PATROL_PROVIDERS`；run `python -m backend.patrol_runner`）→ Commit patrol results（github-actions[bot] 提交 `website/data/`，`git pull --rebase` + 5 次重试防 master 前进导致 push 被拒）。

`.github/workflows/deploy-website.yml`（37 行）：
- 触发：push 到 master（paths: `website/**` 与本 workflow）+ **`workflow_run`（Token Speed Patrol completed）**（关键：patrol 结果由 GITHUB_TOKEN 推送不触发 push 事件，靠 workflow_run 联动重发布）+ workflow_dispatch。
- `permissions: pages: write, id-token: write`；concurrency group `pages`。
- 步骤：checkout → configure-pages → upload-pages-artifact(path: website) → deploy-pages。

`.github/workflows/release.yml` 无 patrol/website 内容（纯桌面版发布）。

### 1.7 backend/test_patrol.py

231 行、10 个测试，仅依赖 `pytest` + `.patrol_config` + monkeypatch 掉 `backend.patrol_runner.execute_batch_tests`（不触网）：
- `test_load_patrol_config_example`（断言 example 加载，注意硬编码断言了 example 的 4 个 target 名称/字段，example 改动会碎）
- `test_to_tests_expands_models` / `test_to_tests_with_discovered`
- `test_resolve_api_key_missing_returns_empty` / `test_resolve_base_url_from_env`
- `test_private_url_placeholder`（私有 URL 脱敏，含 error_message）
- `test_extra_env_parsing`
- `test_patrol_runner_writes_jsonl`（mock 后验证 JSONL 产出与不含 api_key）
- `test_filter_models_whitelist_blacklist` / `test_filter_models_blacklist_only_and_dedup`

### 1.8 build.py

**无任何 patrol 相关内容**。纯桌面版脚本：npm 前端构建 → PyInstaller（token-speed.spec）→ 可选 zip。token-speed.spec 亦无 patrol 引用。

## 2. 耦合点分析

### 2.1 patrol_runner 是否 import 桌面专属模块

**直接 import：无**。patrol_runner 仅 import `httpx`、`.patrol_config`、`.speed_test.execute_batch_tests`；patrol_config 仅标准库。

**间接 import：有，且必然发生**——`import backend.speed_test` 时模块级执行 `from .network_settings import client_kwargs`，而 network_settings 模块级 `from . import database`。即巡检进程启动即加载 database.py 与 paths.py。

### 2.2 database.py 链在巡检路径上是否真的被"触发"

分两层：
- **import 时副作用（真实发生）**：database.py 模块级执行 `DB_PATH = _resolve_db_path()`（paths.db_path，非 frozen 时为 `backend/speed_tests.db`）——只算路径，**不建连接、不建表**（`_get_conn` 才 lazy 建）。所以巡检在 CI 上 import 不会崩，但会在 backend/ 目录"沾"上对 speed_tests.db 路径的引用（不创建文件，因为连接从未打开）。
- **运行时调用（真实发生，一次）**：`speed_test.py` 的三处 `httpx.AsyncClient(..., **net_client_kwargs())`（L148/L256/L323，**每次构造 client 都调用**，run_speed_test 与 list_models 各自走）→ `network_settings.client_kwargs()` → `get_network_settings()` → 首次调用 `_load()` → `database._fetchall("SELECT key, value FROM settings")` → **此时才真正打开（不存在则创建）backend/speed_tests.db 并建全部表**。巡检第一次发请求即触发，查询失败无 try 兜底（sqlite 空表返回 0 行，正常返回 DEFAULTS，行为正确但产生了一个巡检仓库不该有的 DB 文件与逻辑）。
- **结论**：speed_test → network_settings → database 这条链在巡检运行路径上**确实会被触发**。拆分时需把 `client_kwargs` 改为可注入/可裁剪（如 speed_test 直接内联默认值 `{"proxy": None, "verify": True, "trust_env": True}`，或让巡检侧传 client_kwargs 参数），并删除 network_settings/database/paths import。

### 2.3 models.py、main.py 的 patrol API 端点

- `models.py`（227 行）：纯 pydantic 请求/响应模型，**无任何 patrol 内容**。
- `main.py`（545 行）：**无 patrol 端点**。与巡检共用的只有 import `list_models, run_speed_test`（`/api/models/list` 等桌面端点）。桌面侧定时调度在 `scheduler.py`（L132 调 `execute_batch_tests`），与 patrol 平行、互不引用。
- 巡检完全无 FastAPI 依赖（workflow 只装 httpx）。

## 3. 看板数据加载逻辑

全部在 `website/index.html` 内嵌 `<script>`（无独立 JS 文件）：
- `discoverJsonlFiles()`（L312）：Pages 无目录列举 → 生成**今天起往前 90 天**的 `data/YYYY-MM-DD.jsonl` 文件名，逐个 `fetch(HEAD)` 探测存在性。
- `loadAllData()`（L291）：对存在的文件 `fetch(f + '?t=' + Date.now())`（cache-bust），按行 `JSON.parse`（每行一个 run），按 `started_at` 升序。
- 聚合：`runToPoints()` 按 `provider|model` 对取 median（tps/itl/ttft/latency）+ 成功率；provider 取 `provider_name`，缺失回退 base_url hostname。时间范围 chips：latest/24h/7d/all；provider chips 筛选；行内 canvas sparkline（Catmull-Rom 平滑）+ hover tooltip。

## 4. 仓库根目录 patrol 杂项

- **README.md**：`## 一、GitHub Actions 巡逻版（免服务器）`（L25-84，Fork 配置/secrets/workflow/自定义目标整章）+ `## 目录结构` 中 backend/config/.github 各文件的 patrol 条目（L149-160）+ 头图引用 `docs/features/260918-ui-polish/patrol-dashboard.png`。拆分后此章应移入新仓库主 README。
- **AGENTS.md**：L15-22 列出 patrol_config/patrol_runner/patrol.json.example/patrol.yml 的条目说明。
- **LICENSE**：MIT，Copyright (c) 2026 john-walks-slow（可随拆分复制）。
- **.gitignore**：无 patrol 专属条目；注意 `*.db` 已忽略（backend/speed_tests.db 不会误提交），`website/data/*.jsonl` 目前是**被 git 跟踪的**（巡检结果需提交，不能 ignore）。
- **docs/**：`docs/handoffs/260920-github-workflow-patrol.handoff.md`（104 行，patrol 交接文档）、`docs/features/260910-website/`（看板功能文档）、`docs/features/260918-ui-polish/patrol-dashboard.png`（README 头图）。
- **backend/requirements.txt**：全量桌面依赖（fastapi/uvicorn/pywebview/pystray/pyinstaller 等）；巡检实际只需 `httpx==0.27.0` + `pytest`（跑 test_patrol）。
- **backend/__init__.py**：空文件（包标记，拆分后可保留 `python -m backend.patrol_runner` 用法或改顶层包名）。
- `scripts/make_icon.py`、`icon.ico`、`frontend/`、`token-speed.spec`：纯桌面版，与 patrol 无关。

## 5. 拆分所需最小文件集（结论）

- 原样带走：`patrol_runner.py`、`patrol_config.py`、`speed_test.py`、`rate_limit.py`、`url_utils.py`、`test_patrol.py`（其相对 import `from .patrol_config ...` 需包结构保留）、`config/patrol.json.example`、`.github/workflows/patrol.yml`、`.github/workflows/deploy-website.yml`、`website/index.html`、`website/data/README.md`、LICENSE。
- 必须改造：`speed_test.py` 去掉 `network_settings` import（三处 `net_client_kwargs()` 内联默认或参数化），即可彻底切断 database.py/paths.py。
- 需脱敏替换：`website/index.html` 中 4 处硬编码仓库 URL；`config/patrol.json` 不带走（Cloudflare URL 含真实 account id）。
- 需同步：README 巡逻章、AGENTS.md 条目、独立 requirements（httpx + pytest）。
