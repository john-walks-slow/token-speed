# 服务商管理与测速分离 + 跨服务商测速

## 现状问题

当前 sidebar 把服务商管理、模型选择、测速表单揉在一起。选中一个服务商后只能看到它的模型，无法跨服务商选模型同时测速。

## 设计方案

### 核心思路

```
┌──────────── Sidebar ────────────┬────────── Main Area ──────────┐
│                                 │                              │
│  服务商管理 (ConnectionConfig)   │  [测速] [结果] [统计]         │
│  ┌─────────────────────────┐   │                              │
│  │ OpenCode  🔌 20 模型    │   │  模型选择 (聚合所有服务商)     │
│  │ [检测] [管理] [编辑] [删] │   │  ┌─ OpenCode ──────────┐    │
│  │                         │   │  │ ☑ deepseek-v4-flash  │    │
│  │ 添加服务商               │   │  │ ☐ deepseek-v4-pro   │    │
│  └─────────────────────────┘   │  └─────────────────────┘    │
│                                 │  ┌─ AnotherProvider ───┐    │
│                                 │  │ ☐ claude-opus       │    │
│                                 │  │ ☑ claude-sonnet     │    │
│                                 │  └─────────────────────┘    │
│                                 │                              │
│                                 │  测速参数 + [开始测速]       │
└─────────────────────────────────┴──────────────────────────────┘
```

### 后端改动

- `BatchSpeedTestRequest.tests` 改为 `list[BatchSpeedTestItem]`，每个 item 包含 `{model, base_url, api_key}`
- 后端遍历 tests 时各自使用自己的 base_url/api_key 发请求

### 前端改动

1. **App.tsx**: 加载所有 providers，聚合模型列表。sidebar 只放 ConnectionConfig。main area 放聚合后的 ModelSelector + SpeedTestForm
2. **ModelSelector.tsx**: 接收分组的模型列表 `{providerName, models: ModelInfo[]}[]`
3. **ConnectionConfig.tsx**: 通过回调通知 App 模型变更，App 重新聚合
4. **api.ts**: `runBatchSpeedTest` 发送 `tests` 数组
