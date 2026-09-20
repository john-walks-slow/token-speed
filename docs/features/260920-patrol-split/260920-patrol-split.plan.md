# 拆分计划：token-speed-patrol 独立仓库（260920）

> 调研依据：[260920-codebase.research.md](./260920-codebase.research.md)

## 目标与用户路径

**目标**：把巡检（GH Actions 定时测速 + 静态看板）拆成独立公开仓库 `john-walks-slow/token-speed-patrol`，供他人 fork 自用；老仓库 `token-speed` 回归纯桌面版。自己正在跑的巡检完整迁移到新仓库。

**用户路径**（新仓库的访客视角）：

1. Fork `token-speed-patrol` → Actions 默认禁用，进入 Settings → Actions → Enable。
2. 按 README：改名 `config/patrol.json.example` → `patrol.json`（或保持仓库自带 example 改字段），配 secrets（`*_API_KEY`）。
3. 手动触发 Patrol workflow（workflow_dispatch）验证，之后每 6h cron 自动跑。
4. Settings → Pages → deploy from branch (gh-pages) 或保持 workflow 部署，看板上线。
5. 改 `patrol.json` 增删 targets（支持 `$ENV` 引用私有端点、discover、whitelist/blacklist）。

**老仓库路径**：删除 patrol/website 相关文件，README 删巡逻章，桌面版功能不受影响；`speed_test.py` 完成同样的 core 解耦改造（去掉 `network_settings` import），改为依赖注入。

## 架构设计

### 新仓库结构

```
token-speed-patrol/
├── backend/
│   ├── __init__.py
│   ├── speed_test.py        # core：与桌面版同构，import 路径保持 backend.* 不变
│   ├── rate_limit.py
│   ├── url_utils.py
│   ├── patrol_config.py
│   ├── patrol_runner.py
│   └── test_patrol.py
├── website/
│   ├── index.html           # 看板（仓库 URL 已替换为新仓库）
│   └── data/                # JSONL 巡检结果（含拷贝的 2026-09-20.jsonl 起步数据）
├── config/patrol.json.example
├── .github/workflows/
│   ├── patrol.yml           # cron 每 6h + 手动触发；secret 名与 example 的 api_key_env 对应
│   └── deploy-website.yml   # Pages 部署 + workflow_run 联动
├── requirements.txt         # httpx==0.27.0（dev: pytest）
├── README.md                # 主 README 即 fork 自用指南（含截图）
├── LICENSE                  # MIT
└── AGENTS.md                # 精简版项目指引
```

### 关键决策

1. **core 解耦（核心改造，两仓库同步做）**：`speed_test.py` 删除 `from .network_settings import client_kwargs`。改为：
   - `run_speed_test` / `list_models` / `execute_batch_tests` 增加可选参数 `client_kwargs: dict | None = None`；
   - core 内默认值 `{"trust_env": True}`（等价于原 `network_settings` 的默认行为：跟随环境代理、系统 TLS 校验——proxy=None 时 httpx 默认读环境变量，verify 默认 True，故显式只传 `trust_env: True` 即可）；
   - 桌面版 `main.py` / `scheduler.py` 在调用处传 `client_kwargs=net_client_kwargs()`（从 `network_settings` 拿，依赖方向反转：adapter → core，core 不再反向依赖桌面层）。
   - 三处 `httpx.AsyncClient(..., **net_client_kwargs())` 调用点改为使用参数。
2. **包结构不变**：新仓库保持 `backend/` 包名与相对 import（`from .patrol_config import ...`），`python -m backend.patrol_runner` 用法原样保留，test_patrol.py 零改动。不搞 `patrol/` 顶层包重命名——纯粹改名没有收益还破坏两个仓库的同步性。
3. **同步策略**：core 四文件（speed_test/rate_limit/url_utils/patrol_config）+ patrol_runner + test_patrol 纯拷贝、字节一致。两个 AGENTS.md 与 README 各记一行"改动 core 需手动同步另一仓库"。不引入 submodule / 同步脚本（单人项目，改动频率低）。
4. **数据连续性**：新仓库 `website/data/` 拷入现有 `2026-09-20.jsonl`；老仓库删除 `website/data/*.jsonl` 历史数据（数据语义属于巡检，跟新仓库走）。看板按文件名日期聚合，无需迁移脚本。
5. **老仓库保留桌面侧调度**：`scheduler.py`（本地定时测速，写 SQLite）是桌面版功能，不是巡检，保留不动。

## 实施步骤

### Phase A：core 解耦（老仓库，先行）

1. `speed_test.py`：删 `network_settings` import；三处调用点改用 `client_kwargs` 参数（默认 `{"trust_env": True}`）；`run_speed_test` 签名加参并透传。
2. `main.py`、`scheduler.py`：调用处传 `client_kwargs=net_client_kwargs()`。
3. 补/改测试：`test_speed_test.py` 断言 client_kwargs 注入生效（如 monkeypatch httpx.AsyncClient 捕获参数）。
4. 跑 `python -m pytest backend/ -q` 全绿。

### Phase B：创建新仓库

1. `gh repo create john-walks-slow/token-speed-patrol --public`（clone 到 `/root/projects/token-speed-patrol`）。
2. 拷入文件（见结构图）：backend 六文件（含解耦后的 speed_test.py）、config/patrol.json.example、两个 workflow、website/index.html + data/README.md、LICENSE。
3. 拷入起步数据 `website/data/2026-09-20.jsonl`。
4. 替换 `website/index.html` 中 4 处 `john-walks-slow/token-speed` → `john-walks-slow/token-speed-patrol`；"桌面版" footer 链接保留指向老仓库（引流）。
5. 新写 README（fork 自用指南：fork → enable Actions → 配 secrets → 改 patrol.json → 触发验证 → 开 Pages），头图复用 `docs/features/260918-ui-polish/patrol-dashboard.png`。
6. `requirements.txt`：`httpx==0.27.0`；dev 依赖 pytest。
7. AGENTS.md 精简版：地图、测试命令（`python -m pytest backend/ -q`）、core 同步提醒、usage 口径规范（从老 AGENTS.md 摘 patrol 相关条目）。
8. `patrol.yml` 步骤改为 `pip install -r requirements.txt`（替代裸 httpx）；workflow 名称保持 "Token Speed Patrol"（deploy-website 的 workflow_run 过滤依赖此名）。
9. 迁移 secrets：`gh secret set` 把 GROQ/NVIDIA/GEMINI/CLOUDFLARE/OPENROUTER/MODELSCOPE 六个 `*_API_KEY` 与 `PATROL_EXTRA_ENV` 从老仓库读出写入新仓库（`gh secret list`/`gh run` 不可读 secret 值 → 需要用户提供或从本地配置恢复；若无法读取，提示用户手动在 GitHub 网页配置）。
10. 提交并 push（首个 commit：init）。

### Phase C：新仓库上线验证

1. `gh workflow run patrol.yml` 手动触发一次（用 dispatch 空 providers 全量跑）。
2. 观察 run 成功、`website/data/` 产生新 JSONL commit、deploy-website 被 workflow_run 联动触发。
3. 确认 Pages 可访问、看板显示数据（老数据 + 新数据）。
4. e2e 记录写入 `docs/features/260920-patrol-split/260920-patrol-split.e2e.md`。

### Phase D：老仓库清退

1. 删除：`backend/patrol_runner.py`、`backend/patrol_config.py`、`backend/test_patrol.py`、`website/`（整目录）、`config/patrol.json` + example、`.github/workflows/patrol.yml`、`.github/workflows/deploy-website.yml`。
2. README：删"一、GitHub Actions 巡逻版"章，目录结构表删 patrol 条目，顶部加一行指向新仓库的链接。
3. AGENTS.md：删 patrol 相关条目（地图、规范中 sink/JSONL 条目改写为仅桌面语境）。
4. `.gitignore` 增加本地 `config/patrol.json`（若用户本地仍需临时跑）——不保留则无需。
5. 跑全量测试 `python -m pytest backend/ -q` 全绿；提交。

### 收尾

- `docs/features/260920-patrol-split/260920-patrol-split.summary.md` 记录拆分结果与新仓库链接。
- 老 README 头图（patrol-dashboard.png）若被删章节引用则一并处理。

## 风险与备注

- **secrets 无法程序化读取**（GitHub 设计如此）。Phase B 第 9 步若拿不到值，需用户在网页端手动配置六个 `*_API_KEY`——提前在实施时告知。
- **Pages 首次开启**需要用户在 fork/新仓库 Settings 里选一次 Source（若 deploy-website.yml 用 actions/deploy-pages 则无需，workflow 已带 permissions，首次 run 自动创建）。实测确认。
- **example 与 test_patrol.py 联动**：`test_load_patrol_config_example` 硬编码断言 example 内容；example 原样拷贝则不碎，后续改 example 时须同步改测试。
- **patrol.json 不带入新仓库**（含 Cloudflare account id 真实值）；自己用的配置留在老仓库本地（untracked）或仅存于新仓库 secrets + 本地。
- workflow_run 联动依赖 patrol.yml 的 `name:` 字段精确匹配 "Token Speed Patrol"，改名会断链。

## 待用户确认点

1. 新仓库 Description 建议：`LLM API 定时巡检 + 静态看板（GitHub Actions 免服务器）· fork 自用`。
2. 老仓库 README 顶部放一行 "🎁 巡检看板版已独立：token-speed-patrol" 引流，可接受？
