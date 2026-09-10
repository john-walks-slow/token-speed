# 260910 产品官网 · summary

## 交付（ef77630, 110d71d）

- `website/index.html`：纯静态零构建官网。区块：hero（真实 12 模型测速截图）→ 指标口径四卡
  （ttft_ms / tps / thinking_ms / usage 自适应）→ 功能网格（9 项）→ 截图画廊（统计/历史/定时，
  来自本机真实数据）→ 双平台快速开始（Linux/macOS + Windows tab）→ 技术栈 → 页脚。
- 部署：`.github/workflows/deploy-website.yml`，push master 触发，Pages `build_type=workflow`。
  线上地址 <https://john-walks-slow.github.io/token-speed/>。
- 截图素材：`website/assets/*.png`（暗色主题，由真实运行实例截取）。

## 关键决策

- 零构建依赖（无框架无打包）：Pages 发布就是原样上传 `website/`，维护成本最低。
- 相对路径（`./assets/...`）适配 Pages 子路径部署。
- 入场动画渐进增强：`html.js` 前缀下才隐藏元素，无 JS/爬虫/截图场景默认可见；
  IntersectionObserver + 800ms 周期兜底双保险（自动化浏览器里 observer 可能不触发，实测踩坑）。
- README 补充 Linux 常驻部署（supervisord）段落——原 README 只有 Windows 视角。

## 验证

- 本地 `python -m http.server` 预览：4/4 图片加载、无布局破损（modlens 全页截图逐区块核对）
- 线上部署后 E2E：HTTP 200、标题正确、4/4 图片、0 个隐藏元素（cache-bust 后复核）
- 两次 workflow 均 success
