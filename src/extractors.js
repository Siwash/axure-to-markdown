/**
 * Extract metadata from Axure data.js parsed objects.
 */
function extractWidgetMeta(objects, metaMap, interactions, depth = 0) {
  if (!Array.isArray(objects)) return;

  for (const obj of objects) {
    if (!obj) continue;

    const id = obj.id || '';
    const meta = {
      label: obj.label || obj.name || '',
      type: obj.type || '',
      styleType: obj.friendlyType || '',
      notes: [],
      hasInteraction: false,
    };

    if (obj.notes) meta.notes = extractNotes(obj.notes);
    if (obj.annotation) meta.notes = meta.notes.concat(extractAnnotation(obj.annotation));

    if (obj.interactionMap && Object.keys(obj.interactionMap).length > 0) {
      meta.hasInteraction = true;
      const descs = describeInteractions(obj.interactionMap, meta.label || id);
      interactions.push(...descs);
    }

    if (id) metaMap[id] = meta;

    // Recurse into children
    if (obj.objects) extractWidgetMeta(obj.objects, metaMap, interactions, depth + 1);
    if (obj.diagrams) {
      for (const diag of obj.diagrams) {
        if (diag.objects) extractWidgetMeta(diag.objects, metaMap, interactions, depth + 1);
      }
    }
  }
}

function extractNotes(notes) {
  if (!notes) return [];
  if (typeof notes === 'string') return [{ key: '备注', value: notes }];
  if (Array.isArray(notes)) {
    return notes.map(n =>
      typeof n === 'string'
        ? { key: '备注', value: n }
        : { key: n.name || '备注', value: n.text || n.value || '' }
    );
  }
  if (typeof notes === 'object') {
    return Object.entries(notes).map(([k, v]) => ({
      key: k,
      value: typeof v === 'string' ? v : JSON.stringify(v),
    }));
  }
  return [];
}

function extractAnnotation(annotation) {
  if (!annotation) return [];
  const results = [];
  if (annotation.fields) {
    for (const f of annotation.fields) {
      if (f.value && f.value.trim()) {
        results.push({ key: f.name || '注释', value: f.value });
      }
    }
  } else if (typeof annotation === 'object') {
    for (const [k, v] of Object.entries(annotation)) {
      if (typeof v === 'string' && v.trim()) {
        results.push({ key: k, value: v });
      }
    }
  }
  return results;
}

const EVENT_LABELS = {
  onClick: '点击时', onDoubleClick: '双击时', onMouseEnter: '悬停时',
  onMouseLeave: '移出时', onFocus: '聚焦时', onBlur: '失焦时',
  onChange: '值变化时', onLoad: '加载时', onPageLoad: '页面加载时',
  onSwipeLeft: '左滑时', onSwipeRight: '右滑时', onTextChange: '文字变化时',
  onCheckedChange: '选中变化时', onKeyDown: '按键时', onScroll: '滚动时',
  onSelect: '选中时', onResize: '窗口变化时',
};

const ACTION_LABELS = {
  linkWindow: '跳转页面', showWidget: '显示组件', hideWidget: '隐藏组件',
  toggleVisibility: '切换显隐', setText: '设置文字', setImage: '设置图片',
  setPanelState: '切换面板状态', openPopup: '打开弹窗', closePopup: '关闭弹窗',
  setVariableValue: '设置变量', scrollTo: '滚动到', setSelected: '设置选中',
  setEnabled: '设置启用', moveWidget: '移动组件', fadeWidget: '淡入淡出',
  fireEvent: '触发事件', wait: '等待', setCondition: '条件判断',
  setFunction: '设置值', linkUrl: '打开链接',
};

function describeInteractions(interactionMap, widgetName) {
  const results = [];
  for (const [event, eventData] of Object.entries(interactionMap)) {
    const eventName = EVENT_LABELS[event] || event;
    const cases = eventData.cases || [eventData];

    for (const c of cases) {
      const actions = c.actions || [];
      const actionDescs = [];
      for (const a of actions) {
        const aName = ACTION_LABELS[a.action] || a.action || '?';
        let detail = '';
        if (a.target?.url) detail = ` → ${decodeURIComponent(a.target.url).replace('.html', '')}`;
        if (a.target?.pageName) detail = ` → ${a.target.pageName}`;
        actionDescs.push(`${aName}${detail}`);
      }
      if (actionDescs.length > 0) {
        const cond = c.condition
          ? ` [条件: ${c.condition.expressionString || c.condition.description || '有条件'}]`
          : '';
        results.push({
          widget: widgetName,
          event: eventName,
          actions: actionDescs.join(' → '),
          condition: cond,
        });
      }
    }
  }
  return results;
}

module.exports = { extractWidgetMeta, extractNotes, extractAnnotation, describeInteractions };
