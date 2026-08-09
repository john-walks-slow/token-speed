# Anthropic 原生协议支持 用户验证

## 验证说明

- 验证对象：新增 Anthropic 原生 Messages API 支持（服务商手动选择接口类型）+ base_url 输入放宽（省略协议头自动补 https://）
- 环境/前置条件：本机运行后端 + 前端；至少一个 Anthropic 兼容端点（官方 api.anthropic.com 或自定义 relay）及有效 API Key；一个现有 OpenAI 兼容服务商（回归用）

## 验证项

| 验证步骤 | 预期结果 | 实际结果 | 状态 | 备注/证据 |
| --- | --- | --- | --- | --- |
| 添加服务商，接口类型选「Anthropic 原生」，Base URL 填 `api.anthropic.com/v1`（无 https://），填 API Key | Base URL 自动补全为 `https://api.anthropic.com/v1`；保存后服务商卡片显示 Anthropic badge | | 待验证 | |
| 在模型管理弹窗点「检测模型」 | 能列出 claude-* 系列模型 | | 待验证 | |
| 勾选某 claude 模型，手动测速（流式） | 测速成功，TTFT / TPS / 回复内容 / token 数正常显示 | | 待验证 | |
| 手动测速（非流式） | 测速成功，延迟正常显示，TPS 显示 N/A（非流式无生成速度，属预期） | | 待验证 | |
| 新建定时任务，target 选 Anthropic 服务商，触发一次 | 定时测速成功，历史记录带 provider_name，各指标正常 | | 待验证 | |
| 回归：编辑现有 OpenAI 兼容服务商并重新测速 | 行为与改动前一致（接口类型默认 OpenAI 兼容） | | 待验证 | |
| 回归：OpenAI 兼容服务商输入不带 /v1 的地址（如 `xxx.com/v1` 故意省略 https://） | 自动补 https:// 后可正常连接 | | 待验证 | |

## 验证结论

待验证。

## 待跟进

无。
