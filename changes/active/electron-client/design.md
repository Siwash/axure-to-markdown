> 来源: spec.md
> 生成时间: 2026-03-30
> 阶段: design

### Why

**背景与现状**

axure-to-markdown v3.0 的业务逻辑已完全模块化：`src/api.js` 提供 `convert(source)` 解析原型，`src/client/orchestrator.js` 提供 `selectPages()` + `orchestrate()` 驱动 LLM 生成，`src/client/adapters/` 通过工厂函数 `createAdapter(config)` 统一适配 RemoteAPI/LocalCLI/Ollama 三类引擎。所有模块通过 callbacks 通信（onPageStart/onChunk/onPageComplete/onProgress），无 CLI 耦合。

当前入口 `bin/axure-prd.js` 仅做 CLI 交互（readline + process.argv），Electron 桌面端只需替换这一层。

**设计目标 / 非目标**

| 类型 | 说明 |
|------|------|
| ✅ 目标 | Electron main process 直接 require 现有 `src/` 模块，零拷贝复用 |
| ✅ 目标 | IPC 桥接 callbacks 事件流，renderer 实时展示进度 |
| ✅ 目标 | electron-store 持久化配置和历史，safeStorage 加密 API Key |
| ✅ 目标 | 修正 local-cli.js PRESET_COMMANDS，支持 claude/codex/opencode 正确调用 |
| ✅ 目标 | electron-builder 双平台打包 + GitHub Actions CI/CD |
| ❌ 非目标 | 不改 orchestrator/assembler/adapter 核心逻辑 |
| ❌ 非目标 | 不引入前端框架、不做代码签名、不做 Linux 构建 |

### What

#### 技术方案

**架构决策**

| 模块 | 职责 | 依赖 |
|------|------|------|
| `app/main.js` | Electron 主进程：窗口管理、IPC 注册、菜单 | electron, electron-store, app/services/* |
| `app/preload.js` | contextBridge 暴露安全 IPC API | electron |
| `app/services/history.js` | 历史记录 CRUD + 输出文件管理 | electron-store, fs |
| `app/services/llm-profiles.js` | LLM 配置 CRUD + 加密存储 + 默认切换 | electron-store, electron.safeStorage |
| `app/services/cli-detector.js` | 扫描 PATH 检测 claude/codex/opencode | child_process |
| `app/renderer/app.js` | Hash-based SPA 路由 + 全局状态 | — |
| `app/renderer/pages/generate.js` | 4 步生成向导 UI | preload API |
| `app/renderer/pages/history.js` | 历史记录列表 UI | preload API |
| `app/renderer/pages/settings.js` | LLM 配置管理 + CLI 检测 UI | preload API |
| `src/client/adapters/index.js` | 适配器工厂（修改：新增 provider 分支） | 已有 |
| `src/client/adapters/local-cli.js` | CLI 适配器（修改：修正 PRESET_COMMANDS） | 已有 |

```
┌────────────────────────────────────────────────────────────┐
│                    Renderer Process                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                │
│  │ generate  │  │ history  │  │ settings │   ← pages      │
│  └─────┬────┘  └─────┬────┘  └─────┬────┘                │
│        └──────────┬──┴──────────────┘                      │
│              app.js (router)                               │
│                   │                                        │
│        ──────────IPC (contextBridge)──────────              │
└────────────────────────────────────────────────────────────┘
                    │ ipcRenderer.invoke / on
┌────────────────────────────────────────────────────────────┐
│                    Main Process                            │
│  ┌──────────────────────────────────────────────┐         │
│  │ main.js  (IPC handlers)                       │         │
│  │  ├─ convert() ← src/api.js                   │         │
│  │  ├─ selectPages() ← src/client/orchestrator   │         │
│  │  ├─ orchestrate() ← src/client/orchestrator   │         │
│  │  ├─ HistoryService ← app/services/history     │         │
│  │  ├─ ProfileService ← app/services/llm-profiles│         │
│  │  └─ CliDetector ← app/services/cli-detector   │         │
│  └──────────────────────────────────────────────┘         │
└────────────────────────────────────────────────────────────┘
```

**数据模型**

本项目无数据库，使用 electron-store（JSON 文件）持久化。

**LLM 配置存储结构 (`llm-profiles` store key)：**

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | string | 必填，UUID | 配置唯一标识 |
| name | string | 必填，非空 | 用户自定义名称 |
| provider | string | 必填，枚举: openai/claude/deepseek/qwen/ollama | LLM 提供商 |
| baseUrl | string | 可选 | 自定义 API 端点 |
| apiKey | string | 可选（加密后存储） | 经 safeStorage.encryptString() 加密的 Buffer.toString('base64') |
| model | string | 必填 | 模型名称 |
| isDefault | boolean | 默认 false | 是否默认配置（全局唯一） |
| createdAt | number | 自动 | 创建时间戳 |

**历史记录存储结构 (`history` store key)：**

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | string | 必填，UUID | 记录唯一标识 |
| sourceUrl | string | 必填 | Axure 原型地址 |
| query | string | 必填 | 用户需求描述 |
| engineType | string | 必填，枚举: api/cli | 引擎类型 |
| engineName | string | 必填 | 引擎具体名称（配置名 or cli 工具名） |
| selectedPages | string[] | 必填 | 选中的页面列表 |
| stats | object | 必填 | { totalPages, processedPages, elapsedMs } |
| outputDir | string | 必填 | 输出目录绝对路径 |
| createdAt | number | 自动 | 生成时间戳 |

输出文件存储在 `{userData}/prd-output/{history.id}/` 目录下，与 history 元数据通过 id 关联。

**接口定义**

> IPC 接口（main ↔ renderer 通信）

| 接口 | 方向 | channel | 入参 | 出参 | 说明 |
|------|------|---------|------|------|------|
| 解析原型 | invoke | `axure:convert` | `{ source: string }` | `{ sitemap, pages, indexContent }` | 调用 convert()，返回解析结果摘要 |
| 页面筛选 | invoke | `axure:select-pages` | `{ query: string, sessionId: string }` | `string[]` | 调用 selectPages()，sessionId 关联 convert 结果 |
| 开始生成 | invoke | `axure:generate` | `{ sessionId, selectedPages, outputDir? }` | `{ stats }` | 调用 orchestrate()，进度通过 event 推送 |
| 生成进度事件 | send→on | `axure:progress` | — | `{ type, pageName?, chunk?, current?, total? }` | main→renderer 实时推送 |
| 取消生成 | invoke | `axure:cancel` | `{ sessionId }` | `{ ok: boolean }` | 终止当前生成进程 |
| 获取配置列表 | invoke | `profile:list` | — | `Profile[]` | 返回所有 LLM 配置（apiKey 已解密） |
| 保存配置 | invoke | `profile:save` | `Profile` (不含 id 则新建) | `Profile` | 新建或更新配置 |
| 删除配置 | invoke | `profile:delete` | `{ id: string }` | `{ ok: boolean }` | 删除指定配置 |
| 设置默认配置 | invoke | `profile:set-default` | `{ id: string }` | `{ ok: boolean }` | 标记默认，取消其他默认 |
| 获取历史列表 | invoke | `history:list` | `{ search?: string }` | `HistoryRecord[]` | 按时间倒序，可选关键词过滤 |
| 删除历史 | invoke | `history:delete` | `{ id: string }` | `{ ok: boolean }` | 删除元数据 + 输出文件目录 |
| 打开输出目录 | invoke | `history:open-dir` | `{ id: string }` | `{ ok: boolean }` | shell.openPath |
| 检测 CLI 工具 | invoke | `cli:detect` | — | `{ claude: boolean, codex: boolean, opencode: boolean }` | 扫描 PATH |
| 重新检测 CLI | invoke | `cli:redetect` | — | 同上 | 强制重新扫描 |
| 获取应用信息 | invoke | `app:info` | — | `{ version, userData }` | 应用版本和数据目录 |

> Services 内部接口（main process 内部模块）

| 模块 | 方法签名 | 说明 |
|------|---------|------|
| `HistoryService` | `constructor(store: ElectronStore)` | 注入 store 实例 |
| | `list(search?: string): HistoryRecord[]` | 按时间倒序，search 匹配 query/sourceUrl |
| | `save(record: Omit<HistoryRecord, 'id'\|'createdAt'>): HistoryRecord` | 生成 id + createdAt，写入 store |
| | `delete(id: string): void` | 删除元数据 + rimraf 输出目录 |
| | `getOutputDir(id: string): string` | 返回 `{userData}/prd-output/{id}` |
| `ProfileService` | `constructor(store: ElectronStore)` | 注入 store 实例 |
| | `list(): Profile[]` | 返回所有配置，apiKey 已解密 |
| | `save(profile: Partial<Profile>): Profile` | 新建（无 id）或更新，apiKey 加密后存储 |
| | `delete(id: string): void` | 删除配置 |
| | `setDefault(id: string): void` | 标记默认，取消其他 isDefault |
| | `getDefault(): Profile \| null` | 返回默认配置 |
| | `encryptKey(plain: string): string` | safeStorage 加密 → base64 |
| | `decryptKey(encrypted: string): string` | base64 → safeStorage 解密 |
| `CliDetector` | `detect(): { claude: boolean, codex: boolean, opencode: boolean }` | 同步扫描 PATH（where/which） |
| | `redetect(): 同上` | 清除缓存重新扫描 |

> Adapter 修改接口

| 模块 | 变更 | 说明 |
|------|------|------|
| `createAdapter(config)` | 新增 3 个 case 分支 | `'claude-cli'` / `'codex-cli'` / `'opencode-cli'` → 构造 LocalCLIAdapter({ provider: 'local-cli', command: 'claude'/'codex'/'opencode' }) |
| `PRESET_COMMANDS` | 修正参数 | claude: `['claude', ['--bare', '-p', '{prompt}', '--output-format', 'text']]`<br>codex: `['codex', ['exec', '{prompt}', '--json', '--full-auto']]`<br>opencode: `['opencode', ['run', '{prompt}', '--format', 'json']]` |
| `LocalCLIAdapter.resolveCommand()` | 增加临时文件支持 | prompt 长度 > 32KB 时写入临时文件，将 `{prompt}` 占位符替换为文件路径引用（claude: `--prompt-file`, codex/opencode: 管道输入） |

**错误处理策略**

| 错误类型 | 处理方式 | IPC 返回 |
|---------|---------|---------|
| Axure URL 无法访问 | convert() 抛出异常，main 捕获后通过 IPC 返回错误 | `{ error: 'CONVERT_FAILED', message: '...' }` |
| LLM API 调用失败 | orchestrator 内部重试（maxRetries=3），最终失败通过 progress 事件上报 | `axure:progress { type: 'error', message }` |
| CLI 工具执行失败 | LocalCLIAdapter 抛出 stderr，main 捕获后推送错误事件 | `axure:progress { type: 'error', message: stderr }` |
| CLI 超时 | 5 分钟/页超时 kill 进程 | `axure:progress { type: 'timeout', pageName }` |
| safeStorage 不可用 | ProfileService 降级为明文存储，启动时 console.warn | 正常返回，日志告警 |
| electron-updater 失败 | 静默捕获，不影响功能 | 无 IPC 事件 |
| 配置校验失败 | ProfileService.save() 校验必填字段，抛出具体信息 | `{ error: 'VALIDATION', message: '...' }` |

#### 关键决策与理由

| 决策 | 可选方案 | 选择 | 理由 |
|------|---------|------|------|
| 桌面框架 | A: Electron / B: Tauri | Electron | 现有代码是 Node.js，Electron main process 可直接 require，Tauri 需要把 Node 逻辑移到 Rust sidecar 或重写 |
| 前端技术 | A: 纯 HTML/CSS/JS / B: React/Vue | 纯 HTML/CSS/JS | 只有 3 个页面（生成/历史/设置），无需框架。减少依赖、构建步骤和打包体积 |
| 路由方案 | A: hash-based / B: file-based | hash-based | 单 index.html，location.hash 切换页面内容，简单可靠，无需 history API |
| 配置持久化 | A: electron-store / B: 手写 JSON 文件 | electron-store | 内置原子写入、类型安全的 schema 支持、migration 能力 |
| API Key 加密 | A: safeStorage / B: keytar / C: 手动 AES | safeStorage | Electron 内置，无原生依赖编译问题，macOS 用 Keychain，Windows 用 DPAPI |
| CLI 适配器 provider 命名 | A: 复用 'local-cli' / B: 新增 'claude-cli' 等 | 新增 'claude-cli'/'codex-cli'/'opencode-cli' | Electron UI 需要区分不同 CLI 工具作为独立选项，复用 'local-cli' 需要额外传 command 参数，语义不清晰 |
| 打包工具 | A: electron-builder / B: electron-forge | electron-builder | YAML 配置简洁，GitHub Releases 原生支持 publish provider，社区成熟 |
| 长 prompt 传递 | A: 临时文件 / B: stdin 管道 | 临时文件 | Windows cmd 参数长度限制 8191 字符，stdin 管道在 spawn shell: true 时行为不一致，临时文件最可靠 |
| 生成会话管理 | A: 内存 Map / B: 全局变量 | 内存 Map（sessionId → convertResult） | 支持并发安全（虽然 v1 只允许单任务），生命周期可控，GC 友好 |

#### 风险与权衡

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| electron-builder 打包后 require 路径错误 | 中 | 高 | main.js 使用 app.isPackaged + path.join 动态解析路径，不依赖 __dirname 相对路径 |
| safeStorage 在某些 Linux（如 headless）不可用 | 低 | 低 | ProfileService 降级明文 + console.warn，且不做 Linux 构建 |
| CLI 工具版本差异导致参数不兼容 | 中 | 中 | PRESET_COMMANDS 基于 librarian 调研的稳定参数，首次使用时验证（执行 `--version` 确认工具存在） |
| electron-store 数据文件损坏 | 低 | 中 | electron-store 内置 serialize/deserialize 保护，异常时重建空 store |

#### 变更文件清单

| 文件路径 | 操作 | 变更说明 |
|---------|------|---------|
| `app/main.js` | 新增 | Electron 主进程入口，窗口管理 + 全部 IPC handler 注册 |
| `app/preload.js` | 新增 | contextBridge 暴露 window.electronAPI |
| `app/services/history.js` | 新增 | HistoryService 类 |
| `app/services/llm-profiles.js` | 新增 | ProfileService 类 |
| `app/services/cli-detector.js` | 新增 | CliDetector 检测逻辑 |
| `app/renderer/index.html` | 新增 | SPA 入口 HTML |
| `app/renderer/styles.css` | 新增 | 全局样式（CSS 变量主题） |
| `app/renderer/app.js` | 新增 | 路由 + 全局状态 |
| `app/renderer/pages/generate.js` | 新增 | 4 步向导 UI |
| `app/renderer/pages/history.js` | 新增 | 历史列表 UI |
| `app/renderer/pages/settings.js` | 新增 | 配置管理 UI |
| `src/client/adapters/index.js` | 修改 | 新增 claude-cli/codex-cli/opencode-cli 分支 |
| `src/client/adapters/local-cli.js` | 修改 | 修正 PRESET_COMMANDS + 临时文件支持 |
| `package.json` | 修改 | 新增 electron/electron-builder/electron-store/electron-updater 依赖 + scripts |
| `electron-builder.yml` | 新增 | 打包配置 |
| `.github/workflows/release.yml` | 新增 | CI/CD 配置 |
| `build/icon.ico` | 新增 | Windows 图标 |
| `build/icon.icns` | 新增 | macOS 图标 |

### How

#### 任务拆分

| 任务名称 | 详细描述 | 关联设计章节 | 计划工作量(人天) |
|----------|---------|------------|--------------|
| 【基础】项目初始化 | 1. `npm install electron electron-builder electron-store electron-updater --save-dev`（electron/electron-builder 为 devDeps，electron-store/electron-updater 为 deps）<br>2. 创建 `app/main.js`：BrowserWindow 创建（800×600 min），加载 index.html，dev 模式打开 DevTools<br>3. 创建 `app/preload.js`：contextBridge 暴露空 API 骨架<br>4. 创建 `app/renderer/index.html`：基础 HTML 结构<br>5. `package.json` 添加 `"electron:dev": "electron app/main.js"` script<br>6. 验证 `npm run electron:dev` 启动显示空窗口 | 架构决策 | 0.5 |
| 【适配器】CLI 工具修正 + provider 扩展 | 1. 修改 `local-cli.js` PRESET_COMMANDS 为调研确认的参数格式<br>2. `resolveCommand()` 增加临时文件逻辑：prompt 字节 > 32KB 时写入 os.tmpdir() 临时 .txt，替换 `{prompt}` 为文件路径引用（claude 用 `cat file \| claude --bare`，codex/opencode 类似）<br>3. 修改 `adapters/index.js` 新增 `'claude-cli'`/`'codex-cli'`/`'opencode-cli'` case，构造 LocalCLIAdapter 并注入 command<br>4. 处理 `{model}` 占位符可选：CLI 模式不传 model 时不抛异常 | 接口定义 - Adapter 修改 | 0.5 |
| 【服务】CLI 检测 | 1. 创建 `app/services/cli-detector.js`<br>2. 实现 `detect()`：Windows 用 `where claude`（exitCode 0=存在），macOS 用 `which claude`，同理 codex/opencode<br>3. 缓存结果，`redetect()` 清除缓存重新执行<br>4. 返回 `{ claude: boolean, codex: boolean, opencode: boolean }` | 接口定义 - Services | 0.5 |
| 【服务】LLM 配置管理 | 1. 创建 `app/services/llm-profiles.js`<br>2. 实现 ProfileService 类：list/save/delete/setDefault/getDefault<br>3. save 时调用 `safeStorage.encryptString(apiKey)` → Buffer.toString('base64') 存储<br>4. list 时调用 `safeStorage.decryptString(Buffer.from(encrypted, 'base64'))` 解密<br>5. 降级处理：`safeStorage.isEncryptionAvailable()` 为 false 时明文存储 + warn<br>6. 校验：name/provider/model 必填，baseUrl 格式校验 | 接口定义 - Services, 数据模型 | 0.5 |
| 【服务】历史记录管理 | 1. 创建 `app/services/history.js`<br>2. 实现 HistoryService 类：list/save/delete/getOutputDir<br>3. save 自动生成 UUID id + createdAt 时间戳<br>4. list 支持 search 参数：匹配 query 和 sourceUrl（大小写不敏感）<br>5. delete 同时 rm -rf 输出目录（`{userData}/prd-output/{id}/`）<br>6. list 按 createdAt 倒序排列 | 接口定义 - Services, 数据模型 | 0.5 |
| 【IPC】主进程 IPC handler 注册 | 1. `app/main.js` 中注册全部 IPC handler（参照接口定义表）<br>2. 生成流程：`axure:convert` → 调用 convert()，结果存入 sessions Map（sessionId → convertResult）<br>3. `axure:select-pages` → 从 sessions 取 convertResult，构造 prdConfig 调用 selectPages()<br>4. `axure:generate` → 调用 orchestrate()，通过 `win.webContents.send('axure:progress', event)` 推送进度<br>5. `axure:cancel` → 标记 abort flag，让当前 orchestrate 循环提前退出<br>6. 配置/历史/CLI 的 IPC handler 直接代理对应 Service 方法<br>7. `app/preload.js` 完善 contextBridge API：每个 channel 对应一个函数 | 架构决策, 接口定义 | 1 |
| 【UI】页面框架与路由 | 1. `app/renderer/styles.css`：CSS 变量定义（颜色/间距/字体），侧边栏 + 内容区 flex 布局<br>2. `app/renderer/app.js`：hash-based 路由（`#generate` / `#history` / `#settings`），默认 `#generate`<br>3. 侧边栏组件（3 个导航项 + 底部引擎状态指示器）<br>4. 三个页面骨架模块 export `{ mount, unmount }` 接口 | 架构决策 - 路由方案 | 0.5 |
| 【UI】生成向导页 | 1. Step1：URL 输入框 + 「解析」按钮，调用 `electronAPI.convert(source)`，展示解析结果（页面数量）<br>2. Step2：引擎选择 radio（API 模式 / CLI 模式），API 模式展示配置下拉菜单，CLI 模式展示可用工具列表<br>3. Step3：需求输入 textarea + 「AI 筛选」按钮，调用 selectPages()，展示 checkbox 列表供确认<br>4. Step4：进度条（current/total）+ 当前页名 + 流式文本预览区（monospace），监听 `axure:progress` 事件<br>5. 完成态：统计摘要 + 「打开输出目录」+ 「查看历史」按钮<br>6. 步骤导航条（Step 1→2→3→4），不可跳步，可回退 | 接口定义 - IPC | 1.5 |
| 【UI】设置页 | 1. LLM 配置列表：卡片式展示，每卡显示 name/provider/model/★默认标记<br>2. 新建/编辑弹窗表单：name、provider 下拉、baseUrl、apiKey（type=password）、model<br>3. 操作按钮：编辑/删除/设为默认<br>4. 删除确认对话框<br>5. CLI 工具检测区域：三行（claude/codex/opencode）各显示 ✅/❌ + 「重新检测」按钮 | 接口定义 - IPC | 0.5 |
| 【UI】历史页 | 1. 搜索框 + 列表（按时间倒序）<br>2. 每条记录：时间、query 摘要（截断 50 字）、源 URL、页面数<br>3. 操作按钮：打开输出目录、重新生成、删除<br>4. 删除确认对话框<br>5. 重新生成：跳转 `#generate` 并预填 URL + query + 引擎配置<br>6. 搜索实时过滤（onInput debounce 300ms） | 接口定义 - IPC | 0.5 |
| 【CI/CD】打包配置 + GitHub Actions | 1. 创建 `electron-builder.yml`：appId、productName、mac（target: dmg）、win（target: nsis）、publish（provider: github）<br>2. 创建 `.github/workflows/release.yml`：on push tags v*，matrix [macos-latest, windows-latest]，npm ci → npm run dist<br>3. package.json 添加 `"dist": "electron-builder"` script<br>4. 创建占位图标 `build/icon.ico` + `build/icon.icns` | 架构决策 - 打包 | 0.5 |
| 【更新】electron-updater 集成 | 1. main.js 中 app.whenReady() 后调用 `autoUpdater.checkForUpdatesAndNotify()`<br>2. 监听 update-downloaded 事件，通过 dialog.showMessageBox 提示重启<br>3. 错误静默捕获（autoUpdater.on('error', () => {})） | — | 0.5 |
| 【联调】端到端验证 | 1. `npm run electron:dev` 启动，完整向导流程（URL → 引擎 → 需求 → 生成）<br>2. API 模式：使用已保存配置生成 PRD<br>3. CLI 模式：选择 claude 工具生成<br>4. 历史页：验证自动存档、搜索、打开目录、重新生成、删除<br>5. 设置页：新建/编辑/删除配置、切换默认、CLI 检测<br>6. `npm run dist` 本地构建验证 | — | 1 |
| **合计** | | | **8.5** |

**任务依赖：**

```
- 【基础】项目初始化
- 【适配器】CLI 工具修正 + provider 扩展
- 【服务】CLI 检测 ← depends: 【基础】
- 【服务】LLM 配置管理 ← depends: 【基础】
- 【服务】历史记录管理 ← depends: 【基础】
- 【IPC】主进程 IPC handler 注册 ← depends: 【基础】【服务】*3 【适配器】
- 【UI】页面框架与路由 ← depends: 【基础】
- 【UI】生成向导页 ← depends: 【UI 框架】【IPC】
- 【UI】设置页 ← depends: 【UI 框架】【IPC】
- 【UI】历史页 ← depends: 【UI 框架】【IPC】
- 【CI/CD】打包配置 ← depends: 【基础】
- 【更新】electron-updater ← depends: 【基础】
- 【联调】端到端验证 ← depends: 全部
```

### Verify

设计自检：
- [x] 所有 spec 功能需求都有对应的技术方案（13 项功能 → 架构模块 + IPC 接口全覆盖）
- [x] 所有技术决策都有理由（9 个关键决策全部记录）
- [x] 接口定义完整（15 个 IPC channel + 3 个 Service 类的方法签名，含入参/出参）
- [x] 数据模型变更明确（2 个 store 结构，字段级定义）
- [x] 任务拆分覆盖全部设计内容（13 个任务关联到设计章节）
- [x] 任务总量与需求规模匹配（8.5 人天，合理）
- [x] 无实现代码（只有签名和结构）
- [x] 风险与权衡已评估（4 项风险 + 缓解措施）

### Impact

- **app/**（新增）：Electron 应用全部代码，15 个新文件
- **src/client/adapters/index.js**（修改）：新增 3 个 provider case
- **src/client/adapters/local-cli.js**（修改）：修正 PRESET_COMMANDS + 临时文件支持
- **package.json**（修改）：4 个新依赖 + 2 个新 script
- **.github/workflows/release.yml**（新增）：CI/CD
- **electron-builder.yml**（新增）：打包配置
- 外部依赖变更：是，新增 electron、electron-builder、electron-store、electron-updater
