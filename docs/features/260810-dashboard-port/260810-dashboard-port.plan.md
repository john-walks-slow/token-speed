# 统计看板独立端口 + 管理页面密码 — 260810-dashboard-port

## 背景

Token Speed 桌面版整个 FastAPI app 只绑定 `127.0.0.1`（桌面动态端口 / dev 8000），手机/局域网设备无法查看统计。需求：

1. **统计看板暴露到独立端口**（`0.0.0.0`，局域网可访问），形态为**只读看板**——仅统计 + 历史，无任何管理功能，sanitize 掉 API key。
2. **管理页面需要密码**：主应用的管理功能（服务商 CRUD 含 API key、定时、设置）需要密码，**不管访问者是谁**（本机或远程）都要求。密码通过**环境变量 / 启动参数**配置。

约束：保持桌面（pywebview）+ dev（start.bat）+ 服务器部署（uvicorn 直跑）三种模式可用；未配置密码时完全向后兼容。

## 技术选型

| 维度 | 选择 | 理由 |
|---|---|---|
| 看板隔离 | **同进程双 FastAPI app，共享 read_router** | 路由定义只写一遍；看板 app 按构造不含管理接口，未设密码也不会在 LAN 端口暴露管理面。单 app 双端口需靠密码兜底，默认态不安全 |
| 管理密码 | **Bearer token 中间件**（无 session 状态） | 最简单；密码即 token，恒时比较防时序侧信道 |
| 前端区分 | **`GET /api/mode` 模式判定** + 门控根组件 | 同一份 SPA 复用，dashboard 渲染只读版，full 渲染主应用 |

## 架构

```
主应用 app (127.0.0.1:动态/8000)
  ├─ read_router   : GET mode/stats/history  → 始终开放（免密）
  │                   GET /api/schedules      → 仅看板侧免密；主应用侧受密码保护（泄露调度配置）
  ├─ admin_router  : 测速/providers(含key)/history删除/schedules写/settings
  └─ AdminAuthMiddleware : 密码配置后拦截 /api 非只读集

看板 app dashboard_app (0.0.0.0:8855)
  ├─ read_router（共享） + 专属 mode(dashboard) 路由
  ├─ providers sanitize 版（api_key 置空）
  └─ 同一份前端 dist
```

> 安全决策：`/api/schedules` 列表在主应用侧纳入受保护集（配置含调度目标/模型等敏感信息），
> 看板侧因 dashboard app 无中间件仍免密可用（HistoryList 需 schedule 名映射），无功能影响。

## 环境变量 / 启动参数

| 名称 | 默认 | 说明 |
|---|---|---|
| `TOKEN_SPEED_ADMIN_PASSWORD` | 未设 | 管理密码；desktop 可用 `--admin-password` 覆盖 |
| `TOKEN_SPEED_DASHBOARD_PORT` | `8855` | 看板端口；desktop 可用 `--dashboard-port` 覆盖 |
| `TOKEN_SPEED_DASHBOARD_HOST` | `0.0.0.0` | 看板绑定地址 |
| `TOKEN_SPEED_DASHBOARD_DISABLED` | 空 | 设 `1` 禁用看板 |

## 改动清单

### 后端

| 文件 | 改动 |
|---|---|
| `backend/security.py`（新增） | `admin_password()` / `is_open_request()` / `AdminAuthMiddleware`，恒时比较 |
| `backend/main.py` | 路由拆 `read_router`/`admin_router`；挂中间件；新增 `/api/mode`、`/api/auth/status` |
| `backend/dashboard.py`（新增） | 看板 app：共享 read_router + 专属 mode + sanitize providers + 挂 dist + `dashboard_config()` |
| `backend/desktop.py` | 新增看板 uvicorn 线程、托盘「打开统计看板」、webview URL 附密码、局域网地址日志 |
| `backend/desktop_entry.py` | 解析 `--admin-password` / `--dashboard-port` |
| `backend/server.py`（新增） | `python -m backend.server` 同进程双服务器（部署用） |

### 前端

| 文件 | 改动 |
|---|---|
| `src/lib/api.ts` | token（sessionStorage + Authorization 头）、`AuthError`、`getMode`/`getAuthStatus` |
| `src/lib/router.ts` | `useHashRoute(valid, default)` 参数化 |
| `src/App.tsx` | 重构为门控根组件（mode/auth 判定 + URL 注入密码清理） |
| `src/FullApp.tsx`（新增） | 原 App 主体迁入（行为不变） |
| `src/DashboardApp.tsx`（新增） | 只读看板（统计/历史 2 Tab，30s 自动刷新） |
| `src/components/LoginGate.tsx`（新增） | 管理密码登录门 |
| `src/components/HistoryList.tsx` | `readOnly` prop（隐藏删除/清空） |
| `src/lucide-react.d.ts` | 声明 `Shield` 图标 |

## 验证

- [x] `backend/test_security.py` 20 用例：开放集判定、未配置放行、Bearer 校验、看板只读 + sanitize
- [x] 全部后端测试 61 passed
- [x] `npm run build`（tsc 严格模式）
- [x] 冒烟：设密码后主 app stats 免密/providers 401 与 200；看板 mode=dashboard、providers POST 405
- [ ] 实机（用户）：dev / 桌面 / 手机访问 `<IP>:8855` 只读看板；管理密码登录门
