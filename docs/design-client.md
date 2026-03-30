# Axure-to-PRD Client 设计文档

> 状态：设计阶段 | 版本：v0.1 draft
> 最后更新：2026-03-29

## 1. 背景与目标

`axure-to-markdown` v3.0 已实现 Axure 原型 → 结构化 Markdown 的自动转换。
但当前使用仍需手动：复制 Markdown → 粘贴到 AI 对话 → 逐页提问 → 拼装结果。

**目标**：提供一个客户端，配置 Axure 地址 + 大模型，一键生成完整 PRD 文档。

### 核心价值

```
Axure 在线原型 ──→ 结构化 Markdown ──→ LLM 理解 ──→ 完整 PRD
     (已有)              (已有)           (新增)        (新增)
```

把"人工喂 AI + 拼装"这一步自动化掉。

---

## 2. 用户画像与场景

| 角色 | 场景 | 痛点 |
|------|------|------|
| 产品经理 | 原型设计完成后写 PRD | 重复劳动，页面多时耗时长 |
| 技术负责人 | Review 原型并生成接口文档 | 需逐页理解原型再手写 |
| 测试工程师 | 基于原型生成测试用例 | 需求理解偏差 |

**典型工作流**：

1. 在 Axure 完成原型设计，发布到在线地址
2. 打开客户端，粘贴 Axure URL
3. 选择输出类型（PRD / 接口文档 / 测试用例）
4. 点击生成，等待完成
5. 审阅、微调、导出

---

## 3. 架构设计

### 3.1 系统分层

```
┌─────────────────────────────────────────────┐
│                  Client UI                   │
│         (CLI / Desktop / Web 三选一)          │
├─────────────────────────────────────────────┤
│               Orchestrator                   │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Axure    │  │ LLM      │  │ Output    │  │
│  │ Pipeline │  │ Pipeline │  │ Assembler │  │
│  └──────────┘  └──────────┘  └───────────┘  │
├─────────────────────────────────────────────┤
│              Core Libraries                  │
│  ┌──────────────────┐  ┌─────────────────┐  │
│  │ axure-to-markdown │  │ LLM Adapters   │  │
│  │     (现有 v3.0)   │  │ (新增)          │  │
│  └──────────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────┘
```

### 3.2 模块职责

#### Axure Pipeline（已有，微调）
- 输入：Axure URL 或本地路径
- 输出：结构化 Markdown（按页面拆分）+ 图片资源
- 调用现有 `axure-to-markdown` 核心逻辑
- 需要暴露为可编程 API（当前是 CLI 入口）

#### LLM Pipeline（新增，核心）
- 将 Markdown 按页面/模块分批送入 LLM
- 管理 prompt 模板（PRD / 接口文档 / 测试用例）
- 处理 token 限制：长页面自动拆分，短页面合并批处理
- 流式输出 + 进度回调

#### LLM Adapters（新增）
- **远程 API**：OpenAI / Claude / DeepSeek / 通义千问等
- **本地工具**：调用本地 Claude CLI / Codex CLI / OpenCode
- 统一接口，可扩展

#### Output Assembler（新增）
- 收集 LLM 各页面输出
- 按站点地图结构拼装为完整文档
- 生成目录、交叉引用、统一术语
- 输出格式：Markdown / DOCX / Confluence

---

## 4. LLM 适配层设计

### 4.1 统一接口

```javascript
/**
 * LLM adapter interface — all adapters implement this.
 */
// adapter.generate(prompt, options) → AsyncIterable<string>
//
// options:
//   model: string          — model name
//   maxTokens: number      — max output tokens
//   temperature: number    — 0-1
//   systemPrompt: string   — system instruction
```

### 4.2 适配器类型

```
LLM Adapters
├── RemoteAPIAdapter        ← OpenAI / Claude / DeepSeek 等 HTTP API
│   config: { apiKey, baseUrl, model }
│
├── LocalCLIAdapter         ← 调用本地 CLI 工具
│   ├── claude              ← claude -m ... --print
│   ├── codex               ← codex --quiet --full-auto
│   └── opencode            ← opencode exec "..."
│   config: { command, args }
│
└── OllamaAdapter           ← 本地 Ollama 模型
    config: { host, model }
```

### 4.3 本地工具调用方式

| 工具 | 调用方式 | 优势 |
|------|---------|------|
| Claude CLI | `claude -m claude-sonnet-4-20250514 -p "..." --output-format=text` | 原生 Claude，quality 最高 |
| Codex CLI | `codex --quiet --full-auto -m o4-mini "..."` | OpenAI 模型，支持 tool use |
| OpenCode | `opencode exec "..."` | 灵活配置，支持多 provider |

调用策略：`child_process.spawn` 流式读取 stdout，逐行 yield。

---

## 5. Prompt 工程

### 5.1 模板结构

```
prompts/
├── prd.md                  ← PRD 生成模板
├── api-design.md           ← 接口文档模板
├── test-cases.md           ← 测试用例模板
└── custom/                 ← 用户自定义模板
```

### 5.2 PRD 生成 prompt 设计思路

```
System: 你是资深产品经理。基于 Axure 原型提取的结构化信息，输出 PRD 文档。

Context:
- 项目名称：{projectName}
- 当前页面：{pageName}（路径：{pagePath}）
- 前后页面关系：{navigation}

Input:
{pageMarkdown}

Requirements:
1. 输出该页面的功能需求描述
2. 提取所有表单字段、校验规则
3. 描述交互逻辑和状态流转
4. 标注与其他页面的跳转关系
5. 引用原型截图（使用已有的图片路径）

Output format: Markdown，使用 ## 作为一级标题
```

### 5.3 Token 管理策略

```
单页 Markdown ──→ 估算 token 数
                    │
          ┌─────────┴──────────┐
          │                    │
     < context limit      > context limit
          │                    │
     直接发送            拆分为 chunks
          │              (按 ## 标题拆)
          │                    │
          └─────────┬──────────┘
                    │
               LLM 生成
                    │
               合并输出
```

---

## 6. 配置文件设计

```yaml
# axure-prd.config.yaml

# Axure 源
source:
  url: "https://sharecloud.seeyoncloud.com/1HREH3"
  # 或 local: "./my-prototype"

# LLM 配置
llm:
  # 方式一：远程 API
  provider: "openai"               # openai | claude | deepseek | qwen
  apiKey: "${OPENAI_API_KEY}"      # 支持环境变量引用
  model: "gpt-4o"
  baseUrl: null                    # 自定义 endpoint

  # 方式二：本地工具（与上面二选一）
  # provider: "local-cli"
  # command: "claude"
  # args: ["-m", "claude-sonnet-4-20250514", "--output-format", "text"]

# 输出配置
output:
  dir: "./prd-output"
  format: "markdown"               # markdown | docx
  template: "prd"                  # prd | api-design | test-cases | custom
  customTemplate: null             # 自定义模板路径
  language: "zh-CN"

# 高级选项
advanced:
  concurrency: 2                   # 并行处理页面数
  downloadImages: true
  includeInteractions: true
  includeAnnotations: true
  maxRetries: 3
```

---

## 7. 客户端形态评估

### 方案对比

| 维度 | CLI | Desktop (Electron) | Web |
|------|-----|-------------------|-----|
| 开发成本 | 低 | 中 | 高 |
| 用户门槛 | 高（需终端） | 低 | 低 |
| 本地工具集成 | 原生支持 | 需 IPC | 需后端 |
| 分发成本 | npm install | 安装包 | 部署服务器 |
| 适合阶段 | MVP | 成熟期 | SaaS 化 |

### 推荐路线

```
Phase 1 (MVP)     →  CLI 工具
                      npm install -g axure-to-prd
                      axure-prd https://xxx.com --model gpt-4o

Phase 2 (体验)    →  TUI (终端 UI)
                      交互式配置 + 实时进度 + 流式预览

Phase 3 (普及)    →  Desktop / Web
                      可视化配置 + 模板市场 + 团队协作
```

---

## 8. CLI MVP 设计

### 8.1 命令行接口

```bash
# 基本用法
axure-prd <axure-url> [options]

# 使用远程 API
axure-prd https://xxx.com --provider openai --model gpt-4o

# 使用本地 Claude
axure-prd https://xxx.com --provider local-cli --command claude

# 使用配置文件
axure-prd --config axure-prd.config.yaml

# 指定输出模板
axure-prd https://xxx.com --template api-design --output ./api-docs
```

### 8.2 执行流程

```
1. 解析参数 / 读取配置文件
       │
2. 调用 axure-to-markdown 核心
   ├── 解析站点地图
   ├── 逐页提取内容 + 图片
   └── 生成结构化 Markdown
       │
3. 构建 LLM 任务队列
   ├── 每页一个任务（或合并小页面）
   ├── 注入 prompt 模板 + 上下文
   └── 估算 token，必要时拆分
       │
4. 并行调用 LLM（受 concurrency 限制）
   ├── 流式输出进度
   └── 失败自动重试
       │
5. 拼装最终文档
   ├── 按站点地图顺序合并
   ├── 生成目录
   ├── 插入图片引用
   └── 统一格式
       │
6. 写入输出文件
```

### 8.3 项目结构（预期）

```
axure-to-prd/
├── bin/
│   └── cli.js                   # CLI 入口
├── src/
│   ├── config.js                # 配置解析（CLI args + yaml）
│   ├── orchestrator.js          # 主编排逻辑
│   ├── adapters/
│   │   ├── index.js             # adapter 工厂
│   │   ├── remote-api.js        # HTTP API adapter
│   │   ├── local-cli.js         # 本地 CLI adapter
│   │   └── ollama.js            # Ollama adapter
│   ├── prompts/
│   │   ├── loader.js            # prompt 模板加载
│   │   ├── prd.md
│   │   ├── api-design.md
│   │   └── test-cases.md
│   ├── assembler.js             # 输出拼装
│   └── token-utils.js           # token 估算 + 拆分
├── package.json
└── axure-to-markdown/           # git submodule 或 npm 依赖
```

---

## 9. 关键技术决策（待定）

| 决策点 | 选项 | 倾向 | 理由 |
|--------|------|------|------|
| 与 axure-to-markdown 的关系 | npm 依赖 vs monorepo | npm 依赖 | 独立迭代，版本可控 |
| 配置格式 | YAML vs JSON vs TOML | YAML | 可读性好，支持注释 |
| LLM 调用库 | 自研 vs Vercel AI SDK vs LangChain | 自研轻量封装 | 需求简单，避免重依赖 |
| 本地 CLI 调用 | spawn vs exec | spawn | 流式输出，内存安全 |
| token 估算 | tiktoken vs 简单估算 | 简单估算(chars/4) | MVP 够用，减少依赖 |
| 进度展示 | 纯文本 vs ora/chalk | ora + chalk | 体验好，成本低 |

---

## 10. 风险与约束

| 风险 | 影响 | 缓解 |
|------|------|------|
| 长页面超出 context window | 输出不完整 | 按 heading 拆分，分段发送 |
| LLM 输出不稳定（格式偏差） | 拼装困难 | 强约束 prompt + 输出校验 |
| 本地 CLI 版本差异 | 参数不兼容 | 检测版本，适配参数 |
| Axure 原型结构差异大 | 提取质量不一 | 已由 v3.0 覆盖，持续优化 |
| API 费用 | 大原型可能花费较高 | 显示 token 估算，用户确认 |

---

## 11. 里程碑（粗排）

| 阶段 | 交付物 | 预估工作量 |
|------|--------|-----------|
| M1: 核心链路 | axure-to-markdown 暴露 API + 单页 LLM 调用 | 2-3 天 |
| M2: CLI MVP | 完整 CLI，支持 OpenAI/Claude API | 2-3 天 |
| M3: 本地工具 | local-cli adapter (Claude/Codex/OpenCode) | 1-2 天 |
| M4: 模板 & 拼装 | prompt 模板系统 + 多页拼装 + 目录生成 | 2-3 天 |
| M5: 体验优化 | 进度条、流式预览、重试、配置文件 | 1-2 天 |
