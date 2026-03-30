/**
 * 4步生成向导页面
 */

(function() {
  let container = null;
  let unsubscribeProgress = null;

  // 状态
  const state = {
    step: 1,
    url: '',
    sessionId: null,
    sitemap: null,
    pages: [],
    
    engineMode: 'api', // 'api' | 'cli'
    selectedProfileId: null,
    selectedCli: null,
    
    query: '',
    selectedPages: [],
    
    isGenerating: false,
    stats: null,
    historyId: null,
    error: null,
  };

  /**
   * 挂载页面
   */
  function mount(target) {
    container = target;
    render();
    
    window.addEventListener('axure:regenerate', handleRegenerateEvent);
  }

  /**
   * 卸载页面
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
   * 接收历史记录预填数据
   */
  function handleRegenerateEvent(e) {
    const record = e.detail;
    if (!record) return;

    reset();
    state.url = record.sourceUrl || '';
    state.query = record.query || '';
    
    // History records store engineType/engineName (flat), not engineConfig
    if (record.engineType === 'cli') {
      state.engineMode = 'cli';
      state.selectedCli = record.engineName ? record.engineName.replace(/-cli$/, '') : null;
    } else if (record.engineType === 'api') {
      state.engineMode = 'api';
      // Can't restore profileId from history (profile may have been deleted)
    }
    
    render();
    
    // 如果有 url，尝试自动解析
    if (state.url) {
      setTimeout(() => {
        handleParse();
      }, 100);
    }
  }

  /**
   * 渲染页面
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
        <div class="card" style="max-width: 800px;">
          <div class="card-title">
            <span style="opacity:0.5; margin-right:8px;">01</span> 原型来源
          </div>
          <div class="form-group mt-md">
            <label class="form-label" style="display:flex; justify-content:space-between;">
              <span>Axure 原型在线链接或本地目录路径</span>
            </label>
            <div style="display:flex; gap:12px;">
              <input type="text" class="form-control" id="generate-url" placeholder="例如：https://sharecloud.seeyoncloud.com/..." value="${escapeHtml(state.url)}">
              <button class="btn btn-primary" id="btn-parse" style="min-width:120px;">解析原型</button>
            </div>
          </div>
          
          <div id="parse-result" class="mt-md"></div>
        </div>
      </div>

      <div class="step-content ${state.step === 2 ? 'active' : ''}" id="step2-content">
        <!-- 动态渲染 -->
      </div>

      <div class="step-content ${state.step === 3 ? 'active' : ''}" id="step3-content">
        <!-- 动态渲染 -->
      </div>

      <div class="step-content ${state.step === 4 ? 'active' : ''}" id="step4-content">
        <!-- 动态渲染 -->
      </div>
    `;

    bindEvents();
    
    // 如果在非步骤1，渲染相应的内容
    if (state.step === 2) renderStep2();
    if (state.step === 3) renderStep3();
    if (state.step === 4) renderStep4();
  }

  function getStepName(step) {
    const names = { 1: '解析原型', 2: '选择引擎', 3: '输入需求', 4: '生成 PRD' };
    return names[step];
  }

  function bindEvents() {
    const btnParse = document.getElementById('btn-parse');
    if (btnParse) {
      btnParse.addEventListener('click', handleParse);
    }
  }

  /**
   * 允许点击已完成的步骤回退
   */
  function goToStep(step) {
    if (state.isGenerating) return; // 生成中不可切换
    if (step < state.step) {
      state.step = step;
      render();
    }
  }

  /**
   * 处理步骤1：解析原型
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
      const res = await window.electronAPI.convert(url);
      
      state.sessionId = res.sessionId;
      state.sitemap = res.sitemap;
      state.pages = res.pages; // [{id, name, path}, ...]
      
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
   * 渲染步骤2：选择引擎
   */
  async function renderStep2() {
    const step2 = document.getElementById('step2-content');
    step2.innerHTML = '<div class="text-muted">加载配置中...</div>';
    
    try {
      const profiles = await window.electronAPI.listProfiles();
      const cliStatus = await window.electronAPI.detectCli();
      
      const defaultProfile = profiles.find(p => p.isDefault) || profiles[0];
      if (defaultProfile && !state.selectedProfileId) {
        state.selectedProfileId = defaultProfile.id;
      }
      
      let html = `
        <div class="card" style="max-width: 800px;">
          <div class="card-title">
            <span style="opacity:0.5; margin-right:8px;">02</span> 选择驱动引擎
          </div>
          
          <div class="form-group mt-md" style="padding: 16px; border: 1px solid ${state.engineMode === 'api' ? 'var(--color-primary)' : 'var(--color-border)'}; border-radius: var(--border-radius-sm); background: ${state.engineMode === 'api' ? 'rgba(255,255,255,0.02)' : 'transparent'}; transition: all 0.2s;">
            <label class="form-label" style="display:flex; align-items:center; margin-bottom:0; cursor:pointer;">
              <input type="radio" name="engineMode" value="api" ${state.engineMode === 'api' ? 'checked' : ''} onchange="window.GeneratePage.setEngineMode('api')">
              <span style="font-weight:600; font-size:15px;">通过 API 调用</span>
            </label>
            <div class="mt-md" style="display: ${state.engineMode === 'api' ? 'block' : 'none'}; padding-left: 28px;">
              ${profiles.length === 0 
                ? '<div class="text-muted mb-sm">暂无配置，请先在设置中添加</div>' 
                : `<select class="form-control" id="profile-select" onchange="window.GeneratePage.setProfile(this.value)">
                    ${profiles.map(p => `
                      <option value="${p.id}" ${state.selectedProfileId === p.id ? 'selected' : ''}>
                        ${escapeHtml(p.name)} (${escapeHtml(p.provider)})
                      </option>
                    `).join('')}
                   </select>`
              }
            </div>
          </div>
          
          <div class="form-group mt-md" style="padding: 16px; border: 1px solid ${state.engineMode === 'cli' ? 'var(--color-primary)' : 'var(--color-border)'}; border-radius: var(--border-radius-sm); background: ${state.engineMode === 'cli' ? 'rgba(255,255,255,0.02)' : 'transparent'}; transition: all 0.2s;">
            <label class="form-label" style="display:flex; align-items:center; margin-bottom:0; cursor:pointer;">
              <input type="radio" name="engineMode" value="cli" ${state.engineMode === 'cli' ? 'checked' : ''} onchange="window.GeneratePage.setEngineMode('cli')">
              <span style="font-weight:600; font-size:15px;">通过本地 CLI 调用</span>
            </label>
            <div class="mt-md" style="display: ${state.engineMode === 'cli' ? 'block' : 'none'}; padding-left: 28px;">
              <select class="form-control" id="cli-select" onchange="window.GeneratePage.setCli(this.value)">
                <option value="">-- 请选择检测到的工具 --</option>
                ${Object.entries(cliStatus).map(([name, isOk]) => `
                  <option value="${name}" ${!isOk ? 'disabled' : ''} ${state.selectedCli === name ? 'selected' : ''}>
                    ${name} ${isOk ? '✓ (已安装)' : '✕ (未安装)'}
                  </option>
                `).join('')}
              </select>
            </div>
          </div>
          
          <div class="mt-lg">
            <button class="btn btn-primary" onclick="window.GeneratePage.nextToStep3()">下一步：填写需求</button>
          </div>
        </div>
      `;
      step2.innerHTML = html;
    } catch (e) {
      step2.innerHTML = `<div class="text-danger">加载失败: ${e.message}</div>`;
    }
  }

  function setEngineMode(mode) {
    state.engineMode = mode;
    renderStep2(); // 重新渲染当前步骤以展示正确的下拉框
  }

  function setProfile(id) {
    state.selectedProfileId = id;
  }
  
  function setCli(name) {
    state.selectedCli = name;
  }

  function nextToStep3() {
    if (state.engineMode === 'api' && !state.selectedProfileId) {
      alert('请选择 API 配置');
      return;
    }
    if (state.engineMode === 'cli' && !state.selectedCli) {
      alert('请选择有效的 CLI 工具');
      return;
    }
    
    // 如果 selectedPages 尚未初始化，默认全选
    if (state.selectedPages.length === 0 && state.pages) {
      state.selectedPages = state.pages.map(p => p.id);
    }
    
    state.step = 3;
    render();
  }

  /**
   * 渲染步骤3：输入需求
   */
  function renderStep3() {
    const step3 = document.getElementById('step3-content');
    
    let html = `
      <div class="card" style="max-width: 800px;">
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
            ${state.pages.map(p => `
              <label class="check-item">
                <input type="checkbox" value="${p.id}" onchange="window.GeneratePage.togglePageSelection(this)"
                  ${state.selectedPages.includes(p.id) ? 'checked' : ''}>
                <span style="font-family:var(--font-mono); font-size:13px; opacity:0.9;">${escapeHtml(p.name)}</span>
              </label>
            `).join('')}
          </div>
        </div>

        <div class="mt-xl" style="padding-top:16px; border-top:1px dashed var(--color-border);">
          <button class="btn btn-primary" style="padding: 12px 32px; font-size:16px;" onclick="window.GeneratePage.startGenerate()">开始生成 PRD</button>
        </div>
      </div>
    `;
    
    step3.innerHTML = html;
  }

  function togglePageSelection(checkbox) {
    const id = checkbox.value;
    if (checkbox.checked) {
      if (!state.selectedPages.includes(id)) state.selectedPages.push(id);
    } else {
      state.selectedPages = state.selectedPages.filter(x => x !== id);
    }
    document.getElementById('sel-count').innerText = state.selectedPages.length;
  }

  async function aiSelectPages() {
    const query = document.getElementById('prd-query').value.trim();
    if (!query) {
      alert('请先输入需求描述，AI 才能进行筛选');
      return;
    }
    
    state.query = query;
    const btn = document.querySelector('.btn-sm');
    btn.disabled = true;
    btn.innerHTML = '<span style="margin-right:6px;">⏳</span> 筛选中...';
    
    try {
      // 构造当前引擎配置信息给主进程
      const engineConfig = getEngineConfig();
      
      const selectedIds = await window.electronAPI.selectPages({
        sessionId: state.sessionId,
        query: state.query,
        engineConfig
      });
      
      // Defensive: ensure IPC result is an array before assigning
      if (!Array.isArray(selectedIds)) {
        throw new Error('AI 筛选返回了非预期格式');
      }
      state.selectedPages = selectedIds;
      renderStep3(); // 重新渲染列表以更新选中状态
      
    } catch (e) {
      alert('AI 筛选失败: ' + e.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<span style="margin-right:6px;">✨</span> AI 智能筛选';
      }
    }
  }

  function getEngineConfig() {
    return {
      mode: state.engineMode,
      profileId: state.selectedProfileId,
      cliTool: state.selectedCli
    };
  }

  /**
   * 处理步骤4：生成中
   */
  async function startGenerate() {
    state.query = document.getElementById('prd-query').value.trim();
    
    if (state.selectedPages.length === 0) {
      alert('请至少选择一个页面');
      return;
    }
    
    state.step = 4;
    state.isGenerating = true;
    state.error = null;
    state.stats = null;
    render();
    
    // 监听进度
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
      renderStep4(); // 渲染完成状态
      
    } catch (e) {
      state.error = e;
      state.isGenerating = false;
      renderStep4();
    }
  }

  function handleProgress(data) {
    if (!document.getElementById('step4-content')) return;
    
    const { type, pageName, chunk, current, total, error } = data;
    
    const preview = document.getElementById('term-preview');
    const pageNameEl = document.getElementById('curr-page-name');
    const barFill = document.getElementById('prog-bar-fill');
    const progText = document.getElementById('prog-text');
    
    if (type === 'page-start') {
      if (pageNameEl) pageNameEl.textContent = `正在生成: ${pageName}...`;
      if (preview) {
        preview.textContent += `\n\n--- 正在处理: ${pageName} ---\n`;
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
      if (preview) {
        preview.textContent += `\n\n❌ 页面「${pageName}」生成失败: ${error}\n`;
        preview.scrollTop = preview.scrollHeight;
      }
      if (barFill && total > 0) {
        barFill.style.width = `${(current / total) * 100}%`;
      }
      if (progText) {
        progText.textContent = `${current} / ${total}`;
      }
    }
  }

  function renderStep4() {
    const step4 = document.getElementById('step4-content');
    if (!step4) return;
    
    if (state.isGenerating) {
      step4.innerHTML = `
        <div class="card" style="max-width: 800px; border-color:var(--color-border-focus);">
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
      step4.innerHTML = `
        <div class="card" style="max-width: 800px; border-color:rgba(239, 68, 68, 0.4);">
          <div class="card-title text-danger">生成失败 / 取消</div>
          <div class="mt-md" style="font-family:var(--font-mono); font-size:13px; color:var(--color-text-secondary); background:rgba(0,0,0,0.3); padding:16px; border-radius:6px;">${escapeHtml(state.error.message || String(state.error))}</div>
          <div class="mt-lg">
            <button class="btn btn-primary" onclick="window.GeneratePage.goToStep(3)">返回重试</button>
          </div>
        </div>
      `;
    } else if (state.stats) {
      const failed = (state.stats.selectedPages || 0) - (state.stats.processedPages || 0);
      step4.innerHTML = `
        <div class="card" style="max-width: 800px; border-color:rgba(16, 185, 129, 0.3);">
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
  }

  async function cancelGen() {
    if (state.sessionId && state.isGenerating) {
      try {
        await window.electronAPI.cancelGenerate(state.sessionId);
      } catch (e) {
        console.error('Cancel failed', e);
      }
    }
  }

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

  function reset() {
    state.step = 1;
    state.sessionId = null;
    state.sitemap = null;
    state.pages = [];
    state.query = '';
    state.selectedPages = [];
    state.isGenerating = false;
    state.stats = null;
    state.historyId = null;
    state.error = null;
    render();
  }

  function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return (unsafe + '')
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // 暴露给 window 以供内部 HTML 事件调用
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
    cancelGen,
    openOutDir,
    reset
  };
})();
