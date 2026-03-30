# Axure-to-Markdown 解析器 v3.0

将 Axure RP 发布的 **在线/本地** HTML 原型自动转换为结构化 Markdown 文档，并可通过 LLM 一键生成 PRD。

## 三种使用方式

### 方式一：纯解析（不需要 LLM）

将 Axure 原型解析为结构化 Markdown，供人工阅读或喂给 AI。

```bash
# 在线模式 —— 直接抓取在线原型
node index.js https://sharecloud.seeyoncloud.com/1HREH3

# 指定输出目录
node index.js https://sharecloud.xxxxxxx ./my-docs

# 本地模式 —— 读取 Axure 导出的 HTML 目录
node index.js D:\my-prototype
```

输出结构：

```
axure-prd-output/
├── index.md          # 总览：页面目录 + 统计
├── 场景1.md          # 每个页面一个 Markdown 文件
├── 场景2.md
└── ...
```

### 方式二：PRD Client（CLI，LLM 驱动）

解析原型后，由 AI 筛选相关页面，逐页生成专业 PRD 文档。

```bash
# 交互模式 —— 解析后提示输入需求
node bin/axure-prd.js https://xxx.axshare.com/demo \
  --provider openai \
  --base-url=http://localhost:8317/v1 \
  --api-key=your-key \
  --model gpt-4o \
  -o ./prd-output

# 非交互模式 —— 通过 --query 直接指定需求
node bin/axure-prd.js https://xxx.axshare.com/demo \
  --provider openai \
  --base-url=http://localhost:8317/v1 \
  --api-key=your-key \
  --model gpt-4o \
  --query="AI控件的详细设计" \
  -o ./prd-output
```

#### PRD Client 工作流程

```
Step 1  解析 Axure 原型 → 生成 index.md（页面目录）
Step 2  展示页面目录 → 用户描述想要什么 PRD
Step 3  AI 从 index 中筛选相关页面 → 用户确认
Step 4  逐页调用 LLM 生成 PRD → 输出到文件
```

#### PRD Client 选项

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--query=TEXT` | PRD 需求描述（跳过交互提示） | 无（交互输入） |
| `--provider=NAME` | LLM 提供商：openai / anthropic / ollama / local-cli | openai |
| `--model=NAME` | 模型名称 | gpt-4o |
| `--api-key=VALUE` | API Key | 无 |
| `--base-url=URL` | 自定义 API 端点（兼容 OpenAI 协议） | 无 |
| `--template=NAME` | 提示词模板：prd / api-design / test-cases | prd |
| `-o DIR` / `--output=DIR` | 输出目录 | ./prd-output |
| `--language=LOCALE` | 输出语言 | zh-CN |
| `--max-tokens=N` | 单次 LLM 最大输出 token | 4096 |
| `--temperature=N` | 生成温度 | 0.3 |
| `--config=FILE` | YAML/JSON 配置文件 | 无 |

#### YAML 配置文件示例

```yaml
source:
  url: https://xxx.axshare.com/demo

llm:
  provider: openai
  model: gpt-4o
  apiKey: ${OPENAI_API_KEY}
  baseUrl: https://api.openai.com

output:
  dir: ./prd-output
  language: zh-CN
  template: prd
```

### 方式三：桌面客户端（Electron GUI）

为不习惯命令行的产品经理提供图形界面，4 步向导完成 PRD 生成。

#### 功能特性

- **生成向导**：输入 URL → 选择引擎 → 描述需求 → AI 生成 PRD
- **引擎模式**：
  - **API 模式**：配置 LLM API（OpenAI / Anthropic / 自定义兼容端点）
  - **CLI 模式**：直接调用本地 Claude / Codex / OpenCode（无需配置 API Key）
- **LLM 配置管理**：多配置档案，API Key 加密存储
- **历史记录**：查看 / 搜索 / 重新生成 / 删除
- **自动更新**：通过 GitHub Releases 自动检测新版本

#### 快速开始

```bash
# 开发模式运行
npm run electron:dev

# 打包构建（当前平台）
npm run dist
```

#### CI/CD 自动构建

推送 `v*` 标签自动触发 GitHub Actions 构建，同时产出 macOS (.dmg) 和 Windows (.exe) 安装包：

```bash
# 打标签触发 Release
git tag v1.0.0
git push origin v1.0.0
```

构建产物自动上传到 GitHub Releases，客户端内置 electron-updater 会自动检测并提示更新。

#### 桌面客户端架构

```
app/
├── main.js               # Electron 主进程（IPC handler + 服务初始化）
├── preload.js             # contextBridge（渲染进程 API）
├── services/
│   ├── cli-detector.js    # CLI 工具检测（claude/codex/opencode）
│   ├── llm-profiles.js    # LLM 配置管理（加密存储）
│   └── history.js         # 历史记录管理
└── renderer/
    ├── index.html         # SPA 入口
    ├── styles.css          # 暗色主题样式
    ├── app.js             # hash 路由
    └── pages/
        ├── generate.js    # 4 步生成向导
        ├── settings.js    # LLM / CLI 设置
        └── history.js     # 历史记录
```

## 提取能力

| 信息类型 | 来源 | 说明 |
|---------|------|------|
| 页面结构（站点地图） | `document.js` | 页面层级、Sprint 文件夹结构 |
| 组件文字内容 | `.html` 文件 | 标题、段落、按钮文字、表单标签等 |
| 组件样式类型 | `.html` class | 一级标题、二级标题、文本段落等 |
| 组件标签名 | `data.js` | 产品经理给组件起的名字 |
| 页面/组件注释 | `data.js` | Notes、Annotation 字段 |
| 交互逻辑 | `data.js` | 点击跳转、显示隐藏、条件判断等 |
| 截图 | `.html` 页面截图 | 内嵌到 Markdown |

## 安装

```bash
git clone https://github.com/Siwash/axure-to-markdown.git
cd axure-to-markdown
npm install
```

## 配置选项（纯解析模式）

编辑 `index.js` 顶部的 `CONFIG` 对象：

```javascript
const CONFIG = {
  extractText: true,          // 提取组件文字内容
  extractAnnotations: true,   // 提取注释
  extractInteractions: true,  // 提取交互逻辑
  extractWidgetLabels: true,  // 提取组件标签名
  extractPageNotes: true,     // 提取页面级备注
  minTextLength: 1,           // 最短文本长度过滤
  singleFile: false,          // true=所有页面合并为一个文件
  concurrency: 3,             // 在线模式并发数
  requestDelay: 200,          // 请求间隔(ms)
  requestTimeout: 15000,      // 请求超时(ms)
};
```

## 技术原理

Axure 发布的 HTML 原型核心由三部分组成：

```
data/document.js     → 站点地图（页面树结构）
files/页面名/data.js  → 组件元数据（标签、注释、交互）
页面名.html           → 渲染后的 DOM（文字内容）
```

Axure 的 JS 文件使用 IIFE + 单字母变量混淆，不是标准 JSON。
通过 Node.js `vm` 模块安全执行这些 JS，捕获 `$axure.loadDocument()` / `$axure.loadCurrentPage()` 的回调数据，实现精确解析。

## 项目结构

```
├── index.js                  # 纯解析 CLI 入口
├── bin/axure-prd.js          # PRD Client CLI 入口
├── app/                      # Electron 桌面客户端
│   ├── main.js               # 主进程
│   ├── preload.js            # preload 脚本
│   ├── services/             # 后端服务
│   └── renderer/             # 前端页面
├── src/
│   ├── api.js                # 编程式 API
│   ├── config.js             # 基础配置
│   ├── readers.js            # 在线/本地文件读取
│   ├── parser.js             # Axure 数据解析
│   ├── generator.js          # Markdown 生成
│   ├── extractors.js         # 组件提取器
│   ├── axure-vm.js           # Axure JS 安全执行
│   ├── images.js             # 截图处理
│   ├── utils.js              # 工具函数
│   └── client/               # PRD Client 模块
│       ├── config.js          # PRD 配置解析
│       ├── orchestrator.js    # 编排器（页面选择 + 逐页生成）
│       ├── assembler.js       # 文档组装
│       ├── token-utils.js     # Token 估算（支持 CJK）
│       ├── adapters/          # LLM 适配器
│       │   ├── index.js       # 工厂函数
│       │   ├── remote-api.js  # OpenAI/Anthropic 兼容
│       │   ├── ollama.js      # Ollama 本地
│       │   └── local-cli.js   # 本地 CLI 工具
│       └── prompts/           # 提示词模板
│           ├── prd.md         # PRD 生成
│           ├── api-design.md  # API 设计
│           ├── test-cases.md  # 测试用例
│           └── select-pages.md # 页面筛选
├── test/
│   ├── run.js                # 单元测试
│   └── e2e/                  # E2E 测试
├── build/                    # Electron 打包资源（图标）
├── electron-builder.yml      # Electron Builder 配置
├── .github/workflows/
│   └── release.yml           # CI/CD（macOS + Windows）
└── docs/
    └── design-client.md      # PRD Client 设计文档
```

## 兼容性

| 环境 | 支持情况 |
|------|---------|
| Axure RP 8/9/10 | ✅ |
| axshare.com | ✅ |
| seeyoncloud | ✅ |
| 私有部署 | ✅ 只要能访问 |

## 依赖

- `cheerio` — HTML 解析
- `glob` — 本地文件扫描
- `js-yaml` — YAML 配置解析（PRD Client）
- `electron` — 桌面客户端框架（devDependency）
- `electron-builder` — 跨平台打包（devDependency）
- `electron-store` — 本地数据持久化
- `electron-updater` — 自动更新

无需浏览器、无需 Puppeteer/Playwright（CLI 模式）。

## License

MIT
