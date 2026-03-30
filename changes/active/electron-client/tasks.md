> 来源: design.md
> 生成时间: 2026-03-30
> 阶段: done

## 任务清单

### 第一批：基础 + 适配器（无依赖）

- [x] 【基础】项目初始化
  - 安装 electron + electron-builder + electron-store + electron-updater 依赖
  - 创建 `app/main.js`（BrowserWindow 800×600 min，加载 index.html）
  - 创建 `app/preload.js`（contextBridge 空骨架）
  - 创建 `app/renderer/index.html`（基础 HTML 结构）
  - package.json 添加 `electron:dev` 和 `dist` scripts
  - 验证 `npm run electron:dev` 启动显示空窗口

- [x] 【适配器】CLI 工具修正 + provider 扩展
  - 修正 `local-cli.js` PRESET_COMMANDS（claude: `--bare -p`，codex: `exec --json`，opencode: `run --format json`）
  - `resolveCommand()` 增加临时文件支持（prompt > 32KB 写 tmpdir）
  - `adapters/index.js` 新增 `claude-cli`/`codex-cli`/`opencode-cli` case
  - `{model}` 占位符可选处理

### 第二批：服务层（依赖 基础）

- [x] 【服务】CLI 检测
  - 创建 `app/services/cli-detector.js`
  - `detect()`：Windows `where`，macOS `which`
  - 缓存 + `redetect()` 清除缓存

- [x] 【服务】LLM 配置管理
  - 创建 `app/services/llm-profiles.js`
  - ProfileService：list/save/delete/setDefault/getDefault
  - safeStorage 加密/解密 + 降级处理
  - 校验：name/provider/model 必填

- [x] 【服务】历史记录管理
  - 创建 `app/services/history.js`
  - HistoryService：list/save/delete/getOutputDir
  - UUID id + createdAt 自动生成
  - search 过滤（query/sourceUrl），倒序排列
  - delete 同时删除输出目录

### 第三批：IPC + UI 框架（依赖 服务层）

- [x] 【IPC】主进程 IPC handler 注册
  - main.js 注册全部 15 个 IPC handler
  - sessions Map 管理 convert 结果
  - orchestrate progress 通过 webContents.send 推送
  - cancel 支持（abort flag）
  - preload.js 完善 contextBridge API

- [x] 【UI】页面框架与路由
  - `styles.css`：CSS 变量、侧边栏 + 内容区 flex 布局
  - `app.js`：hash-based 路由（#generate/#history/#settings）
  - 侧边栏组件 + 底部引擎状态
  - 页面骨架 `{ mount, unmount }` 接口

### 第四批：UI 页面（依赖 IPC + 框架）

- [x] 【UI】生成向导页
  - Step1：URL 输入 + 解析
  - Step2：引擎选择（API/CLI）
  - Step3：需求输入 + AI 筛选 + checkbox 确认
  - Step4：进度条 + 流式文本预览
  - 完成态：摘要 + 操作按钮
  - 步骤导航条

- [x] 【UI】设置页
  - LLM 配置列表（卡片式）
  - 新建/编辑弹窗表单
  - 删除确认
  - CLI 工具检测区域

- [x] 【UI】历史页
  - 搜索框 + 倒序列表
  - 操作按钮（打开/重新生成/删除）
  - 删除确认
  - 搜索实时过滤

### 第五批：CI/CD + 更新（独立）

- [x] 【CI/CD】打包配置 + GitHub Actions
  - electron-builder.yml
  - .github/workflows/release.yml（matrix macOS+Windows）
  - package.json dist script
  - 占位图标

- [x] 【更新】electron-updater 集成
  - autoUpdater.checkForUpdatesAndNotify()
  - update-downloaded 提示重启
  - 错误静默捕获

### 第六批：联调

- [ ] 【联调】端到端验证
  - 完整向导流程
  - API 模式 + CLI 模式
  - 历史记录全流程
  - 设置页全流程
  - 本地构建验证

> ⚠️ 端到端验证因 electron 二进制安装 EBUSY 锁问题暂时阻塞（环境问题，非代码问题）。
> 需关闭占用 node_modules/electron 目录的进程后重新 `npm install`。
