# 检视报告 — patrol 拆分（260920-patrol-split）

## 概要

检视范围：老仓库 core 解耦改动（git diff，未提交）、patrol/website 清退、新仓库 token-speed-patrol 全量（4 commits）。整体设计合理：core 层依赖注入干净，两仓库 core 文件字节级一致（speed_test.py 已 cmp 验证），workflow/Pages 链路实测可用。但新仓库 **secrets 未配置**，最近一次巡检 21 个目标全部 401 失败且失败数据已入库，"巡检完整迁移"的目标实际未达成。

## 需求对齐

- core 解耦：与计划一致。`DEFAULT_CLIENT_KWARGS = {"trust_env": True}` 与原 `network_settings` 默认（system 模式返回 `{proxy: None, verify: True, trust_env: True}`）等价：httpx 默认 verify=True、proxy 显式 None 与缺省行为相同，trust_env=True 均读环境代理。桌面版 main.py 三个调用点 + scheduler.py 均已注入 `net_client_kwargs()`，行为向后兼容。
- 同源核验：speed_test/rate_limit/url_utils/patrol_config/patrol_runner/test_patrol 新旧字节一致（cmp/git show diff 通过）。
- 老仓库清退：文件删除、README/AGENTS 重写符合计划；docs/assets/stats.png 引用存在。
- 偏离点：① 计划 Phase B 第 9 步（迁移 secrets）未完成——新仓库 `actions/secrets` 返回 `{"total_count":0}`；② 计划明确 "patrol.json 不带入新仓库"，实际已提交（config/patrol.json 与 example 逐字节一致，无密钥，可接受，但与计划文档不符）；③ 内置目标从 6 个缩为 4 个（去掉 Cloudflare、ModelScope），README 未同步。

## 阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| B1 | 新仓库 GitHub Settings（secrets） | 六个 `*_API_KEY` 与 `PATROL_EXTRA_ENV` 均未配置。最近一次 patrol run（35510341532）产出 `status: failed, success: 0/21`，全部 `HTTP 401: Invalid API Key`，且该失败行已 commit 进 `website/data/2026-09-20.jsonl` 并发布上线。当前每 6h cron 会持续往公开看板写入全失败数据，"自己正在跑的巡检完整迁移"未达成。 | 按计划 Phase B 第 9 步：在网页端把六个 `*_API_KEY` 与 `PATROL_EXTRA_ENV` 配置到新仓库 secrets（程序化不可读，需手动）；配置后手动 dispatch 一次验证 success>0；删除 `website/data/2026-09-20.jsonl` 中 12:20:50 那行全失败数据（或保留作为失败记录，二选一，但要明确）。 |

## 建议修改

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| S1 | 新仓库 README.md「内置免费巡逻目标」表格（~L28-45） | 表格列 6 个 provider（含 Cloudflare、ModelScope），但 `config/patrol.json`/example 只有 4 个 target。fork 用户按 README 配了 `CLOUDFLARE_API_KEY`/`MODELSCOPE_API_KEY` 却无任何 target 消费，产生困惑；Cloudflare 还需拼 account id 的 base_url，README 未提示。 | 表格只保留 4 个内置 target 对应的 secrets，将 Cloudflare/ModelScope 移到「自定义巡逻目标」小节并说明需自建 target（Cloudflare base_url 含 account id，建议走 `$ENV` 引用）。 |
| S2 | 新仓库 README.md 快速开始第 4 步（~L13） | "重命名配置：`config/patrol.json.example` → `config/patrol.json`" 与现状矛盾：patrol.json 已存在且已提交，rename 会因目标已存在而失败/困惑。 | 改为「直接编辑 `config/patrol.json`」（example 仅作字段参考），或明确说明两者当前一致、改 patrol.json 即可。 |
| S3 | 新仓库 `website/data/2026-09-20.jsonl` | 拷入的历史数据含 Cloudflare 真实 account id（`accounts/5b393025ed97484019c46b8136af3aa5`）。计划因"含 account id 真实值"特意不带 patrol.json，却经数据文件带入了，标准不一致。account id 非密钥（需配 token 才可用），风险低但已永久进入公开 git 历史。 | 用 sed 将该 JSONL 中的 account id 替换为占位（如 `YOUR_ACCOUNT_ID`）后 amend/提交；或明确接受（在 docs 记录该决策）。 |
| S4 | 老仓库工作区（staged 删除 + 未提交修改） | 老 HEAD 仍含 patrol.yml（每 6h cron）与 deploy-website.yml，未提交前老仓库 cron 持续跑旧配置（含 Cloudflare 真实 account id）并往已从工作区删除的 `website/data/` commit，拖长双跑窗口、增加后续合并冲突面。 | 尽快完成老仓库本次 commit 并 push，终止旧 cron。 |
| S5 | 老仓库 `backend/test_network_settings.py` / test_speed_test.py | 缺「不传 client_kwargs 时 core 走 DEFAULT_CLIENT_KWARGS」的回归断言（现有测试均显式传参）。若未来有人改坏默认值，测试不会红。 | 补一条：monkeypatch 捕获 `httpx.AsyncClient` 参数，断言默认调用含 `trust_env=True`（计划 Phase A 第 3 步本意即此）。 |
| S6 | 新仓库 `backend/patrol_runner.py:40` | discover 拉模型列表的 `httpx.AsyncClient(timeout=timeout, headers=...)` 未走 core 的 client_kwargs 约定（无 trust_env，虽然 httpx 默认 trust_env=True 行为恰好一致）。与 core 三处调用点风格不统一。 | 统一为 `**DEFAULT_CLIENT_KWARGS`（或从 speed_test import），保持仓库内网络参数口径一致。 |

## 非阻塞问题

| ID | 位置 | 问题 | 建议 |
| --- | ---- | ---- | ---- |
| N1 | 老仓库 `backend/speed_test.py:15` | `DEFAULT_CLIENT_KWARGS` 为模块级可变 dict，且 `**(client_kwargs or DEFAULT_CLIENT_KWARGS)` 对空 dict 会静默回退默认值——传 `{}` 与传 None 语义混同。当前无实际风险（无人传空 dict），且该文件跨仓库同步，改动成本大于收益。 | 记录备忘即可；若未来 core 重构，可改为 `if client_kwargs is None` 判空。 |
| N2 | 新仓库 `requirements-dev.txt` | pytest 未固定版本（老仓库钉 `pytest==9.0.3`），两仓库测试环境可能漂移。 | 可选：钉同一版本，随 core 同步策略一起维护。 |
| N3 | 老仓库 GitHub secrets | 六个 `*_API_KEY` 仍留在老仓库，而老仓库已无任何 workflow 消费它们。 | 后续清理（`gh secret delete`），或留作本地临时跑 patrol 用——用户定夺。 |
| N4 | 新仓库 AGENTS.md「规范」同步清单 | 同源文件清单列了 core 四文件，未列 `patrol_runner.py`/`test_patrol.py`（当前也是字节一致拷贝）。 | 可在同步清单补一句"patrol_runner/test_patrol 亦保持同源"，或明确 runner 属 adapter 不强制同步——两者皆可，但应写明。 |

## 准入结论

**结论**：`不准入`

**说明**：B1（新仓库 secrets 未配置、巡检实际全 401 且失败数据已公开入库）直接违背本次需求的核心目标"自己正在跑的巡检完整迁移到新仓库"，须配置 secrets、复跑验证并清理失败数据后重新检视。代码层面的解耦改造与两仓同步本身质量良好，无其他阻塞项。
