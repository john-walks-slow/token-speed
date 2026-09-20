# Handoff: GitHub Workflow 巡检版方案讨论（未立项，进行中）

日期：2026-09-20
状态：**讨论/方案设计阶段，未进入实施**。最后停在等待用户对产品定位的拍板。
受众：接手继续推进此需求的 agent。

## 需求背景

用户希望为本项目增加「基于 GitHub Workflow 定期巡检 + 静态部署」的版本。讨论从「和现有本地定时巡检有什么区别」开始，演进出了一套「一套测速内核、两种部署外壳」的架构方案（经 expert 子代理深度设计），但**尚未出正式 plan，未写任何代码**。

## 会话中已确认的关键结论

### 1. 两种部署的本质区别（测量视角不同）

| | 本地 App（现有） | GH Workflow 巡检版 |
|---|---|---|
| 运行位置 | 用户机器（真实网络路径） | Azure 数据中心（中立视角，无墙无代理） |
| 有后端进程 | 有，FastAPI 常驻 | **无**，cron 触发跑完即退出 |
| 数据存储 | SQLite | JSON 文件 commit 进仓库 |
| 调度 | 事件循环内 30s 轮询（准点） | GH cron（不准时，错开整点可缓解） |
| 前端 | React 完整交互（CRUD/手动测速） | 静态只读看板 |
| 可用性 | 依赖进程存活 | 7×24 独立运行 |

**结论：fork 版是纯静态、无后端的 read-only 巡检看板，与桌面版是两个产品形态，不是同一套东西部署两次。** 两者共享的只有测速内核（约 50-100 行核心逻辑），配置/存储/调度/UI 全部独立。

### 2. 测速内核必须共享（口径一致性的来源）

`backend/speed_test.py` 中的核心函数，GH 版直接复用：
- `run_speed_test()` — 单次测速（流式/非流式、OpenAI/Anthropic 协议）
- `execute_batch_tests()` — 批量 + 并发 + 限速
- `_reconcile_token_counts()` — usage 口径统一（项目核心价值，见 AGENTS.md 规范）

### 3. 「狗皮膏药」风险的根源与解法（expert 方案核心判断）

根源不在「两种部署」，而在 **core 层知道了数据去向**。

唯一耦合点：`backend/speed_test.py:462-463`，`execute_batch_tests` 末尾硬编码 `for r in results: await insert_speed_test(r, schedule_id)`。

**解法：sink callback 注入。** 给 `execute_batch_tests` 加可选参数 `sink: Callable[[dict], Awaitable[None]] | None`，移除内部直接调 `insert_speed_test`：
- 本地 adapter（`scheduler.py:128`、`main.py` batch 端点）：传 `sqlite_sink` 闭包，行为与现状等价
- 巡检 adapter（`patrol_runner.py`）：传 `json_sink`，收集后写 JSON

不加 `if sink=='json'` 分支、不拆 core/runner 两层包。改动 = 一个参数 + 两处调用点各加一行，向后兼容。**这一步是整个架构正交性的支点，不可跳过。**

### 4. 配置：同构不同源（不强行统一成一份文件）

- 定义 `PatrolConfig` 数据结构（core 层契约，纯 dataclass + 校验，新文件 `backend/patrol_config.py`）
- GH 侧：`config/patrol.json` 静态文件 + GH Secrets 注入密钥（配置只存 `api_key_env` 环境变量名，不存明文）
- 本地侧：从 SQLite providers/schedules 组装同构结构（`scheduler.py:98-111` 已在做，只需结构对齐）
- 不写「patrol.json → SQLite 导入器」，本地 App 的 SQLite 是 source of truth

### 5. 数据：两套独立，不合并视图（反直觉但 canonical）

**不加 `source` 列。** 理由：
- 本地数据含隐私（api_key 关联的 provider 实体）、含试错单测；巡检数据是公开脱敏基线
- 合并会让 `StatsPanel` 过滤状态空间爆炸（已有解析/输入双口径，再加 source 维度交互面失控）
- 每处查询都要带 source 过滤才是真狗皮膏药

巡检 JSON 结构与 `models.py` 的 `SpeedTestResult` 保持同构，额外加 `run_id`、`patrol_config_hash` 两个 adapter 独有字段（sink 层追加，不污染 core 返回结构）。

## Expert 方案中的待修正点（我发现的 bug）

Expert 建议 `website/patrol.html` 通过相对路径 fetch `../../data/patrol-results/*.json` —— **不可行**。现有 `deploy-website.yml` 用 `upload-pages-artifact path: website`，只发布 `website/` 目录，`data/` 不在 Pages 站点内。

两个修法（讨论倾向 A）：
- **A. 数据放 `website/patrol/data/` 子目录**，随 Pages 一起发布。简单，代价是每次 patrol commit 会触发 deploy-website 重建（低频可接受）
- **B. 巡检数据单独发一个 Pages site**。更干净但维护两个站点

## Expert 方案的其他要点（备查）

- **workflow**：`.github/workflows/patrol.yml`，`cron: '13 */6 * * *'`（每 6h，13 分错开整点）+ `workflow_dispatch`；`permissions: contents: write`；用 github-actions[bot] commit 数据
- **60 天停用问题**：每次 patrol 成功 commit 本身就重置了 GitHub 的 scheduled-workflow 不活动计时器，天然 keepalive，无需额外 workflow
- **仓库建议 public**（Actions 免费无限额；private 有分钟数额度限制）
- **入口**：`python -m backend.patrol_runner`（不依赖 FastAPI 事件循环，`asyncio.run` 包一层即可），不放 `scripts/`
- **目录规划**：
  - CORE（共用）：`speed_test.py`（改 sink）、`rate_limit.py`、`url_utils.py`、`network_settings.py`、`patrol_config.py`（新）
  - LOCAL adapter：`scheduler.py`（传 sink）、`main.py`（传 sink）、`database.py`、`paths.py`
  - PATROL adapter（新）：`patrol_runner.py`、`config/patrol.json`、`patrol.yml`、`website/patrol.html`、`website/patrol/data/`
- **渐进落地 4 步**：① sink 解耦（pytest 全绿，行为等价）→ ② patrol_config + patrol_runner（本地跑通产 JSON）→ ③ GH workflow（手动触发验证）→ ④ 静态看板页
- 相关文件参考：`speed_test.py:398-465`（解耦点）、`scheduler.py:128-139`（sink 注入点）、`models.py:54`（SpeedTestResult 同构基准）

## 当前阻塞点 —— 等待用户拍板

上一轮最后向用户抛出的关键问题（**未获回答**）：

> 你想要的 fork 版，是「纯静态巡检看板」的产品形态吗？还是希望 fork 用户也能跑有后端的 App（那就不该用 GH workflow，应引导部署服务器/下桌面版）？

这个定位决定 patrol 版要不要做、做到什么程度。

另外两个此前提出、也未回答的次级决策点：
1. 仓库可见性：public 还是 private（影响 cron 频率上限）
2. 巡检看板是否公开：只自用可砍掉第 ④ 步，patrol_runner 产 JSON 后本地 clone 看

## 用户风格备忘

- 简洁执行，说人话，反感的点是 oversell（会话末尾明确指出我「统一架构」措辞夸大）
- 遵循 `/workflow-research-plan` 流程：正式实施前需出 plan
- 项目规范见 AGENTS.md（后端 pytest 必须全绿；前端改动需 npm run build）

## 下一步建议

1. 拿到用户对产品定位的回答后，按 `/workflow-research-plan` 出正式 plan
2. 若定位是「纯静态看板」：按 4 步落地，第 ① 步 sink 解耦无论如何都值得做（是正交性基础）
3. 若用户其实想要「fork 也能跑完整 App」：放弃 GH workflow 路线，改为引导服务器部署（复用现有 FastAPI 单进程形态）
