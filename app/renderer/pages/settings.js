/**
 * 设置页 by AI.Coding
 */

(function() {
  let container = null;
  let profiles = [];
  let cliStatus = null;
  let editingProfile = null;
  let outputDir = '';

  const PROVIDER_OPTIONS = [
    { value: 'openai', label: 'OpenAI', desc: '官方兼容接口' },
    { value: 'claude', label: 'Claude', desc: 'Anthropic 兼容接口' },
    { value: 'deepseek', label: 'DeepSeek', desc: 'DeepSeek 兼容接口' },
    { value: 'qwen', label: 'Qwen', desc: '通义千问兼容接口' },
    { value: 'ollama', label: 'Ollama', desc: '本地模型服务' },
  ];

  /**
   * 挂载设置页并加载全部数据 by AI.Coding
   */
  async function mount(target) {
    container = target;
    renderSkeleton();
    await loadData();
  }

  /**
   * 卸载设置页并释放容器引用 by AI.Coding
   */
  function unmount() {
    container = null;
  }

  /**
   * 渲染设置页骨架，确保异步数据加载前有稳定占位 by AI.Coding
   */
  function renderSkeleton() {
    if (!container) return;

    container.innerHTML = `
      <div class="page-header">
        <h2 class="page-title">设置</h2>
      </div>

      <div class="card mb-lg">
        <div class="card-title" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--color-border); padding-bottom: 16px; margin-bottom: 16px;">
          <span>LLM API 配置</span>
          <button class="btn btn-primary btn-sm" onclick="window.SettingsPage.showProfileModal()">+ 新建配置</button>
        </div>
        <div id="profiles-list" class="card-list">
          <div class="text-muted">加载中...</div>
        </div>
      </div>

      <div class="card mb-lg" id="output-dir-section">
        <div class="card-title" style="border-bottom: 1px solid var(--color-border); padding-bottom: 16px; margin-bottom: 16px;">
          输出目录
        </div>
        <div class="text-muted mb-md">为空时使用应用默认目录；设置后新的生成任务会写入到这里。</div>
        <div class="option-summary-card">
          <div>
            <div class="option-summary-label">当前输出路径</div>
            <div id="output-dir-path" class="option-summary-value">加载中...</div>
          </div>
          <div class="option-summary-actions">
            <button class="btn btn-secondary btn-sm" id="btn-browse-output-dir" onclick="window.SettingsPage.browseOutputDir()">浏览目录</button>
            <button class="btn btn-secondary btn-sm" id="btn-reset-output-dir" onclick="window.SettingsPage.resetOutputDir()">重置默认</button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--color-border); padding-bottom: 16px; margin-bottom: 16px;">
          <span>本地 CLI 工具检测</span>
          <button class="btn btn-secondary btn-sm" onclick="window.SettingsPage.redetectCli()">重新检测</button>
        </div>
        <div id="cli-list">
          <div class="text-muted">检测中...</div>
        </div>
      </div>
    `;
  }

  /**
   * 并行加载配置、输出目录和 CLI 状态，避免页面多次闪烁 by AI.Coding
   */
  async function loadData() {
    await Promise.all([
      loadProfiles(),
      loadOutputDir(),
      loadCliStatus(),
    ]);
  }

  /**
   * 加载配置列表并刷新卡片展示 by AI.Coding
   */
  async function loadProfiles() {
    try {
      profiles = await window.electronAPI.listProfiles();
      renderProfiles();
    } catch (e) {
      const list = document.getElementById('profiles-list');
      if (list) list.innerHTML = `<div class="text-danger">加载配置失败: ${escapeHtml(e.message)}</div>`;
    }
  }

  /**
   * 加载输出目录配置并同步展示文案 by AI.Coding
   */
  async function loadOutputDir() {
    try {
      const result = await window.electronAPI.getOutputDir();
      outputDir = result && result.outputDir ? String(result.outputDir) : '';
      renderOutputDir();
    } catch (e) {
      const pathEl = document.getElementById('output-dir-path');
      if (pathEl) pathEl.textContent = `加载失败: ${e.message}`;
    }
  }

  /**
   * 加载 CLI 检测结果并刷新列表 by AI.Coding
   */
  async function loadCliStatus() {
    try {
      cliStatus = await window.electronAPI.detectCli();
      renderCliStatus();
    } catch (e) {
      const cli = document.getElementById('cli-list');
      if (cli) cli.innerHTML = `<div class="text-danger">检测工具失败: ${escapeHtml(e.message)}</div>`;
    }
  }

  /**
   * 渲染配置卡片列表 by AI.Coding
   */
  function renderProfiles() {
    const list = document.getElementById('profiles-list');
    if (!list) return;

    if (profiles.length === 0) {
      list.innerHTML = `<div class="text-muted">暂无配置，请点击右上角新建。</div>`;
      return;
    }

    list.innerHTML = profiles.map(p => `
      <div class="card profile-card" style="margin-bottom:0; box-shadow: none; background: rgba(255,255,255,0.02);">
        <div class="profile-info">
          <div class="profile-name">
            ${escapeHtml(p.name)}
            ${p.isDefault ? '<span class="profile-badge-default">默认</span>' : ''}
          </div>
          <div class="profile-details mt-sm" style="display: flex; gap: 12px; color: var(--color-text-muted);">
            <span>${escapeHtml(p.provider)}</span>
            <span>&bull;</span>
            <span>${escapeHtml(p.model || '默认模型')}</span>
          </div>
        </div>
        <div class="profile-actions">
          ${!p.isDefault ? `<button class="btn btn-secondary btn-sm" onclick="window.SettingsPage.setDefault('${p.id}')">设为默认</button>` : ''}
          <button class="btn btn-secondary btn-sm" onclick="window.SettingsPage.editProfile('${p.id}')">编辑</button>
          <button class="btn btn-danger btn-sm" onclick="window.SettingsPage.deleteProfile('${p.id}')">删除</button>
        </div>
      </div>
    `).join('');
  }

  /**
   * 渲染输出目录摘要，统一处理默认路径文案 by AI.Coding
   */
  function renderOutputDir() {
    const pathEl = document.getElementById('output-dir-path');
    if (!pathEl) return;

    pathEl.textContent = outputDir || '默认输出目录（按历史记录自动创建）';
  }

  /**
   * 渲染 CLI 检测状态列表 by AI.Coding
   */
  function renderCliStatus() {
    const list = document.getElementById('cli-list');
    if (!list || !cliStatus) return;

    list.innerHTML = ['claude', 'codex', 'opencode'].map(name => `
      <div class="cli-status-item">
        <div class="cli-name">${name}</div>
        <div class="cli-status ${cliStatus[name] ? 'success' : 'error'}">
          ${cliStatus[name] ? '<span style="color:var(--color-success)">✓</span> 已安装' : '<span style="color:var(--color-text-muted)">✕</span> 未检测到'}
        </div>
      </div>
    `).join('');
  }

  /**
   * 手动重新检测 CLI 工具，并刷新页脚状态 by AI.Coding
   */
  async function redetectCli() {
    const list = document.getElementById('cli-list');
    if (list) list.innerHTML = `<div class="text-muted">重新检测中...</div>`;

    try {
      cliStatus = await window.electronAPI.redetectCli();
      renderCliStatus();
      if (window.App && window.App.updateFooterStatus) window.App.updateFooterStatus();
    } catch (e) {
      if (list) list.innerHTML = `<div class="text-danger">检测失败: ${escapeHtml(e.message)}</div>`;
    }
  }

  /**
   * 触发系统目录选择器并保存结果 by AI.Coding
   */
  async function browseOutputDir() {
    try {
      const result = await window.electronAPI.selectOutputDir();
      const nextDir = result && result.outputDir ? String(result.outputDir) : '';
      await window.electronAPI.setOutputDir(nextDir);
      outputDir = nextDir;
      renderOutputDir();
    } catch (e) {
      alert('选择输出目录失败: ' + e.message);
    }
  }

  /**
   * 清空自定义输出目录，恢复默认策略 by AI.Coding
   */
  async function resetOutputDir() {
    try {
      await window.electronAPI.setOutputDir('');
      outputDir = '';
      renderOutputDir();
    } catch (e) {
      alert('重置输出目录失败: ' + e.message);
    }
  }

  /**
   * 设置默认配置并刷新页面状态 by AI.Coding
   */
  async function setDefault(id) {
    try {
      await window.electronAPI.setDefaultProfile(id);
      await loadProfiles();
      if (window.App && window.App.updateFooterStatus) window.App.updateFooterStatus();
    } catch (e) {
      alert('设置默认失败: ' + e.message);
    }
  }

  /**
   * 删除指定配置并刷新页面状态 by AI.Coding
   */
  async function deleteProfile(id) {
    if (!confirm('确定要删除此配置吗？')) return;

    try {
      await window.electronAPI.deleteProfile(id);
      await loadProfiles();
      if (window.App && window.App.updateFooterStatus) window.App.updateFooterStatus();
    } catch (e) {
      alert('删除失败: ' + e.message);
    }
  }

  /**
   * 进入编辑模式并打开配置弹窗 by AI.Coding
   */
  function editProfile(id) {
    editingProfile = profiles.find(p => p.id === id) || null;
    showProfileModal();
  }

  /**
   * 渲染配置弹窗，使用平铺卡片代替原生下拉框 by AI.Coding
   */
  function showProfileModal() {
    const isEdit = !!editingProfile;
    const profile = editingProfile || {
      name: '', provider: 'openai', baseUrl: '', apiKey: '', model: ''
    };

    const modalHtml = `
      <div class="modal-overlay active" id="profile-modal">
        <div class="modal-content">
          <div class="modal-header">
            <div class="modal-title">${isEdit ? '编辑配置' : '新建配置'}</div>
            <button class="modal-close" onclick="window.SettingsPage.closeModal()">&times;</button>
          </div>
          <div class="modal-body">
            <form id="profile-form" onsubmit="event.preventDefault(); window.SettingsPage.saveProfile();">
              <div class="form-group">
                <label class="form-label">配置名称</label>
                <input type="text" class="form-control" id="p-name" value="${escapeHtml(profile.name)}" required placeholder="例如: OpenAI GPT-4">
              </div>
              <div class="form-group">
                <label class="form-label">提供商</label>
                <input type="hidden" id="p-provider" value="${escapeHtml(profile.provider)}">
                <div class="option-grid provider-option-grid">
                  ${PROVIDER_OPTIONS.map(option => `
                    <button
                      type="button"
                      class="option-tile provider-option ${profile.provider === option.value ? 'active' : ''}"
                      data-value="${option.value}"
                      onclick="window.SettingsPage.selectProvider('${option.value}')"
                    >
                      <span class="option-tile__title">${escapeHtml(option.label)}</span>
                      <span class="option-tile__desc">${escapeHtml(option.desc)}</span>
                    </button>
                  `).join('')}
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Base URL <span class="text-muted" style="font-weight:400;font-size:12px;margin-left:8px;">(为空则使用官方默认)</span></label>
                <input type="text" class="form-control" id="p-baseUrl" value="${escapeHtml(profile.baseUrl)}" placeholder="https://api.openai.com/v1">
              </div>
              <div class="form-group">
                <label class="form-label">API Key</label>
                <input type="password" class="form-control" id="p-apiKey" value="${escapeHtml(profile.apiKey)}" placeholder="sk-...">
              </div>
              <div class="form-group mb-sm">
                <label class="form-label">模型 (Model)</label>
                <input type="text" class="form-control" id="p-model" value="${escapeHtml(profile.model)}" required placeholder="例如: gpt-4o, claude-3-5-sonnet">
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="window.SettingsPage.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="document.getElementById('profile-form').requestSubmit()">保存</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('modal-container').innerHTML = modalHtml;
  }

  /**
   * 切换当前选中的提供商卡片，并同步隐藏字段值 by AI.Coding
   */
  function selectProvider(provider) {
    const input = document.getElementById('p-provider');
    if (input) {
      input.value = provider;
    }

    document.querySelectorAll('.provider-option').forEach(node => {
      node.classList.toggle('active', node.dataset.value === provider);
    });
  }

  /**
   * 关闭弹窗并重置编辑上下文，避免残留旧数据 by AI.Coding
   */
  function closeModal() {
    editingProfile = null;
    document.getElementById('modal-container').innerHTML = '';
  }

  /**
   * 保存配置表单数据，沿用既有 IPC 存储逻辑 by AI.Coding
   */
  async function saveProfile() {
    const name = document.getElementById('p-name').value.trim();
    const provider = document.getElementById('p-provider').value.trim();
    const baseUrl = document.getElementById('p-baseUrl').value.trim();
    const apiKey = document.getElementById('p-apiKey').value.trim();
    const model = document.getElementById('p-model').value.trim();

    if (!name || !provider || !model) return;

    const data = {
      ...(editingProfile ? { id: editingProfile.id } : {}),
      name,
      provider,
      baseUrl,
      apiKey,
      model
    };

    try {
      await window.electronAPI.saveProfile(data);
      closeModal();
      await loadProfiles();
      if (window.App && window.App.updateFooterStatus) window.App.updateFooterStatus();
    } catch (e) {
      alert('保存失败: ' + e.message);
    }
  }

  /**
   * 对文本做 HTML 转义，避免模板字符串插值产生结构污染 by AI.Coding
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

  window.SettingsPage = {
    mount,
    unmount,
    redetectCli,
    browseOutputDir,
    resetOutputDir,
    setDefault,
    deleteProfile,
    editProfile,
    showProfileModal,
    selectProvider,
    closeModal,
    saveProfile
  };

})();
