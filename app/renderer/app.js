/**
 * SPA 路由管理器及全局状态
 * 监听 URL hash 变化，切换页面组件
 */

(function() {
  const routerView = document.getElementById('router-view');
  const navItems = document.querySelectorAll('.nav-item');
  const appFooter = document.getElementById('app-footer');

  // 当前激活的页面
  let currentPage = null;

  // 路由映射表
  const routes = {
    '#generate': window.GeneratePage,
    '#history': window.HistoryPage,
    '#settings': window.SettingsPage,
  };

  /**
   * 处理路由切换
   */
  async function handleHashChange() {
    const hash = window.location.hash || '#generate';
    const page = routes[hash];

    if (!page) {
      window.location.hash = '#generate';
      return;
    }

    // 卸载旧页面
    if (currentPage && currentPage.unmount) {
      currentPage.unmount();
    }

    // 更新导航高亮
    navItems.forEach(item => {
      if (item.getAttribute('href') === hash) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    // 挂载新页面
    routerView.innerHTML = '';
    currentPage = page;
    if (page.mount) {
      page.mount(routerView);
    }
  }

  /**
   * 更新底部状态指示器
   */
  async function updateFooterStatus() {
    try {
      const cliStatus = await window.electronAPI.detectCli();
      const appInfo = await window.electronAPI.getAppInfo();
      const profiles = await window.electronAPI.listProfiles();
      const defaultProfile = profiles.find(p => p.isDefault);

      let tools = [];
      if (cliStatus.claude) tools.push('claude');
      if (cliStatus.codex) tools.push('codex');
      if (cliStatus.opencode) tools.push('opencode');

      let engineText = '暂无默认配置';
      if (defaultProfile) {
        engineText = `${defaultProfile.name} (${defaultProfile.provider})`;
      } else if (tools.length > 0) {
        engineText = `CLI模式: ${tools.join(', ')}`;
      }

      appFooter.innerHTML = `
        <div style="margin-bottom: 4px; opacity: 0.8;">v${appInfo.version}</div>
        <div class="mt-xs">默认引擎: <span style="color: var(--color-text-primary); font-weight: 600;">${engineText}</span></div>
      `;
    } catch (error) {
      console.error('获取底部状态失败:', error);
      appFooter.innerHTML = '<div>状态获取失败</div>';
    }
  }

  // 初始化应用
  window.addEventListener('hashchange', handleHashChange);
  
  // 暴露一个全局方法，以便其他页面需要时更新状态
  window.App = {
    updateFooterStatus
  };

  // 启动路由
  handleHashChange();
  updateFooterStatus();
})();
