// 主进程入口 by AI.Coding
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn, execSync } = require('child_process');
const Store = require('electron-store').default || require('electron-store');
const { convert } = require('../src/api');
const { buildConfig, PRD_DEFAULTS } = require('../src/client/config');
const { selectPages, orchestrate } = require('../src/client/orchestrator');
const { createAdapter } = require('../src/client/adapters');
const { ProfileService } = require('./services/llm-profiles');
const { HistoryService } = require('./services/history');
const { CliDetector } = require('./services/cli-detector');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// macOS GUI 应用不继承终端 PATH，通过 login shell 获取完整 PATH
// 确保 CLI 工具检测和 spawn 调用都能正常工作
if (process.platform === 'darwin') {
  try {
    const userShell = process.env.SHELL || '/bin/zsh';
    const fullPath = execSync(`${userShell} -lc "echo \\$PATH"`, {
      encoding: 'utf8',
      timeout: 5000,
    }).trim();
    if (fullPath) {
      process.env.PATH = fullPath;
    }
  } catch { /* keep original PATH if shell fails */ }
}

const SETTINGS_OUTPUT_DIR_KEY = 'settings.outputDir';
const HISTORY_STORE_KEY = 'history';

let mainWindow;

/**
 * 创建桌面主窗口 by AI.Coding
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }
}

/**
 * 统一注册 invoke 类型 IPC，并把异常转换为标准错误结构 by AI.Coding
 */
function registerIpcHandler(channel, handler) {
  ipcMain.handle(channel, async (event, payload = {}) => {
    try {
      return await handler(event, payload || {});
    } catch (error) {
      return toIpcError(error);
    }
  });
}

/**
 * 将运行时异常转换为渲染进程可直接消费的错误对象 by AI.Coding
 */
function toIpcError(error) {
  return {
    error: error && (error.code || error.error) ? (error.code || error.error) : 'ERROR_CODE',
    message: error && error.message ? error.message : 'Unknown error',
  };
}

/**
 * 创建带错误码的异常，避免各个 handler 手写重复格式 by AI.Coding
 */
function createIpcError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/**
 * 统计 convertResult 中的页面数量 by AI.Coding
 */
function countPages(convertResult) {
  if (convertResult && convertResult.sitemap && Array.isArray(convertResult.sitemap.pages)) {
    return convertResult.sitemap.pages.length;
  }

  if (convertResult && Array.isArray(convertResult.pages)) {
    return convertResult.pages.length;
  }

  return 0;
}

/**
 * 根据 sessionId 获取已缓存的解析会话 by AI.Coding
 */
function getSession(sessions, sessionId) {
  const session = sessions.get(sessionId);
  if (!session) {
    throw createIpcError('SESSION_NOT_FOUND', '未找到对应的解析会话，请重新解析原型');
  }

  return session;
}

/**
 * 从 store 读取自定义输出目录；空字符串代表继续走默认策略 by AI.Coding
 */
function getConfiguredOutputDir(store) {
  const rawValue = store.get(SETTINGS_OUTPUT_DIR_KEY);
  return String(rawValue || '').trim();
}

/**
 * 保存自定义输出目录配置，并统一规范为绝对路径或空值 by AI.Coding
 */
function setConfiguredOutputDir(store, outputDir) {
  const normalized = String(outputDir || '').trim();
  store.set(SETTINGS_OUTPUT_DIR_KEY, normalized ? path.resolve(normalized) : '');
}

/**
 * 为每次解析生成独立临时目录，便于打开目录与 CLI 复用原始索引 by AI.Coding
 */
function getParsedOutputDir(sessionId) {
  return path.join(app.getPath('temp'), 'axure-to-markdown', 'parsed', sessionId);
}

/**
 * 将解析得到的全量 markdown 写入临时目录：index.md + 每个页面的独立 .md by AI.Coding
 */
function writeParsedArtifacts(parsedDir, indexContent, convertResult) {
  fs.mkdirSync(parsedDir, { recursive: true });
  fs.writeFileSync(path.join(parsedDir, 'index.md'), indexContent, 'utf-8');

  // write per-page markdown files (mirroring CLI index.js behavior)
  if (convertResult && Array.isArray(convertResult.pages) && convertResult.filenameMap) {
    for (const page of convertResult.pages) {
      try {
        const md = convertResult.generatePage(page);
        const safeName = convertResult.filenameMap.get(page.pageName);
        if (safeName && md) {
          fs.writeFileSync(path.join(parsedDir, `${safeName}.md`), md, 'utf-8');
        }
      } catch (_e) {
        // skip pages that fail to generate — index.md still usable
      }
    }
  }
}

/**
 * 根据设置计算本次生成的实际输出目录，自定义目录下仍按 historyId 分桶 by AI.Coding
 */
function resolveGenerationOutputDir(historyService, store, historyId) {
  const configuredOutputDir = getConfiguredOutputDir(store);
  if (!configuredOutputDir) {
    return historyService.getOutputDir(historyId);
  }

  return path.join(path.resolve(configuredOutputDir), historyId);
}

/**
 * 更新 store 中的历史输出目录，避免 HistoryService 默认目录覆盖自定义目录 by AI.Coding
 */
function updateStoredHistoryOutputDir(store, id, outputDir) {
  const records = store.get(HISTORY_STORE_KEY);
  if (!Array.isArray(records)) return;

  const nextRecords = records.map(record => {
    if (!record || record.id !== id) {
      return record;
    }

    return {
      ...record,
      outputDir,
    };
  });

  store.set(HISTORY_STORE_KEY, nextRecords);
}

/**
 * 从历史记录 store 中解析真实输出目录，优先尊重自定义目录 by AI.Coding
 */
function getHistoryOutputDir(store, historyService, id) {
  const records = store.get(HISTORY_STORE_KEY);
  if (Array.isArray(records)) {
    const target = records.find(record => record && record.id === id);
    if (target && target.outputDir) {
      return target.outputDir;
    }
  }

  return historyService.getOutputDir(id);
}

/**
 * 解析渲染进程发来的引擎配置，转换为 orchestrator 所需格式 by AI.Coding
 */
function resolveEngineConfig(profileService, engineConfig) {
  if (!engineConfig || !engineConfig.mode) {
    if (engineConfig && engineConfig.provider) {
      return { ...engineConfig };
    }

    const defaultProfile = profileService.getDefault();
    if (defaultProfile) {
      return defaultProfile;
    }

    throw createIpcError('VALIDATION', '未提供引擎配置，且当前没有默认 LLM 配置');
  }

  if (engineConfig.mode === 'cli') {
    const cliTool = engineConfig.cliTool;
    if (!cliTool) {
      throw createIpcError('VALIDATION', '未选择 CLI 工具');
    }
    return { provider: `${cliTool}-cli` };
  }

  if (engineConfig.profileId) {
    const profiles = profileService.list();
    const profile = profiles.find(item => item.id === engineConfig.profileId);
    if (!profile) {
      throw createIpcError('VALIDATION', '未找到所选 LLM 配置，请检查设置');
    }
    return { ...profile };
  }

  const defaultProfile = profileService.getDefault();
  if (defaultProfile) {
    return defaultProfile;
  }

  throw createIpcError('VALIDATION', '未选择 API 配置，且当前没有默认 LLM 配置');
}

/**
 * 组装传给 orchestrator 的 PRD 配置，并校验 provider 合法性 by AI.Coding
 */
function buildPrdRuntimeConfig(profileService, engineConfig, options = {}) {
  const baseline = buildConfig(['node', 'electron']).prdConfig;
  const resolvedEngine = resolveEngineConfig(profileService, engineConfig);
  const prdConfig = {
    ...PRD_DEFAULTS,
    ...baseline,
    ...resolvedEngine,
  };

  if (options.query !== undefined) {
    prdConfig.query = options.query;
  }

  if (options.outputDir) {
    prdConfig.outputDir = options.outputDir;
  }

  createAdapter(prdConfig);
  return prdConfig;
}

/**
 * 规范化页面列表，保证生成阶段始终拿到稳定数组 by AI.Coding
 */
function normalizeSelectedPages(selectedPages) {
  if (!Array.isArray(selectedPages)) {
    return [];
  }

  return selectedPages
    .map(item => String(item || '').trim())
    .filter(Boolean);
}

/**
 * 推送生成进度到渲染进程，窗口不存在时静默忽略 by AI.Coding
 */
function sendProgress(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send('axure:progress', payload);
}

/**
 * 将 PRD 结果写入输出目录：index.md + prd-output.md by AI.Coding
 */
function writeGenerationOutputs(outputDir, templateName, indexContent, documentContent) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'index.md'), indexContent, 'utf-8');

  if (documentContent) {
    fs.writeFileSync(path.join(outputDir, `${templateName || 'prd'}-output.md`), documentContent, 'utf-8');
  }
}

/**
 * 推断历史记录中的引擎类型与展示名称 by AI.Coding
 */
function resolveEngineMeta(engineConfig) {
  const provider = String((engineConfig && engineConfig.provider) || '').trim();
  if (provider.endsWith('-cli') || provider === 'local-cli') {
    return {
      engineType: 'cli',
      engineName: provider || 'local-cli',
    };
  }

  return {
    engineType: 'api',
    engineName: (engineConfig && engineConfig.name) || provider || 'unknown',
  };
}

/**
 * 构建 CLI 模式的完整提示词：模板 + 用户需求 + 解析目录文件引导 by AI.Coding
 */
function buildCliFullPrompt(parsedDir, query, selectedPages) {
  const pagesHint = Array.isArray(selectedPages) && selectedPages.length > 0
    ? selectedPages.map(p => `- ${p}`).join('\n')
    : '- 所有页面';

  // list actual .md files in parsedDir for reference
  let fileList = '';
  try {
    const files = fs.readdirSync(parsedDir).filter(f => f.endsWith('.md'));
    fileList = files.map(f => `- ${f}`).join('\n');
  } catch (_e) {
    fileList = '- (未能读取目录)';
  }

  return [
    '你是资深产品经理。我已将 Axure 原型解析为结构化 Markdown 文件，请基于这些文件为我生成 PRD（产品需求文档）。',
    '',
    '## 解析文件目录',
    '',
    `路径: ${parsedDir}`,
    '',
    '文件列表:',
    fileList,
    '',
    '## 用户需求',
    '',
    query || '请分析以上页面并生成完整 PRD',
    '',
    '## 需要分析的页面',
    '',
    pagesHint,
    '',
    '## 输出要求',
    '',
    '1. 请先阅读上述目录中的 index.md 了解整体页面结构',
    '2. 再阅读对应页面的 .md 文件获取详细结构信息',
    '3. 为每个相关页面输出 PRD 章节，包含：',
    '   - 功能概述（一段话描述本页面的核心功能）',
    '   - 用户故事（作为...我想要...以便...）',
    '   - 功能需求清单（编号列表，每条需求包含描述和验收标准）',
    '   - 表单字段说明（如有表单：字段名、类型、校验规则、默认值）',
    '   - 交互逻辑说明（状态流转、条件判断、页面跳转）',
    '   - 与其他页面的关联关系',
    '4. 使用 Markdown 格式、中文输出',
    '5. 仅基于提供的原型信息，不要编造不存在的功能',
  ].join('\n');
}

/**
 * 生成 CLI 命令字符串（引用 prompt 文件），用于系统终端执行 by AI.Coding
 */
function buildCliCommand(cliTool, promptFilePath) {
  if (cliTool === 'codex') {
    return `codex exec --skip-git-repo-check -q @"${promptFilePath}" --json --full-auto`;
  }
  if (cliTool === 'opencode') {
    return `opencode run "$(cat '${promptFilePath.replace(/'/g, "'\\''")}'" --format json`;
  }
  // claude supports -p with file reference
  return `${cliTool} -p "$(cat '${promptFilePath.replace(/'/g, "'\\''")}')"`;
}

/**
 * 将路径转为命令行可用的引号字符串，降低空格路径执行失败概率 by AI.Coding
 */
function quotePath(targetPath) {
  return `"${String(targetPath || '').replace(/"/g, '\\"')}"`;
}

/**
 * 根据平台启动系统终端，并在解析目录中执行 CLI 命令 by AI.Coding
 * Windows: 生成临时 .bat 避免 cmd.exe 嵌套引号语法错误
 */
function launchSystemTerminal(parsedDir, command) {
  if (process.platform === 'win32') {
    // write a temp .bat file to avoid nested quoting issues with cmd.exe /c start /K
    const batContent = `@echo off\r\ncd /d "${parsedDir}"\r\n${command}\r\npause\r\n`;
    const batPath = path.join(parsedDir, '_run_cli.bat');
    fs.writeFileSync(batPath, batContent, 'utf-8');

    const child = spawn('cmd.exe', ['/c', 'start', 'cmd.exe', '/K', batPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    return;
  }

  if (process.platform === 'darwin') {
    const escapedDir = String(parsedDir).replace(/'/g, "'\\''");
    const script = `tell application "Terminal" to do script "cd '${escapedDir}' && ${command}"`;
    const child = spawn('osascript', ['-e', script], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return;
  }

  const child = spawn('x-terminal-emulator', ['-e', 'bash', '-lc', `cd ${quotePath(parsedDir)} && ${command}`], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

/**
 * 全量模式：一次性将所有选中页面素材交给 LLM 生成完整 PRD by AI.Coding
 */
async function generatePrdPages(session, prdConfig, selectedPages) {
  const normalizedPages = normalizeSelectedPages(selectedPages);
  const total = normalizedPages.length;

  if (session.aborted) {
    sendProgress({ type: 'cancelled', sessionId: session.id, current: 0, total });
    throw new Error('已取消生成');
  }

  sendProgress({ type: 'generate-start', current: 0, total });

  const result = await orchestrate(session.convertResult, prdConfig, {
    selectedPages: normalizedPages,
    callbacks: {
      onProgress(progress) {
        sendProgress({ type: 'orchestrate-progress', current: 0, total, ...progress });
      },
      onGenerateStart() {
        sendProgress({ type: 'generate-start', current: 0, total });
      },
      onChunk(_label, chunk) {
        if (session.aborted) return;
        sendProgress({ type: 'chunk', chunk, current: 0, total });
      },
      onGenerateComplete() {
        sendProgress({ type: 'generate-complete', current: total, total });
      },
    },
  });

  return {
    document: result.document,
    pageOutputs: result.pageOutputs,
    stats: {
      totalPages: countPages(session.convertResult),
      selectedPages: total,
      processedPages: result.stats.processedPages,
    },
  };
}

app.whenReady().then(() => {
  const store = new Store();
  const profileService = new ProfileService(store);
  const historyService = new HistoryService(store, app.getPath('userData'));
  const cliDetector = new CliDetector();
  const sessions = new Map();

  registerIpcHandler('axure:convert', async (_event, payload) => {
    if (!payload.source) {
      throw createIpcError('VALIDATION', 'source 不能为空');
    }

    try {
      const convertResult = await convert(payload.source);
      const sessionId = crypto.randomUUID();
      const indexContent = convertResult.generateIndex();
      const parsedDir = getParsedOutputDir(sessionId);
      writeParsedArtifacts(parsedDir, indexContent, convertResult);

      sessions.set(sessionId, {
        id: sessionId,
        source: payload.source,
        convertResult,
        indexContent,
        parsedDir,
        aborted: false,
      });

      const sitemapPages = convertResult.sitemap && Array.isArray(convertResult.sitemap.pages)
        ? convertResult.sitemap.pages
        : [];
      const pageList = sitemapPages.map((item, idx) => ({
        id: item.pageName || item.name || `page-${idx}`,
        name: item.pageName || item.name || `未命名页面 ${idx + 1}`,
        path: item.path || item.pageName || '',
      }));

      return {
        sessionId,
        sitemap: convertResult.sitemap,
        pages: pageList,
        pageCount: pageList.length,
        indexContent,
        parsedDir,
      };
    } catch (error) {
      error.code = error.code || 'CONVERT_FAILED';
      throw error;
    }
  });

  registerIpcHandler('axure:open-parsed-dir', async (_event, payload) => {
    const session = getSession(sessions, payload.sessionId);
    const errorMessage = await shell.openPath(session.parsedDir);
    if (errorMessage) {
      throw createIpcError('OPEN_DIR_FAILED', errorMessage);
    }
    return { ok: true };
  });

  registerIpcHandler('axure:select-pages', async (_event, payload) => {
    if (!payload.query || !String(payload.query).trim()) {
      throw createIpcError('VALIDATION', 'query 不能为空');
    }

    const session = getSession(sessions, payload.sessionId);
    const prdConfig = buildPrdRuntimeConfig(profileService, payload.engineConfig, {
      query: payload.query,
    });

    return selectPages(session.convertResult, payload.query, prdConfig);
  });

  registerIpcHandler('axure:generate', async (_event, payload) => {
    const session = getSession(sessions, payload.sessionId);
    const selectedPages = normalizeSelectedPages(payload.selectedPages);
    if (selectedPages.length === 0) {
      throw createIpcError('VALIDATION', 'selectedPages 不能为空');
    }

    const startedAt = Date.now();
    const historyId = crypto.randomUUID();
    const outputDir = resolveGenerationOutputDir(historyService, store, historyId);
    const prdConfig = buildPrdRuntimeConfig(profileService, payload.engineConfig, {
      outputDir,
      query: payload.query,
    });

    session.aborted = false;
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'index.md'), session.indexContent, 'utf-8');

    try {
      const generationResult = await generatePrdPages(session, prdConfig, selectedPages);
      const stats = {
        ...generationResult.stats,
        elapsedMs: Date.now() - startedAt,
      };

      writeGenerationOutputs(
        outputDir,
        prdConfig.template,
        session.indexContent,
        generationResult.document
      );

      const engineMeta = resolveEngineMeta(prdConfig);
      historyService.save({
        id: historyId,
        sourceUrl: session.source,
        query: payload.query,
        engineType: engineMeta.engineType,
        engineName: engineMeta.engineName,
        selectedPages,
        stats,
      });
      updateStoredHistoryOutputDir(store, historyId, outputDir);

      sendProgress({ type: 'done', current: stats.processedPages, total: stats.selectedPages, stats });
      return { stats, historyId, outputDir };
    } catch (error) {
      sendProgress({ type: 'error', message: error.message });
      throw error;
    }
  });

  registerIpcHandler('axure:cancel', async (_event, payload) => {
    const session = getSession(sessions, payload.sessionId);
    session.aborted = true;
    return { ok: true };
  });

  registerIpcHandler('profile:list', async () => profileService.list());
  registerIpcHandler('profile:save', async (_event, payload) => profileService.save(payload));
  registerIpcHandler('profile:delete', async (_event, payload) => {
    profileService.delete(payload.id);
    return { ok: true };
  });
  registerIpcHandler('profile:set-default', async (_event, payload) => {
    profileService.setDefault(payload.id);
    return { ok: true };
  });

  registerIpcHandler('history:list', async (_event, payload) => historyService.list(payload.search));
  registerIpcHandler('history:delete', async (_event, payload) => {
    historyService.delete(payload.id);
    return { ok: true };
  });
  registerIpcHandler('history:open-dir', async (_event, payload) => {
    const targetDir = getHistoryOutputDir(store, historyService, payload.id);
    const errorMessage = await shell.openPath(targetDir);
    if (errorMessage) {
      throw createIpcError('OPEN_DIR_FAILED', errorMessage);
    }
    return { ok: true };
  });

  registerIpcHandler('settings:get-output-dir', async () => ({
    outputDir: getConfiguredOutputDir(store),
  }));
  registerIpcHandler('settings:set-output-dir', async (_event, payload) => {
    setConfiguredOutputDir(store, payload.outputDir);
    return { ok: true };
  });
  registerIpcHandler('settings:select-output-dir', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: '选择输出目录',
      properties: ['openDirectory', 'createDirectory'],
    });

    return {
      outputDir: canceled || !filePaths[0] ? '' : filePaths[0],
    };
  });

  registerIpcHandler('cli:detect', async () => cliDetector.detect());
  registerIpcHandler('cli:redetect', async () => cliDetector.redetect());
  registerIpcHandler('cli:build-prompt', async (_event, payload) => {
    const session = getSession(sessions, payload.sessionId);
    const fullPrompt = buildCliFullPrompt(
      session.parsedDir,
      payload.query,
      payload.selectedPages
    );
    const promptFilePath = path.join(session.parsedDir, '_prompt.md');
    fs.writeFileSync(promptFilePath, fullPrompt, 'utf-8');
    return { fullPrompt, parsedDir: session.parsedDir, promptFilePath };
  });
  registerIpcHandler('cli:open-terminal', async (_event, payload) => {
    const session = getSession(sessions, payload.sessionId);
    const cliTool = String(payload.cliTool || '').trim();
    if (!cliTool) {
      throw createIpcError('VALIDATION', 'cliTool 不能为空');
    }

    // build full prompt and write to file
    const fullPrompt = buildCliFullPrompt(
      session.parsedDir,
      payload.query,
      payload.selectedPages
    );
    const promptFilePath = path.join(session.parsedDir, '_prompt.md');
    fs.writeFileSync(promptFilePath, fullPrompt, 'utf-8');

    const command = buildCliCommand(cliTool, promptFilePath);
    launchSystemTerminal(session.parsedDir, command);
    return {
      ok: true,
      command,
      fullPrompt,
      parsedDir: session.parsedDir,
      promptFilePath,
    };
  });

  registerIpcHandler('app:info', async () => ({
    version: app.getVersion(),
    userData: app.getPath('userData'),
  }));

  createWindow();

  if (app.isPackaged) {
    autoUpdater.on('error', () => {});
    autoUpdater.on('update-downloaded', () => {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '更新就绪',
        message: '新版本已下载，重启应用即可完成更新。',
        buttons: ['立即重启', '稍后'],
      }).then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
    });
    autoUpdater.checkForUpdatesAndNotify();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
