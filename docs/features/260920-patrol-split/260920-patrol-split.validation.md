# 用户验证要求 — 260920 patrol-split

## 核心场景（需实机验证）

### V1. 新仓库 secrets 配置与巡检成功

- **前置**：你已在 GitHub 网页端为 `john-walks-slow/token-speed-patrol` 配置 secrets：
  `GROQ_API_KEY`、`NVIDIA_API_KEY`、`GEMINI_API_KEY`、`OPENROUTER_API_KEY`
  （Settings → Secrets and variables → Actions；若要用 Cloudflare/ModelScope，需先在 `config/patrol.json` 加回对应 target 并配 secret）
- **操作**：Actions → Token Speed Patrol → Run workflow（providers 留空）
- **预期**：run 成功；`website/data/2026-09-20.jsonl` 新增一行 `status` 非 `failed`（success > 0）；deploy-website 被 workflow_run 联动触发且成功
- **实际结果**：（待填）
- **状态**：☐

### V2. 看板线上可访问且显示数据

- **操作**：浏览器打开 https://john-walks-slow.github.io/token-speed-patrol/
- **预期**：看板渲染正常，provider/model 列表出现（含 V1 成功后的速度数据；历史行含今天的巡检数据）
- **实际结果**：（待填）
- **状态**：☐

### V3. 桌面版功能回归（老仓库）

- **操作**：本地跑 `python -m uvicorn backend.main:app --port 8000`（或打包 exe），执行一次单模型测速与批量测速
- **预期**：测速结果正常；代理设置（设置面板改 proxy_mode=custom）后测速请求确实走代理——client_kwargs 注入路径生效
- **实际结果**：（待填）
- **状态**：☐

### V4. 老 Pages 与老 workflow 已下线

- **操作**：访问 https://john-walks-slow.github.io/token-speed/ ；查看老仓库 Actions 页
- **预期**：Pages 已 404/关闭；Actions 中无 Token Speed Patrol / Deploy website workflow
- **实际结果**：（待填）
- **状态**：☐
