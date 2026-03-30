> 来源：用户需求
> 生成时间：2026-03-30
> 阶段：proposal

### Why（意图）

- 背景：axure-to-markdown v3.0 仅提供 CLI 交互，产品经理不会用命令行，无法独立生成 PRD
- 动机：提供桌面 GUI 客户端，降低使用门槛；通过 CI/CD 自动分发安装包

### What（范围）

#### 做什么

- [ ] Electron 桌面应用：向导式 UI（输入 URL → 配置引擎 → 描述需求 → AI 筛选页面 → 逐页生成），直接复用 `src/` 全部业务逻辑
- [ ] 历史生成数据管理：自动存档每次生成结果（源 URL、query、时间、页面列表、完整 markdown），支持搜索、重新生成（预填参数）、打开输出目录、删除
- [ ] LLM 配置管理：多配置命名存储与快速切换（provider/baseUrl/apiKey 加密/model），★ 标记默认
- [ ] 本地 CLI 工具集成：自动检测 PATH 中的 `claude`/`codex`/`opencode`，选择后免配置调用（`claude --bare -p`、`codex exec`、`opencode run`），统一适配器封装
- [ ] GitHub Actions CI/CD：tag 触发 → electron-builder 双平台构建（macOS .dmg + Windows .exe）→ GitHub Releases 自动发布 + electron-updater 自动更新

#### 不做什么

- [ ] 不重写现有 `src/` 业务逻辑（原因：直接 require 复用）
- [ ] 不引入前端框架（原因：4 步向导 + 2 个管理页，纯 HTML/CSS/JS 足够）
- [ ] 不做代码签名（原因：先跑通流程，后续按需加证书）
- [ ] 不做 CLI 入口改动（原因：桌面端与 CLI 并行，互不影响）

### 初步技术方向

Electron + electron-builder + electron-store（配置持久化）+ safeStorage（apiKey 加密）。main process 直接 require 现有 orchestrator，通过 ipcMain 桥接 renderer UI。本地 CLI 工具通过 child_process.spawn 调用，封装为与 remote-api 同接口的 adapter。

### 成功标准

- [ ] `npm run dist` 本地构建出可运行的 .exe 和 .dmg
- [ ] 向导流程完整跑通：URL 输入 → 引擎选择 → 需求描述 → 页面确认 → PRD 生成
- [ ] 历史记录：生成后自动出现，可搜索、可重新生成、可删除
- [ ] LLM 配置：新建/编辑/删除/切换默认，apiKey 加密存储
- [ ] 本地 CLI：检测到 claude 后选择，免配置生成 PRD 成功
- [ ] `git tag v1.0.0 && git push --tags` 触发 GitHub Actions，两平台构建产物发布到 Releases
