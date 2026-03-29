# Axure-to-Markdown 解析器 v2.0

将 Axure RP 发布的 **在线/本地** HTML 原型自动转换为结构化 Markdown 文档，让 AI 能理解你的产品设计。

## 它能提取什么？

| 信息类型 | 来源 | 说明 |
|---------|------|------|
| 页面结构（站点地图） | `document.js` | 页面层级、Sprint 文件夹结构 |
| 组件文字内容 | `.html` 文件 | 标题、段落、按钮文字、表单标签等 |
| 组件样式类型 | `.html` class | 一级标题、二级标题、文本段落等 |
| 组件标签名 | `data.js` | 产品经理给组件起的名字 |
| 页面/组件注释 | `data.js` | Notes、Annotation 字段 |
| 交互逻辑 | `data.js` | 点击跳转、显示隐藏、条件判断等 |

## 快速开始

### 1. 安装依赖

```bash
cd axure-to-markdown
npm install
```

### 2. 运行

```bash
# 在线模式 —— 直接抓取在线原型（推荐）
node index.js https://sharecloud.seeyoncloud.com/1HREH3
node index.js https://xxxxx.axshare.com/XXXXX

# 指定输出目录
node index.js https://sharecloud.seeyoncloud.com/1HREH3 ./my-prd-docs

# 本地模式 —— 读取 Axure 导出的 HTML 目录
node index.js D:\my-prototype
node index.js D:\my-prototype D:\prd-docs
```

### 3. 查看输出

```
axure-prd-output/
├── index.md                           # 总览：页面目录 + 统计
├── 场景1-产品组合推荐与报价辅助.md      # 每个页面一个文件
├── 场景2-商机挖掘.md
├── 需求&场景.md
└── ...
```

## 真实输出示例

以下是从 `https://sharecloud.seeyoncloud.com/1HREH3` 提取的真实结果：

### index.md（总览）

```markdown
# 产品原型文档

> 自动提取自 Axure 原型: https://sharecloud.seeyoncloud.com/1HREH3

## 页面目录

- [sprint1 / 场景1-产品组合推荐与报价辅助](./场景1-产品组合推荐与报价辅助.md) (15组件)
- [sprint1 / 场景2-商机挖掘](./场景2-商机挖掘.md) (4组件)
- [sprint3 / 审批意见总结智能体 / 设计-运行态](./设计-运行态.md) (92组件)
...

## 统计
| 指标 | 数量 |
|------|------|
| 页面数 | 27 |
| 组件数 | 1075 |
```

### 场景2-商机挖掘.md（单页）

```markdown
# 场景2-商机挖掘

**路径:** sprint1 / 场景2-商机挖掘

## 页面内容

**[一级标题]**
商机挖掘

**[文本段落]**
销售/销管/区域负责人

**[文本段落]**
对于当前客户，可以点击【商机挖掘】，可以在全量的客户成交案例中...

**[文本段落]**
AI按钮-数据展示：（仅做基于签约合同，推荐类似客户案例）
依赖数据源
【订单】
基础信息：使用客户，使用客户唯一标识
产品信息：主产品、产品版本（主）、移动产品...
```

## 配置选项

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

**关键技术挑战：** Axure 的 JS 文件使用 IIFE + 单字母变量混淆，不是标准 JSON。
本脚本通过 Node.js `vm` 模块安全执行这些 JS，捕获 `$axure.loadDocument()` / `$axure.loadCurrentPage()` 的回调数据，实现精确解析。

## 兼容性

| 环境 | 支持情况 |
|------|---------|
| Axure RP 8 | ✅ 支持 |
| Axure RP 9 | ✅ 支持 |
| Axure RP 10 | ✅ 支持 |
| axshare.com | ✅ 在线抓取 |
| seeyoncloud | ✅ 已验证 |
| 私有部署 | ✅ 只要能访问 |

## 配合 AI 使用

```
# 把输出的 .md 文件作为 AI 的上下文

"请阅读以下产品文档，帮我 Review 商机挖掘场景的业务逻辑是否有遗漏"
[粘贴 场景2-商机挖掘.md]

"基于以下 PRD，帮我生成接口文档"
[粘贴 .md]

"基于以下需求文档，生成测试用例"
[粘贴 .md]
```

## 依赖

仅两个依赖：
- `cheerio` — HTML 解析（提取文字内容）
- `glob` — 本地模式文件扫描

无需浏览器、无需 Puppeteer/Playwright。
