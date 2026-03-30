/**
 * 历史记录页
 */

(function() {
  let container = null;
  let records = [];
  let searchTimeout = null;

  async function mount(target) {
    container = target;
    renderSkeleton();
    await loadData('');
    
    const searchInput = document.getElementById('history-search');
    if (searchInput) {
      searchInput.addEventListener('input', handleSearch);
    }
  }

  function unmount() {
    container = null;
  }

  function renderSkeleton() {
    if (!container) return;
    container.innerHTML = `
      <div class="page-header">
        <h2 class="page-title">历史记录</h2>
      </div>

      <div class="form-group mb-lg">
        <input type="text" class="form-control" id="history-search" placeholder="搜索 URL、需求描述或来源...">
      </div>

      <div id="history-list" class="card-list">
        <div class="text-muted">加载中...</div>
      </div>
    `;
  }

  function handleSearch(e) {
    const text = e.target.value.trim();
    if (searchTimeout) clearTimeout(searchTimeout);
    
    searchTimeout = setTimeout(() => {
      loadData(text);
    }, 300);
  }

  async function loadData(search = '') {
    try {
      records = await window.electronAPI.listHistory(search);
      renderList();
    } catch (e) {
      const list = document.getElementById('history-list');
      if (list) list.innerHTML = `<div class="text-danger">加载失败: ${e.message}</div>`;
    }
  }

  function renderList() {
    const list = document.getElementById('history-list');
    if (!list) return;

    if (records.length === 0) {
      list.innerHTML = `<div class="text-muted" style="text-align:center; padding: 40px; border: 1px dashed var(--color-border); border-radius: var(--border-radius-md);">暂无历史记录</div>`;
      return;
    }

    list.innerHTML = records.map(r => {
      const timeStr = new Date(r.createdAt || Date.now()).toLocaleString();
      const queryPreview = r.query ? (r.query.length > 50 ? r.query.substring(0, 50) + '...' : r.query) : '无明确需求';
      
      let engineText = '未知引擎';
      if (r.engineType === 'cli') {
        engineText = `CLI (${r.engineName || 'unknown'})`;
      } else if (r.engineType === 'api') {
        engineText = `API (${r.engineName || 'unknown'})`;
      }

      const pageCount = r.stats
        ? (r.stats.selectedPages || r.stats.totalPages || 0)
        : (r.selectedPages ? r.selectedPages.length : 0);

      return `
        <div class="card history-card">
          <div class="history-info">
            <div class="card-title" style="margin-bottom:4px;">${escapeHtml(queryPreview)}</div>
            <div class="history-meta">
              <span><span style="opacity:0.6;margin-right:4px;">⏱</span>${timeStr}</span> &bull; 
              <span><span style="opacity:0.6;margin-right:4px;">📄</span>共 ${pageCount} 页</span> &bull; 
              <span><span style="opacity:0.6;margin-right:4px;">⚙️</span>${escapeHtml(engineText)}</span>
            </div>
            <div class="history-meta mt-sm" style="font-family:var(--font-mono); font-size:12px;">
              <span style="opacity:0.5;margin-right:6px;">🔗</span>${escapeHtml(r.sourceUrl || '未知URL')}
            </div>
          </div>
          <div class="history-actions">
            <button class="btn btn-primary btn-sm" onclick="window.HistoryPage.openDir('${r.id}')">打开目录</button>
            <button class="btn btn-secondary btn-sm" onclick="window.HistoryPage.regenerate('${r.id}')">重新生成</button>
            <button class="btn btn-secondary btn-sm" style="color:var(--color-danger); border-color:transparent;" onclick="window.HistoryPage.deleteRecord('${r.id}')">删除</button>
          </div>
        </div>
      `;
    }).join('');
  }

  async function openDir(id) {
    try {
      await window.electronAPI.openHistoryDir(id);
    } catch (e) {
      alert('打开失败: ' + e.message);
    }
  }

  function regenerate(id) {
    const record = records.find(r => r.id === id);
    if (!record) return;

    // 分发事件通知 GeneratePage 预填数据
    const event = new CustomEvent('axure:regenerate', { detail: record });
    window.dispatchEvent(event);
    
    // 跳转
    window.location.hash = '#generate';
  }

  async function deleteRecord(id) {
    if (!confirm('确定要删除这条记录吗？物理文件不会被删除。')) return;
    try {
      await window.electronAPI.deleteHistory(id);
      const searchInput = document.getElementById('history-search');
      await loadData(searchInput ? searchInput.value.trim() : '');
    } catch (e) {
      alert('删除失败: ' + e.message);
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

  window.HistoryPage = {
    mount,
    unmount,
    openDir,
    regenerate,
    deleteRecord
  };

})();
