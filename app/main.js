// 主进程入口 by AI.Coding
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const Store = require('electron-store').default || require('electron-store');
const { convert } = require('../src/api');
const { buildConfig, PRD_DEFAULTS } = require('../src/client/config');
const { selectPages, orchestrate } = require('../src/client/orchestrator');
const { createAdapter } = require('../src/client/adapters');
const { assemblePrd } = require('../src/client/assembler');
const { sanitizeFilename, deduplicateFilename } = require('../src/utils');
const { ProfileService } = require('./services/llm-profiles');
const { HistoryService } = require('./services/history');
const { CliDetector } = require('./services/cli-detector');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 保存主窗口实例，避免被垃圾回收后窗口关闭。
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

  // 加载渲染进程入口页面，后续任务会继续补充页面逻辑。
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // 开发模式默认打开调试工具，便于后续 Electron 联调。
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
 * 解析渲染进程发来的引擎配置 {mode, profileId, cliTool}，
 * 转换为 orchestrator 所需的 {provider, baseUrl, apiKey, model} by AI.Coding
 */
function resolveEngineConfig(profileService, engineConfig) {
  if (!engineConfig || !engineConfig.mode) {
    // 向后兼容：直接带 provider 的旧格式
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
    return { provider: cliTool + '-cli' };
  }

  // mode === 'api'
  if (engineConfig.profileId) {
    const profiles = profileService.list();
    const profile = profiles.find(p => p.id === engineConfig.profileId);
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

  // 预先实例化适配器，尽早暴露 provider 配置错误。
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
 * 将 PRD 结果写入输出目录，保持与 CLI 模式一致的目录结构 by AI.Coding
 */
function writeGenerationOutputs(outputDir, templateName, indexContent, documentContent, pageOutputs) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'index.md'), indexContent, 'utf-8');

  if (documentContent) {
    fs.writeFileSync(path.join(outputDir, `${templateName || 'prd'}-output.md`), documentContent, 'utf-8');
  }

  const usedNames = new Set();
  for (const pageOutput of pageOutputs || []) {
    const baseName = sanitizeFilename(pageOutput.pageName || 'page');
    const uniqueName = deduplicateFilename(baseName || 'page', usedNames);
    fs.writeFileSync(path.join(outputDir, `${uniqueName}.md`), pageOutput.llmOutput || '', 'utf-8');
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
 * 在主进程顺序执行逐页生成，便于在页面间响应取消操作 by AI.Coding
 */
async function generatePrdPages(session, prdConfig, selectedPages) {
  const aggregatedPageOutputs = [];
  const normalizedPages = normalizeSelectedPages(selectedPages);
  const total = normalizedPages.length;
  let processed = 0;

  for (const pageName of normalizedPages) {
    if (session.aborted) {
      sendProgress({ type: 'cancelled', sessionId: session.id, current: processed, total });
      break;
    }

    sendProgress({ type: 'progress', current: processed, total, pageName });

    const pageResult = await orchestrate(session.convertResult, prdConfig, {
      selectedPages: [pageName],
      callbacks: {
        onPageStart(currentPageName) {
          sendProgress({ type: 'page-start', pageName: currentPageName, current: processed, total });
        },
        onChunk(currentPageName, chunk) {
          sendProgress({ type: 'chunk', pageName: currentPageName, chunk, current: processed, total });
        },
        onPageComplete(currentPageName) {
          sendProgress({ type: 'page-complete', pageName: currentPageName, current: processed + 1, total });
        },
        onProgress(progress) {
          sendProgress({ type: 'orchestrate-progress', current: processed, total, ...progress });
        },
      },
    });

    aggregatedPageOutputs.push(...(pageResult.pageOutputs || []));
    processed += pageResult.stats && typeof pageResult.stats.processedPages === 'number'
      ? pageResult.stats.processedPages
      : 0;
    sendProgress({ type: 'progress', current: processed, total, pageName });
  }

  const sitemap = session.convertResult && session.convertResult.sitemap
    ? session.convertResult.sitemap
    : { projectName: '', pages: [] };

  const document = assemblePrd(sitemap, aggregatedPageOutputs, {
    projectName: prdConfig.projectName || sitemap.projectName || '未命名项目',
    language: prdConfig.language,
    template: prdConfig.template,
  });

  return {
    document,
    pageOutputs: aggregatedPageOutputs,
    stats: {
      totalPages: countPages(session.convertResult),
      selectedPages: total,
      processedPages: aggregatedPageOutputs.length,
    },
  };
}

// 应用准备完成后创建窗口，并兼容 macOS 的激活行为。
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
      sessions.set(sessionId, {
        id: sessionId,
        source: payload.source,
        convertResult,
        indexContent,
        aborted: false,
      });

      // 从 sitemap 提取页面列表（含 id/name），供渲染进程 step3 展示复选框
      const sitemapPages = convertResult.sitemap && Array.isArray(convertResult.sitemap.pages)
        ? convertResult.sitemap.pages
        : [];
      const pageList = sitemapPages.map((p, idx) => ({
        id: p.pageName || p.name || `page-${idx}`,
        name: p.pageName || p.name || `未命名页面 ${idx + 1}`,
        path: p.path || p.pageName || '',
      }));

      return {
        sessionId,
        sitemap: convertResult.sitemap,
        pages: pageList,
        pageCount: pageList.length,
        indexContent,
      };
    } catch (error) {
      error.code = error.code || 'CONVERT_FAILED';
      throw error;
    }
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
    const outputDir = historyService.getOutputDir(historyId);
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
        generationResult.document,
        generationResult.pageOutputs
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

      sendProgress({ type: 'done', current: stats.processedPages, total: stats.selectedPages, stats });
      return { stats, historyId };
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
    const errorMessage = await shell.openPath(historyService.getOutputDir(payload.id));
    if (errorMessage) {
      throw createIpcError('OPEN_DIR_FAILED', errorMessage);
    }
    return { ok: true };
  });

  registerIpcHandler('cli:detect', async () => cliDetector.detect());
  registerIpcHandler('cli:redetect', async () => cliDetector.redetect());

  registerIpcHandler('app:info', async () => ({
    version: app.getVersion(),
    userData: app.getPath('userData'),
  }));

  createWindow();

  // 打包后自动检查更新，开发模式跳过 by AI.Coding
  if (app.isPackaged) {
    autoUpdater.on('error', () => {}); // 静默捕获，不影响功能
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

// 非 macOS 平台在全部窗口关闭后直接退出应用。
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
