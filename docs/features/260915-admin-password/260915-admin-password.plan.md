# 管理密码保护 + 单端口只读统计视图 — 计划

日期：2026-09-15
状态：规划完成，方向已与用户对齐（已合并 → 改造为单端口）

## 最终方案：主端口按认证分流，去独立端口

原 `feature/dashboard-port` 设计为「独立端口 8855 只读看板」。
经用户对齐，改为更简单的**单端口**模型：

- **未配置密码** → 主端口 `/` 直接完整应用（向后兼容，行为同今天）。
- **配置了密码** → 主端口 `/` 未认证时直接渲染**只读统计视图**（DashboardApp，
  统计 + 历史，只读）；输入密码登录后进完整管理界面（FullApp）。
- 删去独立端口 `dashboard.py` / `server.py` 双服务器逻辑（桌面、服务器统一单进程）。

## 为何这样做（设计决策）

- 避免两套 FastAPI app 与两个端口的心智负担；单端口天然被现有 CI/部署/LAN 访问复用。
- 匿名访问永不触碰完整密钥：新增 `/api/providers/public` 返回 sanitize 版 providers，
  看板用它做分组/命名展示；受保护的 `/api/providers` 仅 FullApp（已认证）调用。
- 需要匿名开放的只读集：`/api/stats`、`/api/history` GET、`/api/mode`、`/api/auth/status`、
  `/api/providers/public`、以及 DashboardApp 需要的 `/api/schedules` GET（HistoryList 展示定时来源）。

## 实施清单（diff 相对合并后 master）

### backend

1. **`security.py`**：开放集加入 `/api/schedules` GET 与 `/api/providers/public`。
2. **`main.py`**：
   - `read_router` 增加 `GET /api/providers/public` → sanitize 版（api_key 置空）。
   - `/api/providers`（完整版）保留在 `admin_router`（受密码保护）。
3. **移除独立端口**：删除 `backend/dashboard.py`、`backend/server.py`。

### frontend

4. **`lib/api.ts`**：新增 `getPublicProviders()` → `/api/providers/public`。
5. **`App.tsx`** 门控逻辑改造：
   - `getMode()` → 恒为 `full`（不再有 dashboard app 模式）。
   - `getAuthStatus().required == false` → 直接 `<FullApp/>`（免密，向后兼容）。
   - `required == true` 且无有效 token → 直接渲染 `<DashboardApp/>`（只读视图），
     提供「管理登录」入口跳登录；有效 token → `<FullApp/>`。
   - LoginGate 登录成功后 → `<FullApp/>`。
6. **`DashboardApp.tsx`**：移除「独立端口」表述；数据源改用 `getPublicProviders()`；
   header 加「管理登录」按钮（有密码时）/ 保持当前标签只读；仍 30s 自动刷新。
   HistoryList 用 `/api/schedules`（已开放）与 `/api/history`（已开放）。
7. **`FullApp.tsx`**：登录后完整 providers（含 key）照旧，无需改动。

### 桌面 / 部署

8. **`desktop.py`**：删除独立看板线程、托盘「打开统计看板」；窗口仍自动注入
   `admin_password`（已认证时直达 FullApp）。删除 `dashboard` 模块引用。
9. **`desktop_entry.py`**：移除 `--dashboard-port` 参数（保留 `--admin-password`）。
10. **`server.py` / `start.bat` / README**：去除独立端口/双服务器说明；README 改为
    「配置 TOKEN_SPEED_ADMIN_PASSWORD → 主端口未登录只读统计，登录进管理」。

### 文档 / 测试

11. 删除 `docs/features/260810-dashboard-port/`（被单端口方案取代）。
12. `test_security.py`：更新为单端口语义（public providers 开放、schedules 开放、
    完整 providers 受保护、只读视图元接口）；删 dashboard app 相关用例。

## 交付验证

- [ ] `python -m pytest backend/ -q` 全绿
- [ ] 未配密码：主端口全功能可用（向后兼容，无登录门）
- [ ] 配密码：
  - 匿名 GET `/api/stats`、`/api/history`、`/api/providers/public`、`/api/schedules`、
    `/api/mode`、`/api/auth/status` → 200
  - 匿名 GET `/api/providers`、POST/PUT/DELETE 各管理接口 → 401
  - 带正确 `Bearer` → 管理接口可用
  - 前端 `/` 匿名 → 只读统计视图；登录 → 完整管理界面；桌面窗口自动注入密码直达
- [ ] `cd frontend && npm run build` 通过
- [ ] 无独立端口残留（dashboard.py/server.py/desktop 托盘入口/README 双端口说明）

## 产出文档
- docs/features/260915-admin-password/260915-admin-password.summary.md