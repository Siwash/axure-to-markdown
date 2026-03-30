/**
 * 4步生成向导页面 by AI.Coding
 */

(function() {
  let container = null;
  let unsubscribeProgress = null;

  const state = {
    step: 1,
    url: '',
    sessionId: null,
    sitemap: null,
    pages: [],
    parsedDir: '',

    engineMode: 'api',
    cliExecMode: 'terminal', // 'terminal' | 'inapp'
    selectedProfileId: null,
    selectedCli: null,
    availableProfiles: [],
    cliStatus: {},

    query: '',
    selectedPages: [],

    isGenerating: false,
    stats: null,
    historyId: null,
    error: null,
    pageStatuses: new Map(),
  };

  /**
   * 挂载页面并注册重新生成事件 by AI.Coding
   */
  function mount(target) {
    container = target;
    render();
    window.addEventListener('axure:regenerate', handleRegenerateEvent);
  }

  /**
   * 卸载页面并清理进度监听器 by AI.Coding
   */
  function unmount() {
    if (unsubscribeProgress) {
      unsubscribeProgress();
      unsubscribeProgress = null;
    }
    window.removeEventListener('axure:regenerate', handleRegenerateEvent);
    container = null;
  }

  /**
   * 接收历史记录预填数据，并按原流程回到解析阶段 by AI.Coding
   */
  function handleRegenerateEvent(e) {
    const record = e.detail;
    if (!record) return;

    reset();
    state.url = record.sourceUrl || '';
    state.query = record.query || '';

    if (record.engineType === 'cli') {
      state.engineMode = 'cli';
      state.selectedCli = record.engineName ? record.engineName.replace(/-cli$/, '') : null;
    } else if (record.engineType === 'api') {
      state.engineMode = 'api';
    }

    render();
    if (state.url) {
      setTimeout(() => {
        handleParse();
      }, 100);
    }
  }

  /**
   * 渲染页面骨架，并根据当前步骤补充动态内容 by AI.Coding
   */
  function render() {
    if (!container) return;

    container.innerHTML = `
      <div class="page-header">
        <h2 class="page-title">生成 PRD</h2>
      </div>

      <div class="step-nav">
        ${[1, 2, 3, 4].map(i => `
          <div class="step-item ${state.step === i ? 'active' : ''} ${state.step > i ? 'completed' : ''}" onclick="window.GeneratePage.goToStep(${i})">
            <div class="step-circle">${state.step > i ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>' : i}</div>
            <div class="step-label">${getStepName(i)}</div>
          </div>
        `).join('')}
      </div>

      <div class="step-content ${state.step === 1 ? 'active' : ''}" id="step1-content">
        <div class="card">
          <div class="card-title">
            <span style="opacity:0.5; margin-right:8px;">01</span> 原型来源
          </div>
          <div class="form-group mt-md">
            <label class="form-label" style="display:flex; justify-content:space-between;">
              <span>Axure 原型在线链接或本地目录路径</span>
            </label>
            <div style="display:flex; gap:12px;">
              <input type="text" class="form-control" id="generate-url" placeholder="例如：https://xxx.axshare.com/demo 或本地路径" value="${escapeHtml(state.url)}">
              <button class="btn btn-primary" id="btn-parse" style="min-width:120px;">解析原型</button>
            </div>
          </div>

          <div id="parse-result" class="mt-md"></div>
        </div>
      </div>

      <div class="step-content ${state.step === 2 ? 'active' : ''}" id="step2-content"></div>
      <div class="step-content ${state.step === 3 ? 'active' : ''}" id="step3-content"></div>
      <div class="step-content ${state.step === 4 ? 'active' : ''}" id="step4-content"></div>
    `;

    bindEvents();
    if (state.step === 2) renderStep2();
    if (state.step === 3) renderStep3();
    if (state.step === 4) renderStep4();
  }

  /**
   * 获取步骤标题文案 by AI.Coding
   */
  function getStepName(step) {
    const names = { 1: '解析原型', 2: '选择引擎', 3: '输入需求', 4: '生成 PRD' };
    return names[step];
  }

  /**
   * 绑定步骤1的解析按钮事件 by AI.Coding
   */
  function bindEvents() {
    const btnParse = document.getElementById('btn-parse');
    if (btnParse) {
      btnParse.addEventListener('click', handleParse);
    }
  }

  /**
   * 允许回退到已完成步骤，生成中禁止切换 by AI.Coding
   */
  function goToStep(step) {
    if (state.isGenerating) return;
    if (step < state.step) {
      state.step = step;
      render();
    }
  }

  /**
   * 处理步骤1解析，并缓存 parsedDir 供后续打开目录与 CLI 复用 by AI.Coding
   */
  async function handleParse() {
    const urlInput = document.getElementById('generate-url');
    const url = urlInput.value.trim();
    if (!url) {
      alert('请输入链接或路径');
      return;
    }

    const btn = document.getElementById('btn-parse');
    const resultDiv = document.getElementById('parse-result');

    btn.disabled = true;
    btn.textContent = '解析中...';
    resultDiv.innerHTML = '';

    try {
      state.url = url;
      state.stats = null;
      state.error = null;
      state.historyId = null;
      state.pageStatuses = new Map();

      const res = await window.electronAPI.convert(url);
      state.sessionId = res.sessionId;
      state.sitemap = res.sitemap;
      state.pages = Array.isArray(res.pages) ? res.pages : [];
      state.parsedDir = res.parsedDir || '';

      resultDiv.innerHTML = `
        <div class="text-success mt-sm" style="display:flex; align-items:center; gap:8px; padding:12px; background:rgba(16, 185, 129, 0.1); border-radius:6px; border:1px solid rgba(16, 185, 129, 0.2);">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
          解析成功，共发现 ${res.pageCount} 个页面。
        </div>
      `;

      setTimeout(() => {
        state.step = 2;
        render();
      }, 800);
    } catch (error) {
      resultDiv.innerHTML = `
        <div class="text-danger mt-sm" style="display:flex; align-items:center; gap:8px; padding:12px; background:rgba(239, 68, 68, 0.1); border-radius:6px; border:1px solid rgba(239, 68, 68, 0.2);">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
          解析失败: ${escapeHtml(error.message || String(error))}
        </div>
      `;
    } finally {
      btn.disabled = false;
      btn.textContent = '解析原型';
    }
  }

  /**
   * 渲染步骤2，引擎项改为平铺卡片并展示解析目录信息条 by AI.Coding
   */
  async function renderStep2() {
    const step2 = document.getElementById('step2-content');
    if (!step2) return;

    step2.innerHTML = '<div class="text-muted">加载配置中...</div>';

    try {
      const [profiles, cliStatus] = await Promise.all([
        window.electronAPI.listProfiles(),
        window.electronAPI.detectCli(),
      ]);

      state.availableProfiles = Array.isArray(profiles) ? profiles : [];
      state.cliStatus = cliStatus || {};

      const defaultProfile = state.availableProfiles.find(p => p.isDefault) || state.availableProfiles[0];
      if (defaultProfile && !state.selectedProfileId) {
        state.selectedProfileId = defaultProfile.id;
      }

      if (state.engineMode === 'cli' && !state.selectedCli) {
        const firstAvailableCli = Object.entries(state.cliStatus).find(([, ok]) => ok);
        state.selectedCli = firstAvailableCli ? firstAvailableCli[0] : null;
      }

      step2.innerHTML = `
        <div class="card">
          <div id="parsed-info" class="info-banner">
            <div>
              <div class="info-banner__title">已生成原始 MD 索引文件</div>
              <div class="info-banner__text">当前共解析 ${state.pages.length} 个页面，索引文件已写入临时解析目录。</div>
            </div>
            <button class="btn btn-secondary btn-sm" id="btn-open-parsed-dir" onclick="window.GeneratePage.openParsedDir()">打开解析目录</button>
          </div>

          <div class="card-title">
            <span style="opacity:0.5; margin-right:8px;">02</span> 选择驱动引擎
          </div>

          <div class="engine-mode-card ${state.engineMode === 'api' ? 'active' : ''}">
            <label class="form-label engine-mode-card__header">
              <span class="engine-mode-card__title-wrap">
                <input type="radio" name="engineMode" value="api" ${state.engineMode === 'api' ? 'checked' : ''} onchange="window.GeneratePage.setEngineMode('api')">
                <span style="font-weight:600; font-size:15px;">通过 API 调用</span>
              </span>
            </label>
            <div class="engine-mode-card__body" style="display:${state.engineMode === 'api' ? 'block' : 'none'};">
              ${state.availableProfiles.length === 0
                ? '<div class="text-muted mb-sm">暂无配置，请先在设置中添加</div>'
                : `
                  <div class="option-grid profile-option-grid">
                    ${state.availableProfiles.map(profile => `
                      <button
                        type="button"
                        class="option-tile profile-option ${state.selectedProfileId === profile.id ? 'active' : ''}"
                        data-profile-id="${profile.id}"
                        onclick="window.GeneratePage.setProfile('${profile.id}')"
                      >
                        <span class="option-tile__title">${escapeHtml(profile.name)}</span>
                        <span class="option-tile__desc">${escapeHtml(profile.provider)} · ${escapeHtml(profile.model || '默认模型')}</span>
                      </button>
                    `).join('')}
                  </div>
                `
              }
            </div>
          </div>

          <div class="engine-mode-card ${state.engineMode === 'cli' ? 'active' : ''}">
            <label class="form-label engine-mode-card__header">
              <span class="engine-mode-card__title-wrap">
                <input type="radio" name="engineMode" value="cli" ${state.engineMode === 'cli' ? 'checked' : ''} onchange="window.GeneratePage.setEngineMode('cli')">
                <span style="font-weight:600; font-size:15px;">通过本地 CLI 调用</span>
              </span>
            </label>
            <div class="engine-mode-card__body" style="display:${state.engineMode === 'cli' ? 'block' : 'none'};">
              <div class="option-grid cli-option-grid">
                ${Object.entries(state.cliStatus).map(([name, isOk]) => `
                  <button
                    type="button"
                    class="option-tile cli-option ${state.selectedCli === name ? 'active' : ''} ${isOk ? '' : 'disabled'}"
                    data-tool="${name}"
                    ${isOk ? `onclick="window.GeneratePage.setCli('${name}')"` : 'disabled'}
                  >
                    <span class="option-tile__title">${escapeHtml(name)}</span>
                    <span class="option-tile__desc">${isOk ? '已安装，可直接使用' : '未检测到，暂不可用'}</span>
                  </button>
                `).join('')}
              </div>
            </div>
          </div>

          <div class="mt-lg">
            <button class="btn btn-primary" onclick="window.GeneratePage.nextToStep3()">下一步：填写需求</button>
          </div>
        </div>
      `;
    } catch (e) {
      step2.innerHTML = `<div class="text-danger">加载失败: ${escapeHtml(e.message)}</div>`;
    }
  }

  /**
   * 切换引擎模式后重新渲染步骤2，确保卡片态同步 by AI.Coding
   */
  function setEngineMode(mode) {
    state.engineMode = mode;
    if (mode === 'cli' && !state.selectedCli) {
      const firstAvailableCli = Object.entries(state.cliStatus || {}).find(([, ok]) => ok);
      state.selectedCli = firstAvailableCli ? firstAvailableCli[0] : null;
    }
    renderStep2();
  }

  /**
   * 选择 API 配置卡片，并即时刷新选中态 by AI.Coding
   */
  function setProfile(id) {
    state.selectedProfileId = id;
    renderStep2();
  }

  /**
   * 选择 CLI 工具卡片，未安装工具不允许选中 by AI.Coding
   */
  function setCli(name) {
    if (!state.cliStatus[name]) return;
    state.selectedCli = name;
    renderStep2();
  }

  /**
   * 从步骤2进入步骤3，并初始化默认页面选择 by AI.Coding
   */
  function nextToStep3() {
    if (state.engineMode === 'api' && !state.selectedProfileId) {
      alert('请选择 API 配置');
      return;
    }

    if (state.engineMode === 'cli' && !state.selectedCli) {
      alert('请选择有效的 CLI 工具');
      return;
    }

    if (state.selectedPages.length === 0 && state.pages.length > 0) {
      state.selectedPages = state.pages.map(p => p.id);
    }

    state.step = 3;
    render();
  }

  /**
   * 渲染步骤3的需求与页面勾选区域 by AI.Coding
   */
  function renderStep3() {
    const step3 = document.getElementById('step3-content');
    if (!step3) return;

    step3.innerHTML = `
      <div class="card">
        <div class="card-title">
          <span style="opacity:0.5; margin-right:8px;">03</span> PRD 需求与范围
        </div>

        <div class="form-group mt-md">
          <label class="form-label" style="font-weight:600;">需求描述 <span style="font-weight:400; opacity:0.6; font-size:12px; margin-left:8px;">告诉 AI 你想要什么格式或侧重什么功能（可选）</span></label>
          <textarea class="form-control" id="prd-query" placeholder="例如：重点写一下登录和注册的逻辑，要求包含异常流程的设计...">${escapeHtml(state.query)}</textarea>
        </div>

        <div class="form-group mt-lg">
          <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 12px;">
            <label class="form-label" style="margin-bottom:0; font-weight:600;">
              选择要生成的页面
              <div class="text-muted mt-sm" style="font-size: 12px; font-weight:400;">已选择 <span id="sel-count" style="color:var(--color-primary); font-weight:600;">${state.selectedPages.length}</span> / ${state.pages.length} 页</div>
            </label>
            <button class="btn btn-secondary btn-sm" style="padding: 6px 12px; border-style:dashed;" onclick="window.GeneratePage.aiSelectPages()">
              <span style="margin-right:6px;">✨</span> AI 智能筛选
            </button>
          </div>

          <div class="check-list" id="pages-checklist">
            ${state.pages.map(page => `
              <label class="check-item">
                <input type="checkbox" value="${page.id}" onchange="window.GeneratePage.togglePageSelection(this)" ${state.selectedPages.includes(page.id) ? 'checked' : ''}>
                <span style="font-family:var(--font-mono); font-size:13px; opacity:0.9;">${escapeHtml(page.name)}</span>
              </label>
            `).join('')}
          </div>
        </div>

        <div class="mt-xl" style="padding-top:16px; border-top:1px dashed var(--color-border);">
          <button class="btn btn-primary" style="padding: 12px 32px; font-size:16px;" onclick="window.GeneratePage.startGenerate()">开始生成 PRD</button>
        </div>
      </div>
    `;
  }

  /**
   * 切换页面勾选后同步统计数字 by AI.Coding
   */
  function togglePageSelection(checkbox) {
    const id = checkbox.value;
    if (checkbox.checked) {
      if (!state.selectedPages.includes(id)) state.selectedPages.push(id);
    } else {
      state.selectedPages = state.selectedPages.filter(x => x !== id);
    }
    document.getElementById('sel-count').innerText = state.selectedPages.length;
  }

  /**
   * 调用 AI 选择页面，并防御非数组返回 by AI.Coding
   */
  async function aiSelectPages() {
    const query = document.getElementById('prd-query').value.trim();
    if (!query) {
      alert('请先输入需求描述，AI 才能进行筛选');
      return;
    }

    state.query = query;
    const btn = document.querySelector('#step3-content .btn-sm');
    btn.disabled = true;
    btn.innerHTML = '<span style="margin-right:6px;">⏳</span> 筛选中...';

    try {
      const selectedIds = await window.electronAPI.selectPages({
        sessionId: state.sessionId,
        query: state.query,
        engineConfig: getEngineConfig()
      });

      if (!Array.isArray(selectedIds)) {
        throw new Error('AI 筛选返回了非预期格式');
      }

      state.selectedPages = selectedIds;
      renderStep3();
    } catch (e) {
      alert('AI 筛选失败: ' + e.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span style="margin-right:6px;">✨</span> AI 智能筛选';
      }
    }
  }

  /**
   * 返回当前引擎配置给主进程 IPC by AI.Coding
   */
  function getEngineConfig() {
    return {
      mode: state.engineMode,
      profileId: state.selectedProfileId,
      cliTool: state.selectedCli
    };
  }

  /**
   * 开始步骤4；CLI 终端模式展示提示词并自动复制，CLI 应用内/API 模式走生成流程 by AI.Coding
   */
  async function startGenerate() {
    state.query = document.getElementById('prd-query').value.trim();

    if (state.selectedPages.length === 0) {
      alert('请至少选择一个页面');
      return;
    }

    initializePageStatuses();
    state.step = 4;
    state.error = null;
    state.stats = null;
    state.historyId = null;
    render();

    if (state.engineMode === 'cli') {
      state.isGenerating = false;
      state.cliFullPrompt = '正在构建提示词…';
      try {
        const result = await window.electronAPI.buildCliPrompt({
          sessionId: state.sessionId,
          query: state.query,
          selectedPages: state.selectedPages,
        });
        state.cliFullPrompt = result.fullPrompt || '';
        state.parsedDir = result.parsedDir || state.parsedDir;
        if (state.cliExecMode === 'terminal') {
          try { await navigator.clipboard.writeText(state.cliFullPrompt); } catch (_e) { /* ignore */ }
        }
      } catch (e) {
        state.cliFullPrompt = '构建提示词失败: ' + e.message;
      }
      renderStep4();
      return;
    }

    runInAppGeneration();
  }

  /**
   * 在应用内执行 PRD 生成（API 模式或 CLI 应用内模式共用） by AI.Coding
   */
  async function runInAppGeneration() {
    state.isGenerating = true;
    renderStep4();

    if (unsubscribeProgress) unsubscribeProgress();
    unsubscribeProgress = window.electronAPI.onProgress(handleProgress);

    try {
      const result = await window.electronAPI.generate({
        sessionId: state.sessionId,
        selectedPages: state.selectedPages,
        query: state.query,
        engineConfig: getEngineConfig()
      });

      state.stats = result.stats;
      state.historyId = result.historyId;
      state.isGenerating = false;
      renderStep4();
    } catch (e) {
      state.error = e;
      state.isGenerating = false;
      renderStep4();
    }
  }

  /**
   * CLI 应用内模式：点击"开始生成"触发 by AI.Coding
   */
  function startCliInapp() {
    runInAppGeneration();
  }

  /**
   * 切换 CLI 执行模式，terminal 模式自动复制提示词到剪贴板 by AI.Coding
   */
  function setCliExecMode(mode) {
    if (mode === state.cliExecMode) return;
    state.cliExecMode = mode;
    if (mode === 'terminal' && state.cliFullPrompt) {
      try { navigator.clipboard.writeText(state.cliFullPrompt); } catch (_e) { /* ignore */ }
    }
    renderStep4();
  }

  /**
   * 初始化每个页面的任务状态，供步骤4右侧任务列表使用 by AI.Coding
   */
  function initializePageStatuses() {
    state.pageStatuses = new Map();
    state.selectedPages.forEach(pageId => {
      state.pageStatuses.set(pageId, 'pending');
    });
  }

  /**
   * 处理主进程进度事件，并同步更新任务列表与进度 UI by AI.Coding
   */
  function handleProgress(data) {
    if (!document.getElementById('step4-content')) return;

    const { type, pageName, chunk, current, total, error } = data;
    updatePageStatus(type, pageName);

    const preview = document.getElementById('term-preview');
    const pageNameEl = document.getElementById('curr-page-name');
    const barFill = document.getElementById('prog-bar-fill');
    const progText = document.getElementById('prog-text');

    if (type === 'page-start') {
      const trackedName = resolveTrackedPageName(pageName, type) || pageName;
      if (pageNameEl) pageNameEl.textContent = `正在生成: ${trackedName}...`;
      if (preview) {
        preview.textContent += `\n\n--- 正在处理: ${trackedName} ---\n`;
        preview.scrollTop = preview.scrollHeight;
      }
    } else if (type === 'chunk') {
      if (preview) {
        preview.textContent += chunk;
        preview.scrollTop = preview.scrollHeight;
      }
    } else if (type === 'progress' || type === 'page-complete') {
      if (barFill && total > 0) {
        barFill.style.width = `${(current / total) * 100}%`;
      }
      if (progText) {
        progText.textContent = `${current} / ${total}`;
      }
    } else if (type === 'page-failed') {
      const trackedName = resolveTrackedPageName(pageName, type) || pageName;
      if (preview) {
        preview.textContent += `\n\n❌ 页面「${trackedName}」生成失败: ${error}\n`;
        preview.scrollTop = preview.scrollHeight;
      }
      if (barFill && total > 0) {
        barFill.style.width = `${(current / total) * 100}%`;
      }
      if (progText) {
        progText.textContent = `${current} / ${total}`;
      }
    }

    syncTaskListDom();
  }

  /**
   * 根据 progress 事件把页面状态同步到 Map 中 by AI.Coding
   */
  function updatePageStatus(type, pageName) {
    const trackedName = resolveTrackedPageName(pageName, type);
    if (!trackedName) return;

    if (type === 'page-start') {
      state.pageStatuses.set(trackedName, 'generating');
      return;
    }

    if (type === 'page-complete') {
      state.pageStatuses.set(trackedName, 'completed');
      return;
    }

    if (type === 'page-failed') {
      state.pageStatuses.set(trackedName, 'failed');
    }
  }

  /**
   * 兼容 progress 事件页名与勾选页名不一致的场景，优先匹配当前最可能的任务 by AI.Coding
   */
  function resolveTrackedPageName(pageName, type) {
    if (pageName && state.pageStatuses.has(pageName)) {
      return pageName;
    }

    const entries = Array.from(state.pageStatuses.entries());
    if (entries.length === 0) {
      return pageName || null;
    }

    if (type === 'page-start') {
      const pending = entries.find(([, status]) => status === 'pending');
      if (pending) return pending[0];
      const generating = entries.find(([, status]) => status === 'generating');
      return generating ? generating[0] : entries[0][0];
    }

    if (type === 'page-complete' || type === 'page-failed') {
      const generating = entries.find(([, status]) => status === 'generating');
      if (generating) return generating[0];
      const pending = entries.find(([, status]) => status === 'pending');
      return pending ? pending[0] : entries[0][0];
    }

    return pageName || null;
  }

  /**
   * 渲染步骤4，CLI 终端模式全宽展示，CLI 应用内/API 模式走生成进度布局 by AI.Coding
   */
  function renderStep4() {
    const step4 = document.getElementById('step4-content');
    if (!step4) return;

    let mainCardHtml = '';
    const isCliTerminal = state.engineMode === 'cli' && state.cliExecMode === 'terminal' && !state.isGenerating && !state.stats && !state.error;
    const isCliInappPending = state.engineMode === 'cli' && state.cliExecMode === 'inapp' && !state.isGenerating && !state.stats && !state.error;

    if (isCliTerminal) {
      mainCardHtml = renderCliLaunchCard();
    } else if (isCliInappPending) {
      mainCardHtml = renderCliInappCard();
    } else if (state.isGenerating) {
      mainCardHtml = `
        <div class="card" style="border-color:var(--color-border-focus);">
          <div class="card-title">
            <span style="opacity:0.5; margin-right:8px;">04</span> 生成中...
          </div>
          <div class="mb-sm text-primary" id="curr-page-name" style="font-family:var(--font-mono); font-size:13px;">准备就绪...</div>

          <div class="progress-container">
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" id="prog-bar-fill"></div>
            </div>
            <div class="progress-text">
              <span>处理进度</span>
              <span id="prog-text">0 / ${state.selectedPages.length}</span>
            </div>
          </div>

          <div class="terminal-preview mt-md" id="term-preview"></div>

          <div class="mt-lg text-right" style="text-align: right;">
            <button class="btn btn-danger" onclick="window.GeneratePage.cancelGen()">取消生成</button>
          </div>
        </div>
      `;
    } else if (state.error) {
      mainCardHtml = `
        <div class="card" style="border-color:rgba(239, 68, 68, 0.4);">
          <div class="card-title text-danger">生成失败 / 取消</div>
          <div class="mt-md" style="font-family:var(--font-mono); font-size:13px; color:var(--color-text-secondary); background:rgba(0,0,0,0.3); padding:16px; border-radius:6px;">${escapeHtml(state.error.message || String(state.error))}</div>
          <div class="mt-lg">
            <button class="btn btn-primary" onclick="window.GeneratePage.goToStep(3)">返回重试</button>
          </div>
        </div>
      `;
    } else if (state.stats) {
      const failed = (state.stats.selectedPages || 0) - (state.stats.processedPages || 0);
      mainCardHtml = `
        <div class="card" style="border-color:rgba(16, 185, 129, 0.3);">
          <div class="card-title text-success">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:8px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
            生成完成
          </div>
          <div class="mt-md" style="display:grid; grid-template-columns:1fr 1fr; gap:16px; background:rgba(255,255,255,0.02); padding:20px; border-radius:8px;">
            <div>
              <div style="font-size:12px; color:var(--color-text-muted); margin-bottom:4px;">总处理页面</div>
              <div style="font-size:24px; font-weight:600; font-family:var(--font-heading);">${state.stats.selectedPages || 0}</div>
            </div>
            <div>
              <div style="font-size:12px; color:var(--color-text-muted); margin-bottom:4px;">成功生成</div>
              <div style="font-size:24px; font-weight:600; font-family:var(--font-heading); color:var(--color-success);">${state.stats.processedPages || 0}</div>
            </div>
            <div>
              <div style="font-size:12px; color:var(--color-text-muted); margin-bottom:4px;">失败页面</div>
              <div style="font-size:24px; font-weight:600; font-family:var(--font-heading); color:${failed > 0 ? 'var(--color-danger)' : 'var(--color-text-primary)'};">${failed}</div>
            </div>
            <div>
              <div style="font-size:12px; color:var(--color-text-muted); margin-bottom:4px;">总耗时</div>
              <div style="font-size:24px; font-weight:600; font-family:var(--font-heading);">${((state.stats.elapsedMs || 0) / 1000).toFixed(1)} <span style="font-size:14px; font-weight:400;">秒</span></div>
            </div>
          </div>
          <div class="mt-lg" style="display:flex; gap: 12px; padding-top:20px; border-top:1px solid var(--color-border);">
            <button class="btn btn-primary" onclick="window.GeneratePage.openOutDir()">打开输出目录</button>
            <a href="#history" class="btn btn-secondary">查看历史</a>
            <button class="btn btn-secondary" onclick="window.GeneratePage.reset()">再来一次</button>
          </div>
        </div>
      `;
    }

    if (isCliTerminal || isCliInappPending) {
      step4.innerHTML = mainCardHtml;
    } else {
      step4.innerHTML = `
        <div class="step4-layout">
          <div class="step4-main">${mainCardHtml}</div>
          ${renderTaskPanel()}
        </div>
      `;
    }
  }

  /**
   * 渲染 CLI 终端模式卡片：完整提示词（已自动复制）+ 启动终端 + 打开目录 by AI.Coding
   */
  function renderCliLaunchCard() {
    const promptText = state.cliFullPrompt || '提示词加载中…';
    const dirPath = state.parsedDir || '尚未生成解析目录';

    return `
      <div class="card cli-terminal-card">
        <div class="card-title" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <span><span style="opacity:0.5; margin-right:8px;">04</span> CLI 模式 — ${escapeHtml(state.selectedCli || 'CLI')}</span>
          <div class="cli-exec-toggle">
            <button class="cli-exec-toggle__btn active" onclick="window.GeneratePage.setCliExecMode('terminal')">打开终端</button>
            <button class="cli-exec-toggle__btn" onclick="window.GeneratePage.setCliExecMode('inapp')">应用内执行</button>
          </div>
        </div>

        <p class="text-muted mb-md">提示词已自动复制到剪贴板，粘贴到 ${escapeHtml(state.selectedCli || 'CLI')} 终端中执行即可。</p>

        <div class="cli-prompt-section">
          <div class="cli-prompt-header">
            <span class="text-muted" style="font-size:12px;">完整提示词</span>
            <button class="btn btn-secondary btn-sm" onclick="window.GeneratePage.copyToClipboard('cli-full-prompt', '提示词')">复制提示词</button>
          </div>
          <textarea id="cli-full-prompt" readonly rows="18" class="cli-prompt-textarea">${escapeHtml(promptText)}</textarea>
        </div>

        <div class="cli-dir-row mt-md">
          <div style="flex:1; min-width:0;">
            <div class="text-muted" style="font-size:12px; margin-bottom:4px;">解析文件目录</div>
            <div id="cli-files-path" style="font-family:var(--font-mono); font-size:13px; word-break:break-all; color:var(--color-text-primary);">${escapeHtml(dirPath)}</div>
          </div>
          <button class="btn btn-secondary btn-sm" style="flex-shrink:0;" onclick="window.GeneratePage.copyToClipboard('cli-files-path', '路径')">复制</button>
        </div>

        <div class="mt-lg" style="display:flex; gap:12px; flex-wrap:wrap; padding-top:16px; border-top:1px solid var(--color-border);">
          <button class="btn btn-primary" id="btn-launch-terminal" onclick="window.GeneratePage.openTerminal()">启动终端</button>
          <button class="btn btn-secondary" onclick="window.GeneratePage.openParsedDir()">打开解析目录</button>
          <button class="btn btn-secondary" onclick="window.GeneratePage.goToStep(3)">返回修改</button>
          <button class="btn btn-secondary" onclick="window.GeneratePage.reset()">再来一次</button>
        </div>
      </div>
    `;
  }

  /**
   * 渲染 CLI 应用内执行模式卡片：显示执行模式切换 + 开始生成按钮 by AI.Coding
   */
  function renderCliInappCard() {
    return `
      <div class="card">
        <div class="card-title" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <span><span style="opacity:0.5; margin-right:8px;">04</span> CLI 模式 — ${escapeHtml(state.selectedCli || 'CLI')}</span>
          <div class="cli-exec-toggle">
            <button class="cli-exec-toggle__btn" onclick="window.GeneratePage.setCliExecMode('terminal')">打开终端</button>
            <button class="cli-exec-toggle__btn active" onclick="window.GeneratePage.setCliExecMode('inapp')">应用内执行</button>
          </div>
        </div>
        <p class="text-muted mb-md">将使用 <strong>${escapeHtml(state.selectedCli || 'CLI')}</strong> 在应用内直接生成 PRD，效果与 API 模式相同。</p>
        <div class="mt-lg" style="display:flex; gap:12px; flex-wrap:wrap;">
          <button class="btn btn-primary" style="padding:12px 32px; font-size:16px;" onclick="window.GeneratePage.startCliInapp()">开始生成 PRD</button>
          <button class="btn btn-secondary" onclick="window.GeneratePage.goToStep(3)">返回修改</button>
        </div>
      </div>
    `;
  }

  /**
   * 渲染步骤4右侧任务列表，生成完成后仍保留状态结果 by AI.Coding
   */
  function renderTaskPanel() {
    if (state.pageStatuses.size === 0) {
      return '';
    }

    const completedCount = Array.from(state.pageStatuses.values()).filter(status => status === 'completed').length;
    return `
      <div class="card step4-side-panel">
        <div class="card-title" style="justify-content:space-between;">
          <span>任务列表</span>
          <span class="task-list-meta">${completedCount} / ${state.pageStatuses.size}</span>
        </div>
        <div id="task-list" class="task-list">
          ${renderTaskItems()}
        </div>
      </div>
    `;
  }

  /**
   * 渲染任务项 HTML，data-status 供样式和 E2E 断言使用 by AI.Coding
   */
  function renderTaskItems() {
    return Array.from(state.pageStatuses.entries()).map(([pageName, status]) => `
      <div class="task-item" data-page-name="${escapeHtml(pageName)}" data-status="${status}">
        <span class="task-item__name">${escapeHtml(pageName)}</span>
        <span class="task-item__status">${getTaskStatusText(status)}</span>
      </div>
    `).join('');
  }

  /**
   * 在不整页重渲染的情况下刷新任务列表 DOM by AI.Coding
   */
  function syncTaskListDom() {
    const list = document.getElementById('task-list');
    if (!list) return;
    list.innerHTML = renderTaskItems();

    const meta = document.querySelector('.task-list-meta');
    if (meta) {
      const completedCount = Array.from(state.pageStatuses.values()).filter(status => status === 'completed').length;
      meta.textContent = `${completedCount} / ${state.pageStatuses.size}`;
    }
  }

  /**
   * 返回任务状态文案，便于用户快速理解当前阶段 by AI.Coding
   */
  function getTaskStatusText(status) {
    const map = {
      pending: '待处理',
      generating: '生成中',
      completed: '已完成',
      failed: '失败',
    };
    return map[status] || '未知';
  }

  /**
   * 取消 API 模式下的当前生成任务 by AI.Coding
   */
  async function cancelGen() {
    if (state.sessionId && state.isGenerating) {
      try {
        await window.electronAPI.cancelGenerate(state.sessionId);
      } catch (e) {
        console.error('Cancel failed', e);
      }
      state.isGenerating = false;
      state.error = { message: '已取消生成' };
      if (unsubscribeProgress) {
        unsubscribeProgress();
        unsubscribeProgress = null;
      }
      renderStep4();
    }
  }

  /**
   * 打开解析目录，供用户查看原始 index.md 与页面文件 by AI.Coding
   */
  async function openParsedDir() {
    if (!state.sessionId) return;
    try {
      await window.electronAPI.openParsedDir(state.sessionId);
    } catch (e) {
      alert('打开解析目录失败: ' + e.message);
    }
  }

  /**
   * 打开输出目录；历史记录已保存 outputDir 时沿用历史接口 by AI.Coding
   */
  async function openOutDir() {
    if (state.historyId) {
      try {
        await window.electronAPI.openHistoryDir(state.historyId);
      } catch (e) {
        alert('打开失败: ' + e.message);
      }
    } else {
      alert('无法获取输出目录路径');
    }
  }

  /**
   * 请求主进程打开系统终端，并回填真实命令预览 by AI.Coding
   * 终端启动失败时在 UI 内提示，不阻断复制操作
   */
  async function openTerminal() {
    if (!state.sessionId || !state.selectedCli) {
      alert('当前 CLI 任务信息不完整，请返回上一步重新选择');
      return;
    }

    const btn = document.getElementById('btn-launch-terminal');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '启动中…';
    }

    try {
      const result = await window.electronAPI.openTerminal({
        sessionId: state.sessionId,
        cliTool: state.selectedCli,
        query: state.query,
        selectedPages: state.selectedPages,
      });

      if (result && result.fullPrompt) {
        state.cliFullPrompt = result.fullPrompt;
        const promptEl = document.getElementById('cli-full-prompt');
        if (promptEl) promptEl.value = result.fullPrompt;
      }
      if (btn) btn.textContent = '已启动';
      setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = '启动终端'; } }, 2000);
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = '启动终端'; }
      // show inline error instead of blocking alert so user can still copy command
      const card = btn && btn.closest('.card');
      if (card) {
        let errEl = card.querySelector('.cli-launch-error');
        if (!errEl) {
          errEl = document.createElement('div');
          errEl.className = 'cli-launch-error';
          errEl.style.cssText = 'color:#ef4444; margin-top:8px; font-size:13px;';
          btn.parentElement.after(errEl);
        }
        errEl.textContent = '⚠ 启动终端失败: ' + e.message + '。请复制上方提示词，手动在终端中执行。';
      }
    }
  }

  /**
   * 重置向导运行态，保留已输入 URL 便于重复生成 by AI.Coding
   */
  function reset() {
    if (unsubscribeProgress) {
      unsubscribeProgress();
      unsubscribeProgress = null;
    }

    state.step = 1;
    state.sessionId = null;
    state.sitemap = null;
    state.pages = [];
    state.parsedDir = '';
    state.engineMode = 'api';
    state.cliExecMode = 'terminal';
    state.selectedProfileId = null;
    state.selectedCli = null;
    state.availableProfiles = [];
    state.cliStatus = {};
    state.query = '';
    state.selectedPages = [];
    state.isGenerating = false;
    state.stats = null;
    state.historyId = null;
    state.error = null;
    state.pageStatuses = new Map();
    state.cliFullPrompt = '';
    render();
  }

  /**
   * 对模板文本做 HTML 转义，防止页面结构被注入破坏 by AI.Coding
   */
  function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return (unsafe + '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * 将指定元素的文本内容复制到剪贴板，按钮短暂显示"已复制" by AI.Coding
   */
  async function copyToClipboard(elementId, label) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const text = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? el.value : el.textContent;
    try {
      await navigator.clipboard.writeText(text || '');
      // find the copy button next to this element and flash feedback
      const card = el.closest('.option-summary-card');
      const btn = card && card.querySelector('.btn');
      if (btn) {
        const original = btn.textContent;
        btn.textContent = '已复制';
        setTimeout(() => { btn.textContent = original; }, 1500);
      }
    } catch (_e) {
      alert(`复制${label || '内容'}失败，请手动选中复制`);
    }
  }

  window.GeneratePage = {
    mount,
    unmount,
    goToStep,
    setEngineMode,
    setProfile,
    setCli,
    nextToStep3,
    togglePageSelection,
    aiSelectPages,
    startGenerate,
    startCliInapp,
    setCliExecMode,
    cancelGen,
    openParsedDir,
    openOutDir,
    openTerminal,
    copyToClipboard,
    reset
  };

})();
