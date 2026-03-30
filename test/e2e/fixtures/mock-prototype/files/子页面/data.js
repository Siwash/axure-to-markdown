$axure.loadCurrentPage({
  notes: '子页面功能描述',
  diagram: {
    objects: [
      {
        id: 'u1',
        label: '按钮组件',
        type: 'buttonShape',
        interactionMap: {
          onClick: {
            cases: [{ actions: [{ action: 'linkWindow', target: { pageName: '首页' } }] }]
          }
        }
      }
    ]
  },
  objectPaths: { u1: '按钮组件' }
});
