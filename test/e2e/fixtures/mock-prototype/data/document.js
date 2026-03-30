$axure.loadDocument({
  configuration: {
    projectName: 'E2E Mock Prototype'
  },
  sitemap: {
    rootNodes: [
      {
        pageName: '首页',
        type: 'Wireframe',
        url: 'page1.html',
        id: 'p1',
        children: [
          { pageName: '子页面', type: 'Wireframe', url: 'page2.html', id: 'p2', children: [] }
        ]
      }
    ]
  }
});
