# Summary — 巡检版拆分为独立仓库 token-speed-patrol（260920）

## 背景

patrol（GH Actions 定时测速 + 静态看板）适合独立成仓供他人 fork 自用；桌面版仓库回归单一职责。计划/调研/检视见同目录。

## 结果

- **新仓库**：https://github.com/john-walks-slow/token-speed-patrol （公开）
  - backend 六文件（core 解耦后）+ website/ 看板 + config/patrol.json（无密钥，直接提交）+ patrol.yml / deploy-website.yml + fork 自用 README
  - 线上看板：https://john-walks-slow.github.io/token-speed-patrol/
  - 已实测全链路：dispatch → 巡检 → JSONL commit → workflow_run 联动 Pages 发布 → 线上 200
- **老仓库**：删除 patrol/website/patrol workflow；README 顶部引流链接；core 解耦（见下）
- **secrets 迁移**：程序无法读回 secret 值，需用户在网页端为新仓库配置（validation V1）

## 关键改动：core 解耦

`speed_test.py` 原通过 `network_settings.client_kwargs()` 隐式依赖桌面版 SQLite（巡检进程首次发请求即建库）。现改为：

- `run_speed_test` / `list_models` / `execute_batch_tests` 增加可选参数 `client_kwargs`，默认 `DEFAULT_CLIENT_KWARGS = {"trust_env": True}`（与原默认行为等价）
- 桌面版 main.py / scheduler.py 作为 adapter 层显式注入 `net_client_kwargs()`
- core 层（speed_test/rate_limit/url_utils）不再依赖 database/network_settings/paths

## 双仓库同步约定

core 四文件 + patrol_runner + test_patrol 两仓库纯拷贝同源（cmp 字节级一致）。改动任一侧需手动同步另一侧，两侧 AGENTS.md 均已注明。不引入 submodule/同步脚本（单人项目、改动频率低）。

## 遗留

- 新仓库 secrets 待用户配置后巡检才会成功（当前 21/21 401 失败，配好后 dispatch 复跑）
- 历史数据中 Cloudflare account id 已在新仓库脱敏为 `(private)`；老仓库数据文件随 website/ 删除
