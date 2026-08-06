# Token Speed — LLM API 延迟与速度检测工具

## 背景

用户需要一个用于检测和跟踪大模型 API 延迟、速度的工具。支持 WebUI，用户体验好（如输入 Base URL 自动检测模型、选择要测速的模型等），具备基础的统计功能。

## 技术架构

### 整体架构

```
┌─────────────────────────────────────────────────┐
│                  Frontend (React + Vite)         │
│  ┌──────────┐ ┌──────────┐ ┌─────────────────┐  │
│  │ 测速面板   │ │ 历史记录  │ │ 统计图表         │  │
│  └──────────┘ └──────────┘ └─────────────────┘  │
│         ↕ HTTP (JSON)                            │
├─────────────────────────────────────────────────┤
│           Backend (Python FastAPI)                │
│  ┌──────────┐ ┌──────────┐ ┌─────────────────┐  │
│  │ API 代理  │ │ 测速引擎  │ │ SQLite 存储      │  │
│  └──────────┘ └──────────┘ └─────────────────┘  │
└─────────────────────────────────────────────────┘
         ↕ HTTP (OpenAI-compatible API)
┌─────────────────────────────────────────────────┐
│        LLM API Provider (OpenAI / vLLM /         │
│        Ollama / 任意 OpenAI-compatible)          │
└─────────────────────────────────────────────────┘
```

### 技术选型

| 层级 | 技术 | 理由 |
|------|------|------|
| 前端框架 | React 18 + TypeScript | 生态成熟，UI 组件丰富 |
| 构建工具 | Vite | 极快的 HMR 和构建 |
| UI 组件 | Tailwind CSS + shadcn/ui | 美观、现代化、可定制 |
| 图表 | Recharts | React 原生图表库，交互性好 |
| 后端 | Python FastAPI | 异步支持好，适合代理 API 请求 |
| 存储 | SQLite (via aiosqlite) | 零配置，适合本地工具 |
| API 兼容 | OpenAI API 格式 | 兼容 vLLM / Ollama / 等 |

### 核心功能

1. **连接配置**：输入 Base URL、API Key，自动检测可用模型列表
2. **模型选择**：从检测到的模型中选择一个或多个进行测速
3. **测速参数**：配置测试 prompt、max tokens、temperature、并发数等
4. **实时测速**：显示 TTFT、TPS、总耗时等指标
5. **历史记录**：每次测试结果持久化存储
6. **统计面板**：趋势图、对比分析、基础统计

### 关键指标

| 指标 | 说明 |
|------|------|
| TTFT (Time to First Token) | 首 token 延迟 |
| TPS (Tokens Per Second) | 每秒生成 token 数 |
| Latency | 总请求延迟 |
| Success Rate | 成功率 |

### API 路由设计

```
Backend API:
  POST   /api/connect          - 验证连接并返回可用模型列表
  POST   /api/speed-test       - 执行单次测速
  POST   /api/speed-test/batch - 批量测速（多个模型/多次）
  GET    /api/history          - 获取历史测试记录
  GET    /api/history/:id      - 获取单条测试详情
  DELETE /api/history          - 清空历史记录
  GET    /api/stats            - 获取统计数据
```

## 实施计划

### Phase 1: 项目骨架与核心测速功能

1. 初始化项目结构
2. 搭建 FastAPI 后端（代理 API、测速引擎、SQLite 存储）
3. 搭建 React 前端（Vite + Tailwind + shadcn/ui）
4. 实现连接配置和模型自动检测
5. 实现单次测速和实时展示

### Phase 2: 历史记录与统计

6. 实现测速历史持久化
7. 实现统计面板（趋势图、对比分析）
8. 实现批量测速

### Phase 3: 优化与体验改进

9. 错误处理和 loading 状态
10. UI 细节打磨
11. 响应式适配

## 数据结构

### speed_tests 表

```sql
CREATE TABLE speed_tests (
  id            TEXT PRIMARY KEY,
  base_url      TEXT NOT NULL,
  model         TEXT NOT NULL,
  prompt        TEXT,
  max_tokens    INTEGER,
  temperature   REAL,
  ttft_ms       REAL,       -- time to first token (ms)
  total_latency_ms REAL,    -- total request duration (ms)
  tokens_generated INTEGER, -- tokens generated
  tps           REAL,       -- tokens per second
  success       BOOLEAN,
  error_message TEXT,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 项目结构

```
x:\Coding\token-speed/
├── backend/
│   ├── main.py              # FastAPI 入口
│   ├── requirements.txt     # Python 依赖
│   ├── models.py            # 数据模型
│   ├── database.py          # SQLite 数据库操作
│   ├── speed_test.py        # 测速核心逻辑
│   └── proxy.py             # API 代理
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── tailwind.config.js
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/
│       │   ├── ConnectionConfig.tsx   # 连接配置面板
│       │   ├── ModelSelector.tsx      # 模型选择
│       │   ├── SpeedTestForm.tsx      # 测速参数配置
│       │   ├── SpeedTestResult.tsx    # 测速结果展示
│       │   ├── HistoryList.tsx        # 历史记录列表
│       │   └── StatsPanel.tsx         # 统计面板
│       ├── lib/
│       │   └── api.ts                 # API 调用封装
│       └── types.ts                   # 类型定义
├── docs/
│   └── features/
│       └── token-speed/
│           ├── 20260712-token-speed.plan.md
│           └── ...
└── README.md
```
