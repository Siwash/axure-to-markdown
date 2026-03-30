> 来源：proposal.md
> 生成时间：2026-03-30
> 阶段：spec

### Why

axure-to-markdown v3.0 仅提供 CLI 交互（`bin/axure-prd.js`），产品经理无法独立使用。现有业务逻辑（`src/client/orchestrator.js`、`adapters/`）已与 CLI 解耦，具备包装 GUI 的条件。

目标：提供桌面安装包（Mac .dmg / Win .exe），产品经理双击即用，通过 GitHub Actions 自动发布。

### What

| 功能 | 验收标准 | 优先级 |
|------|---------|--------|
| Electron 应用启动 | 双击 .exe/.dmg 启动，显示主窗口（侧边栏 + 内容区），无白屏无报错 | P0 |
| 生成向导（4 步） | Step1 输入 URL 解析原型 → Step2 选择引擎 → Step3 输入需求+AI 筛选页面+用户勾选确认 → Step4 实时进度+逐页生成 | P0 |
| API 引擎模式 | 选择已保存的 LLM 配置，调用 remote-api adapter 完成生成 | P0 |
| 本地 CLI 引擎模式 | 选择已检测到的 claude/codex/opencode，通过 child_process 调用，无需 API 配置 | P0 |
| CLI 工具自动检测 | 启动时扫描 PATH，状态显示 ✅已安装 / ❌未检测到 | P0 |
| LLM 配置 CRUD | 新建/编辑/删除配置（名称/provider/baseUrl/apiKey/model），★ 切换默认 | P0 |
| API Key 加密存储 | 使用 Electron safeStorage 加密，明文不落盘 | P0 |
| 历史记录自动存档 | 每次生成完成后自动保存：源 URL、query、时间戳、页面列表、完整 markdown 输出 | P0 |
| 历史记录管理 | 列表展示（按时间倒序）、关键词搜索、打开输出目录、删除（含确认） | P0 |
| 历史记录重新生成 | 点击「重新生成」预填原参数（URL + query + 引擎配置），进入生成向导 Step2 | P1 |
| 生成进度实时展示 | 当前页面名称、进度条（n/total）、流式文本预览 | P1 |
| GitHub Actions CI/CD | push `v*` tag → macOS + Windows 并行构建 → 产物发布到 GitHub Releases | P0 |
| electron-updater 自动更新 | 启动时检查新版本，下载后提示重启安装 | P1 |

**不做的事：**
- 不引入前端框架（React/Vue），纯 HTML/CSS/JS
- 不做代码签名（首版不配证书）
- 不改动现有 CLI 入口（`index.js`、`bin/axure-prd.js` 保持原样）
- 不做移动端
- 不做用户登录/账号体系
- 不做 Linux 构建（首版只 Mac + Win）

### How

#### 1. 正常流程

**启动流程：**
1. Electron main process 创建 BrowserWindow
2. main process 扫描 PATH 检测 claude/codex/opencode 可用性
3. main process 从 electron-store 加载已保存的 LLM 配置列表
4. renderer 通过 preload 桥接获取初始状态，渲染侧边栏 + 默认页面（生成向导）

**生成流程（API 模式）：**
1. 用户输入 Axure 原型 URL/本地路径
2. 用户选择「API 模式」，从下拉菜单选择已保存配置
3. main process 调用 `convert(source)` 解析原型，通过 IPC 返回页面列表
4. 用户输入 PRD 需求描述
5. main process 调用 `selectPages()` 让 LLM 筛选页面，通过 IPC 返回选中列表
6. 用户勾选确认页面
7. main process 调用 `orchestrate()` 逐页生成，通过 IPC 实时推送 callbacks 事件（onPageStart/onChunk/onPageComplete/onProgress）
8. renderer 展示实时进度（进度条 + 当前页名 + 流式文本）
9. 生成完成，写入文件，自动保存历史记录
10. 展示结果摘要，提供「打开输出目录」按钮

**生成流程（本地 CLI 模式）：**
与 API 模式相同，区别仅在 Step 2 选择「本地 CLI」→ 选择工具名（claude/codex/opencode）。main process 构造 `{ provider: 'local-cli', command: 'claude' }` 传入 createAdapter，后续流程完全一致。

**LLM 配置管理流程：**
1. 进入设置页 → 配置列表
2. 点击「新建」→ 表单：名称、provider 下拉、baseUrl、apiKey（密码输入框）、model
3. 保存时 apiKey 通过 safeStorage.encryptString() 加密后存入 electron-store
4. 读取时通过 safeStorage.decryptString() 解密
5. ★ 标记默认配置，生成向导自动选中

**历史管理流程：**
1. 进入历史页 → 按时间倒序展示
2. 每条记录显示：时间、query 摘要、源 URL、页面数
3. 搜索框实时过滤（匹配 query 和 URL）
4. 点击「打开」→ shell.openPath 打开输出目录
5. 点击「重新生成」→ 跳转生成向导，预填 URL + query + 引擎
6. 点击「删除」→ 确认对话框 → 删除元数据 + 输出文件

#### 2. 失败处理

| 失败场景 | 处理方式 |
|---------|---------|
| Axure URL 无法访问 | 显示错误提示「无法连接到原型地址，请检查 URL 或网络」，停留在 Step1 |
| LLM API 调用失败（网络/401/429） | 显示具体 HTTP 错误信息，提供「重试」按钮 |
| 本地 CLI 工具执行失败（退出码非 0） | 显示 stderr 内容，提供「重试」按钮 |
| 本地 CLI 工具超时（>5 分钟/页） | 终止进程，显示超时提示，已完成页面保留 |
| 单页生成失败（orchestrator 内部重试耗尽） | 跳过该页继续，最终报告中标记失败页 |
| 无已保存 LLM 配置且选择 API 模式 | 引导跳转设置页创建配置 |
| 无可用 CLI 工具且选择 CLI 模式 | 提示「未检测到任何本地 AI 工具，请安装 Claude/Codex/OpenCode」 |
| safeStorage 不可用（系统不支持） | 降级为明文存储，启动时 console.warn |
| electron-updater 检查更新失败 | 静默忽略，不影响正常使用 |
| CI 构建失败 | GitHub Actions 报告错误，不影响已发布版本 |

#### 3. 边界与约束

| 边界 | 说明 |
|------|------|
| 同时只能运行一个生成任务 | 生成中禁用「开始生成」按钮，避免并发 |
| 历史记录上限 | 不限数量，元数据存 electron-store（JSON），输出文件存 userData 目录 |
| CLI 工具检测时机 | 仅启动时检测一次，设置页提供「重新检测」按钮 |
| CLI 工具 prompt 传递 | 长 prompt（>32KB）通过临时文件传递，避免命令行参数长度限制 |
| 窗口最小尺寸 | 800×600，防止 UI 变形 |
| 配置数量上限 | 不限，但 UI 列表超过 20 条时显示滚动条 |
| 输出目录 | 默认 `{userData}/prd-output/{history-id}/`，用户可在向导中修改 |

#### 4. 任务拆分

| 任务名称 | 详细描述 | 计划工作量(人天) |
|----------|---------|--------------|
| 【基础】Electron 项目初始化 | 1. 安装 electron + electron-builder 依赖<br>2. 创建 app/main.js（窗口管理、IPC 注册）<br>3. 创建 app/preload.js（contextBridge 暴露安全 API）<br>4. 创建 app/renderer/index.html（单页框架）<br>5. package.json 添加 electron 相关 scripts 和 build 配置 | 0.5 |
| 【UI】页面框架与路由 | 1. 侧边栏组件（生成/历史/设置三入口 + 底部引擎快切）<br>2. 纯 JS 页面路由（hash-based）<br>3. 全局样式（CSS 变量主题）<br>4. 三个页面骨架（generate.js/history.js/settings.js） | 1 |
| 【生成】向导流程 | 1. Step1：URL 输入 + 解析触发（IPC 调 convert）<br>2. Step2：引擎选择（API 模式下拉 / CLI 模式选择）<br>3. Step3：需求输入 + AI 筛选页面 + checkbox 确认<br>4. Step4：进度条 + 当前页名 + 流式文本预览<br>5. 完成界面：摘要 + 打开输出目录按钮 | 1.5 |
| 【引擎】CLI 工具检测与适配 | 1. app/services/cli-detector.js：扫描 PATH 检测 claude/codex/opencode<br>2. 修正 local-cli.js PRESET_COMMANDS（claude: `--bare -p`，codex: `exec --json`，opencode: `run --format json`）<br>3. 长 prompt 临时文件传递机制<br>4. adapters/index.js 新增 claude/codex/opencode provider 分支 | 1 |
| 【配置】LLM 配置管理 | 1. app/services/llm-profiles.js：CRUD + 默认标记 + 加密存储<br>2. 设置页 UI：配置列表 + 新建/编辑表单 + 删除确认<br>3. safeStorage 加密/解密 + 降级处理<br>4. 生成向导中引用配置列表 | 1 |
| 【历史】历史记录管理 | 1. app/services/history.js：存档/查询/删除 + 输出文件管理<br>2. 历史页 UI：倒序列表 + 搜索框 + 操作按钮<br>3. 生成完成后自动存档 hook<br>4. 重新生成：预填参数跳转向导 | 1 |
| 【CI/CD】GitHub Actions + electron-builder | 1. electron-builder.yml 配置（appId、mac/win target、publish github）<br>2. .github/workflows/release.yml（matrix: macos-latest + windows-latest）<br>3. package.json 添加 dist script<br>4. 本地验证 `npm run dist` 构建成功 | 0.5 |
| 【更新】electron-updater 集成 | 1. main.js 中集成 autoUpdater.checkForUpdatesAndNotify()<br>2. 更新下载完成后提示重启 | 0.5 |
| 【联调】端到端测试 | 1. 本地构建 .exe 运行完整流程<br>2. API 模式生成测试<br>3. CLI 模式（claude）生成测试<br>4. 历史记录存档/搜索/重新生成测试<br>5. tag 触发 CI 构建验证 | 1 |
| **合计** | | **8** |

### Verify

- [x] 所有功能需求都有对应任务
- [x] 所有失败路径都覆盖了
- [x] 没有模糊描述（无"适当的"、"一些"、"待定"、"可能"）
- [x] 没有未确认的假设
- [x] 任务总量与需求规模匹配（8 人天，合理）

### Impact

- **app/**（新增）：Electron 应用全部代码，main/preload/renderer/services
- **src/client/adapters/local-cli.js**（修改）：修正 PRESET_COMMANDS 参数格式
- **src/client/adapters/index.js**（修改）：新增 claude/codex/opencode provider 分支
- **package.json**（修改）：新增 electron/electron-builder/electron-store/electron-updater 依赖
- **.github/workflows/release.yml**（新增）：CI/CD 配置
- **electron-builder.yml**（新增）：打包配置
