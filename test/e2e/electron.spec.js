/**
 * Electron 桌面客户端 E2E 测试 by AI.Coding
 *
 * 全离线：通过 electronApp.evaluate 在 Main 进程 mock 所有 IPC handler，
 * 无需网络、无需 LLM、无需真实 Axure 原型。
 *
 * 覆盖：
 *   - 应用启动与导航
 *   - 设置页 LLM 配置 CRUD
 *   - 4 步生成向导完整链路（含 AI 筛选、进度、完成/失败）
 *   - IPC 错误处理链路
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { _electron: electron } = require('playwright');

const APP_ENTRY = path.resolve(__dirname, '../../app/main.js');

// Mock 数据常量
const MOCK_SESSION_ID = 'mock-session-001';
const MOCK_PAGES = [
  { id: '首页', name: '首页', path: '首页' },
  { id: '登录页', name: '登录页', path: '首页 / 登录页' },
  { id: '注册页', name: '注册页', path: '首页 / 注册页' },
];
const MOCK_CONVERT_RESULT = {
  sessionId: MOCK_SESSION_ID,
  sitemap: { pages: MOCK_PAGES },
  pages: MOCK_PAGES,
  pageCount: MOCK_PAGES.length,
  indexContent: '# 站点地图\n- 首页\n- 登录页\n- 注册页',
};
const MOCK_AI_SELECTED = ['首页', '登录页'];
const MOCK_GENERATE_STATS = {
  totalPages: 3,
  selectedPages: 2,
  processedPages: 2,
  elapsedMs: 1234,
};
const TEST_PROFILE = {
  name: 'Test Profile',
  provider: 'openai',
  model: 'gpt-4o',
  apiKey: 'sk-test-key-12345',
  baseUrl: 'http://localhost:8317/v1',
};
const TEST_QUERY = '登录和注册功能的详细 PRD';

test.describe('Electron 桌面客户端 E2E（全离线）', () => {
  test.describe.configure({ mode: 'serial' });

  /** @type {import('playwright').ElectronApplication | null} */
  let electronApp = null;
  /** @type {import('playwright').Page | null} */
  let page = null;
  /** @type {string | null} */
  let appDataRoot = null;

  /**
   * 等待 Electron 主窗口可用，跳过 DevTools 窗口。
   */
  async function waitForMainWindow() {
    const timeoutAt = Date.now() + 15000;

    while (Date.now() < timeoutAt) {
      const windows = electronApp.windows();

      for (const candidate of windows) {
        try {
          await candidate.waitForLoadState('domcontentloaded', { timeout: 1000 });
          const title = await candidate.title();
          if (title === 'Axure to Markdown') {
            return candidate;
          }
        } catch {
          // 窗口尚未加载完成，继续轮询
        }
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    }

    const titles = [];
    for (const candidate of electronApp.windows()) {
      try { titles.push(await candidate.title()); } catch { titles.push('<unavailable>'); }
    }
    throw new Error(`未找到应用主窗口，当前窗口标题: ${titles.join(', ') || '<none>'}`);
  }

  /**
   * 在 Main 进程中 mock 所有核心 IPC handlers，实现全离线测试。
   */
  async function mockAllIpcHandlers() {
    await electronApp.evaluate(({ ipcMain, BrowserWindow }, mockData) => {
      const { convertResult, aiSelected, generateStats, sessionId } = mockData;

      // Mock axure:convert — 返回固定解析结果
      ipcMain.removeHandler('axure:convert');
      ipcMain.handle('axure:convert', async () => {
        return convertResult;
      });

      // Mock axure:select-pages — 返回 AI 筛选的页面 ID 数组
      ipcMain.removeHandler('axure:select-pages');
      ipcMain.handle('axure:select-pages', async () => {
        return aiSelected;
      });

      // Mock axure:generate — 模拟逐页生成，推送进度事件，返回统计
      ipcMain.removeHandler('axure:generate');
      ipcMain.handle('axure:generate', async (event) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
          // 模拟逐页进度推送
          for (let i = 0; i < generateStats.selectedPages; i++) {
            win.webContents.send('axure:progress', {
              type: 'page-start',
              pageName: `页面${i + 1}`,
            });
            win.webContents.send('axure:progress', {
              type: 'page-complete',
              pageName: `页面${i + 1}`,
              current: i + 1,
              total: generateStats.selectedPages,
            });
          }
          win.webContents.send('axure:progress', {
            type: 'done',
            current: generateStats.processedPages,
            total: generateStats.selectedPages,
            stats: generateStats,
          });
        }
        return { stats: generateStats, historyId: 'mock-history-001' };
      });

      // Mock axure:cancel
      ipcMain.removeHandler('axure:cancel');
      ipcMain.handle('axure:cancel', async () => ({ ok: true }));

      // Mock history:open-dir — 不打开真实目录
      ipcMain.removeHandler('history:open-dir');
      ipcMain.handle('history:open-dir', async () => ({ ok: true }));
    }, {
      convertResult: MOCK_CONVERT_RESULT,
      aiSelected: MOCK_AI_SELECTED,
      generateStats: MOCK_GENERATE_STATS,
      sessionId: MOCK_SESSION_ID,
    });
  }

  /**
   * 启动 Electron 应用，隔离用户数据目录。
   */
  async function launchElectronApp() {
    appDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'axure-e2e-'));

    electronApp = await electron.launch({
      args: [APP_ENTRY],
      env: {
        ...process.env,
        APPDATA: appDataRoot,
        LOCALAPPDATA: appDataRoot,
        TEMP: appDataRoot,
        TMP: appDataRoot,
      },
    });

    page = await waitForMainWindow();
    await expect(page).toHaveTitle('Axure to Markdown');
    await expect(page.locator('[data-route="#generate"]')).toBeVisible();
  }

  async function closeElectronApp() {
    if (electronApp) {
      await electronApp.close();
      electronApp = null;
      page = null;
    }
    if (appDataRoot) {
      fs.rmSync(appDataRoot, { recursive: true, force: true });
      appDataRoot = null;
    }
  }

  async function getCurrentRoute() {
    return page.evaluate(() => window.location.hash || '#generate');
  }

  async function clickSidebarRoute(route) {
    await page.locator(`[data-route="${route}"]`).click();
    await expect.poll(() => getCurrentRoute()).toBe(route);
  }

  async function resetGenerateWizard() {
    await clickSidebarRoute('#generate');
    await page.evaluate(() => window.GeneratePage.reset());
    await expect(page.locator('#step1-content.active')).toBeVisible();
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================

  test.beforeAll(async () => {
    await launchElectronApp();
    await mockAllIpcHandlers();
  });

  test.afterAll(async () => {
    await closeElectronApp();
  });

  // =========================================================================
  // 基础测试
  // =========================================================================

  test('测试1: 应用启动 — 标题、侧边栏、默认路由', async () => {
    await expect(page).toHaveTitle('Axure to Markdown');
    await expect(page.locator('.layout-sidebar__nav .nav-item')).toHaveCount(3);
    await expect(page.locator('[data-route="#generate"]')).toBeVisible();
    await expect(page.locator('[data-route="#history"]')).toBeVisible();
    await expect(page.locator('[data-route="#settings"]')).toBeVisible();
    await expect.poll(() => getCurrentRoute()).toBe('#generate');
  });

  test('测试2: 侧边栏导航 — 在三个页面间切换', async () => {
    await clickSidebarRoute('#history');
    await expect(page.locator('#history-search')).toBeVisible();

    await clickSidebarRoute('#settings');
    await expect(page.locator('#profiles-list')).toBeVisible();

    await clickSidebarRoute('#generate');
    await expect(page.locator('#generate-url')).toBeVisible();
  });

  // =========================================================================
  // 设置页
  // =========================================================================

  test('测试3: 设置页 — 新建 LLM 配置', async () => {
    await clickSidebarRoute('#settings');

    await page.locator('button', { hasText: '新建配置' }).click();
    await expect(page.locator('#profile-modal')).toBeVisible();

    await page.locator('#p-name').fill(TEST_PROFILE.name);
    await page.locator('#p-provider').selectOption(TEST_PROFILE.provider);
    await page.locator('#p-model').fill(TEST_PROFILE.model);
    await page.locator('#p-apiKey').fill(TEST_PROFILE.apiKey);
    await page.locator('#p-baseUrl').fill(TEST_PROFILE.baseUrl);

    await page.locator('#profile-modal .btn.btn-primary', { hasText: '保存' }).click();

    await expect(page.locator('#profile-modal')).toBeHidden();
    const newCard = page.locator('.profile-card').last();
    await expect(newCard).toContainText(TEST_PROFILE.name);
    await expect(newCard).toContainText(TEST_PROFILE.provider);
    await expect(newCard).toContainText(TEST_PROFILE.model);
  });

  // =========================================================================
  // 4 步向导 — 完整链路
  // =========================================================================

  test('测试4: Step 1 — 输入 URL 并解析（mock）', async () => {
    await resetGenerateWizard();

    // 输入任意 URL（mock 不会真实请求）
    await page.locator('#generate-url').fill('https://mock.axshare.com/demo');
    await page.locator('#btn-parse').click();

    // 验证解析结果显示
    await expect(page.locator('#parse-result')).toContainText('解析成功', { timeout: 5000 });
    await expect(page.locator('#parse-result')).toContainText(`${MOCK_PAGES.length} 个页面`);

    // 自动跳转到 Step 2
    await expect(page.locator('#step2-content.active')).toBeVisible({ timeout: 3000 });
  });

  test('测试5: Step 2 — 选择 API 引擎并进入 Step 3', async () => {
    await expect(page.locator('#step2-content.active')).toBeVisible();

    // 选择 API 模式（默认应该已选中）
    await page.locator('input[name="engineMode"][value="api"]').check();

    // 验证之前创建的 profile 出现在下拉框
    await expect(page.locator('#profile-select')).toBeVisible();
    await expect(page.locator('#profile-select')).toContainText(TEST_PROFILE.name);

    // 点击下一步
    await page.locator('#step2-content .btn.btn-primary', { hasText: '下一步' }).click();
    await expect(page.locator('#step3-content.active')).toBeVisible();
  });

  test('测试6: Step 3 — 页面列表展示与手动选择', async () => {
    await expect(page.locator('#step3-content.active')).toBeVisible();

    // 验证页面复选框列表
    const checkboxes = page.locator('#pages-checklist input[type="checkbox"]');
    const totalPages = await checkboxes.count();
    expect(totalPages).toBe(MOCK_PAGES.length);

    // 默认应全选
    const checkedCount = await checkboxes.evaluateAll(nodes => nodes.filter(n => n.checked).length);
    expect(checkedCount).toBe(MOCK_PAGES.length);
    await expect(page.locator('#sel-count')).toHaveText(String(MOCK_PAGES.length));

    // 取消选中第一个页面
    await checkboxes.first().uncheck();
    await expect(page.locator('#sel-count')).toHaveText(String(MOCK_PAGES.length - 1));

    // 重新全选
    await checkboxes.first().check();
    await expect(page.locator('#sel-count')).toHaveText(String(MOCK_PAGES.length));
  });

  test('测试7: Step 3 — 输入需求描述', async () => {
    await expect(page.locator('#step3-content.active')).toBeVisible();

    await page.locator('#prd-query').fill(TEST_QUERY);
    await expect(page.locator('#prd-query')).toHaveValue(TEST_QUERY);
  });

  test('测试8: Step 3 — AI 智能筛选（mock 离线）', async () => {
    await expect(page.locator('#step3-content.active')).toBeVisible();
    await expect(page.locator('#prd-query')).toHaveValue(TEST_QUERY);

    // 点击 AI 智能筛选按钮
    const aiBtn = page.locator('#step3-content .btn-sm', { hasText: 'AI 智能筛选' });
    await expect(aiBtn).toBeVisible();
    await aiBtn.click();

    // 等待筛选完成（按钮恢复原状）
    await expect(aiBtn).toContainText('AI 智能筛选', { timeout: 5000 });

    // 验证选中数量变为 mock 返回的 2 个
    await expect(page.locator('#sel-count')).toHaveText(String(MOCK_AI_SELECTED.length));

    // 验证具体选中状态：首页和登录页选中，注册页未选中
    const checkboxes = page.locator('#pages-checklist input[type="checkbox"]');
    const checkedValues = await checkboxes.evaluateAll(nodes =>
      nodes.filter(n => n.checked).map(n => n.value)
    );
    expect(checkedValues.sort()).toEqual(MOCK_AI_SELECTED.slice().sort());
  });

  test('测试9: Step 4 — 开始生成 → 进度展示 → 完成', async () => {
    // 点击"开始生成 PRD"
    const genBtn = page.locator('#step3-content .btn-primary', { hasText: '开始生成' });
    await expect(genBtn).toBeVisible();
    await genBtn.click();

    // 进入 Step 4
    await expect(page.locator('#step4-content.active')).toBeVisible({ timeout: 3000 });

    // 等待生成完成 — 应显示"生成完成"
    await expect(page.locator('#step4-content')).toContainText('生成完成', { timeout: 10000 });

    // 验证统计数据
    await expect(page.locator('#step4-content')).toContainText(String(MOCK_GENERATE_STATS.selectedPages));
    await expect(page.locator('#step4-content')).toContainText(String(MOCK_GENERATE_STATS.processedPages));

    // 验证耗时（1.2 秒）
    const elapsed = (MOCK_GENERATE_STATS.elapsedMs / 1000).toFixed(1);
    await expect(page.locator('#step4-content')).toContainText(elapsed);

    // 验证操作按钮存在
    await expect(page.locator('button', { hasText: '打开输出目录' })).toBeVisible();
    await expect(page.locator('a', { hasText: '查看历史' })).toBeVisible();
    await expect(page.locator('button', { hasText: '再来一次' })).toBeVisible();
  });

  test('测试10: Step 4 — 点击"再来一次"重置向导', async () => {
    await page.locator('button', { hasText: '再来一次' }).click();

    // 验证回到 Step 1（reset 保留 URL 方便重复生成）
    await expect(page.locator('#step1-content.active')).toBeVisible();
    await expect(page.locator('#generate-url')).toBeVisible();
  });

  // =========================================================================
  // 错误场景
  // =========================================================================

  test('测试11: Step 1 — 解析失败的错误处理', async () => {
    // 临时替换 convert mock 为错误返回
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('axure:convert');
      ipcMain.handle('axure:convert', async () => {
        return { error: 'CONVERT_FAILED', message: '无法连接到目标地址' };
      });
    });

    await resetGenerateWizard();
    await page.locator('#generate-url').fill('https://invalid.example.com');
    await page.locator('#btn-parse').click();

    // 验证错误信息显示
    await expect(page.locator('#parse-result')).toContainText('解析失败', { timeout: 5000 });
    await expect(page.locator('#parse-result')).toContainText('无法连接到目标地址');

    // 恢复正常 mock
    await electronApp.evaluate(({ ipcMain }, convertResult) => {
      ipcMain.removeHandler('axure:convert');
      ipcMain.handle('axure:convert', async () => convertResult);
    }, MOCK_CONVERT_RESULT);
  });

  test('测试12: Step 3 — AI 筛选失败的错误处理', async () => {
    // 先走到 Step 3
    await resetGenerateWizard();
    await page.locator('#generate-url').fill('https://mock.axshare.com/demo');
    await page.locator('#btn-parse').click();
    await expect(page.locator('#step2-content.active')).toBeVisible({ timeout: 3000 });
    await page.locator('#step2-content .btn.btn-primary', { hasText: '下一步' }).click();
    await expect(page.locator('#step3-content.active')).toBeVisible();

    // 临时替换 select-pages mock 为错误返回
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('axure:select-pages');
      ipcMain.handle('axure:select-pages', async () => {
        return { error: 'LLM_ERROR', message: 'LLM 返回格式异常' };
      });
    });

    // 输入需求并点击 AI 筛选
    await page.locator('#prd-query').fill(TEST_QUERY);

    // 监听 alert 弹框
    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('AI 筛选失败');
      await dialog.accept();
    });

    const aiBtn = page.locator('#step3-content .btn-sm', { hasText: 'AI 智能筛选' });
    await aiBtn.click();

    // 等待按钮恢复（说明错误已被处理）
    await expect(aiBtn).toContainText('AI 智能筛选', { timeout: 5000 });
    await expect(aiBtn).toBeEnabled();

    // 恢复正常 mock
    await electronApp.evaluate(({ ipcMain }, aiSelected) => {
      ipcMain.removeHandler('axure:select-pages');
      ipcMain.handle('axure:select-pages', async () => aiSelected);
    }, MOCK_AI_SELECTED);
  });

  test('测试13: Step 3 — 未选择页面时拦截生成', async () => {
    await expect(page.locator('#step3-content.active')).toBeVisible();

    // 取消所有页面选中
    const checkboxes = page.locator('#pages-checklist input[type="checkbox"]');
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      await checkboxes.nth(i).uncheck();
    }
    await expect(page.locator('#sel-count')).toHaveText('0');

    // 监听 alert
    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('至少选择一个页面');
      await dialog.accept();
    });

    // 点击生成 — 应该弹 alert 而不是进入 Step 4
    await page.locator('#step3-content .btn-primary', { hasText: '开始生成' }).click();

    // 仍停留在 Step 3
    await expect(page.locator('#step3-content.active')).toBeVisible();
  });

  test('测试14: Step 4 — 生成失败的错误处理', async () => {
    // 先把页面重新选上
    await resetGenerateWizard();
    await page.locator('#generate-url').fill('https://mock.axshare.com/demo');
    await page.locator('#btn-parse').click();
    await expect(page.locator('#step2-content.active')).toBeVisible({ timeout: 3000 });
    await page.locator('#step2-content .btn.btn-primary', { hasText: '下一步' }).click();
    await expect(page.locator('#step3-content.active')).toBeVisible();
    await page.locator('#prd-query').fill(TEST_QUERY);

    // 替换 generate mock 为错误
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('axure:generate');
      ipcMain.handle('axure:generate', async () => {
        return { error: 'GENERATE_FAILED', message: '生成过程中发生异常' };
      });
    });

    // 点击生成
    await page.locator('#step3-content .btn-primary', { hasText: '开始生成' }).click();

    // 进入 Step 4 后应显示失败
    await expect(page.locator('#step4-content.active')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#step4-content')).toContainText('生成失败', { timeout: 5000 });
    await expect(page.locator('#step4-content')).toContainText('生成过程中发生异常');

    // 验证"返回重试"按钮
    await expect(page.locator('button', { hasText: '返回重试' })).toBeVisible();

    // 恢复正常 mock
    await electronApp.evaluate(({ ipcMain, BrowserWindow }, mockData) => {
      ipcMain.removeHandler('axure:generate');
      ipcMain.handle('axure:generate', async (event) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
          for (let i = 0; i < mockData.selectedPages; i++) {
            win.webContents.send('axure:progress', {
              type: 'page-complete',
              pageName: `页面${i + 1}`,
              current: i + 1,
              total: mockData.selectedPages,
            });
          }
        }
        return { stats: mockData, historyId: 'mock-history-001' };
      });
    }, MOCK_GENERATE_STATS);
  });

  // =========================================================================
  // Step 1 空输入校验
  // =========================================================================

  test('测试15: Step 1 — 空 URL 拦截', async () => {
    await resetGenerateWizard();

    // 监听 alert
    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('请输入');
      await dialog.accept();
    });

    // 不输入任何内容直接点击解析
    await page.locator('#btn-parse').click();

    // 仍停留在 Step 1
    await expect(page.locator('#step1-content.active')).toBeVisible();
  });
});
