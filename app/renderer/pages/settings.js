/**
 * 设置页
 */

(function() {
  let container = null;
  let profiles = [];
  let cliStatus = null;
  let editingProfile = null;

  async function mount(target) {
    container = target;
    renderSkeleton();
    await loadData();
  }

  function unmount() {
    container = null;
  }

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

  async function loadData() {
    try {
      profiles = await window.electronAPI.listProfiles();
      renderProfiles();
    } catch (e) {
      const list = document.getElementById('profiles-list');
      if (list) list.innerHTML = `<div class="text-danger">加载配置失败: ${e.message}</div>`;
    }

    try {
      cliStatus = await window.electronAPI.detectCli();
      renderCliStatus();
    } catch (e) {
      const cli = document.getElementById('cli-list');
      if (cli) cli.innerHTML = `<div class="text-danger">检测工具失败: ${e.message}</div>`;
    }
  }

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

  async function redetectCli() {
    const list = document.getElementById('cli-list');
    if (list) list.innerHTML = `<div class="text-muted">重新检测中...</div>`;
    
    try {
      cliStatus = await window.electronAPI.redetectCli();
      renderCliStatus();
      if (window.App && window.App.updateFooterStatus) window.App.updateFooterStatus();
    } catch (e) {
      if (list) list.innerHTML = `<div class="text-danger">检测失败: ${e.message}</div>`;
    }
  }

  async function setDefault(id) {
    try {
      await window.electronAPI.setDefaultProfile(id);
      await loadData();
      if (window.App && window.App.updateFooterStatus) window.App.updateFooterStatus();
    } catch (e) {
      alert('设置默认失败: ' + e.message);
    }
  }

  async function deleteProfile(id) {
    if (!confirm('确定要删除此配置吗？')) return;
    try {
      await window.electronAPI.deleteProfile(id);
      await loadData();
      if (window.App && window.App.updateFooterStatus) window.App.updateFooterStatus();
    } catch (e) {
      alert('删除失败: ' + e.message);
    }
  }

  function editProfile(id) {
    editingProfile = profiles.find(p => p.id === id);
    showProfileModal();
  }

  function showProfileModal() {
    const isEdit = !!editingProfile;
    const p = editingProfile || {
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
                <input type="text" class="form-control" id="p-name" value="${escapeHtml(p.name)}" required placeholder="例如: OpenAI GPT-4">
              </div>
              <div class="form-group">
                <label class="form-label">提供商</label>
                <div style="position: relative;">
                  <select class="form-control" id="p-provider">
                    <option value="openai" ${p.provider === 'openai' ? 'selected' : ''}>OpenAI</option>
                    <option value="claude" ${p.provider === 'claude' ? 'selected' : ''}>Claude</option>
                    <option value="deepseek" ${p.provider === 'deepseek' ? 'selected' : ''}>DeepSeek</option>
                    <option value="qwen" ${p.provider === 'qwen' ? 'selected' : ''}>Qwen (通义千问)</option>
                    <option value="ollama" ${p.provider === 'ollama' ? 'selected' : ''}>Ollama</option>
                  </select>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Base URL <span class="text-muted" style="font-weight:400;font-size:12px;margin-left:8px;">(为空则使用官方默认)</span></label>
                <input type="text" class="form-control" id="p-baseUrl" value="${escapeHtml(p.baseUrl)}" placeholder="https://api.openai.com/v1">
              </div>
              <div class="form-group">
                <label class="form-label">API Key</label>
                <input type="password" class="form-control" id="p-apiKey" value="${escapeHtml(p.apiKey)}" placeholder="sk-...">
              </div>
              <div class="form-group mb-sm">
                <label class="form-label">模型 (Model)</label>
                <input type="text" class="form-control" id="p-model" value="${escapeHtml(p.model)}" required placeholder="例如: gpt-4o, claude-3-5-sonnet">
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick="window.SettingsPage.closeModal()">取消</button>
            <button class="btn btn-primary" onclick="document.getElementById('profile-form').requestSubmit()">保存配置</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('modal-container').innerHTML = modalHtml;
  }

  function closeModal() {
    editingProfile = null;
    document.getElementById('modal-container').innerHTML = '';
  }

  async function saveProfile() {
    const name = document.getElementById('p-name').value.trim();
    const provider = document.getElementById('p-provider').value;
    const baseUrl = document.getElementById('p-baseUrl').value.trim();
    const apiKey = document.getElementById('p-apiKey').value.trim();
    const model = document.getElementById('p-model').value.trim();

    if (!name || !model) return;

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
      await loadData();
      if (window.App && window.App.updateFooterStatus) window.App.updateFooterStatus();
    } catch (e) {
      alert('保存失败: ' + e.message);
    }
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

  window.SettingsPage = {
    mount,
    unmount,
    redetectCli,
    setDefault,
    deleteProfile,
    editProfile,
    showProfileModal,
    closeModal,
    saveProfile
  };

})();
