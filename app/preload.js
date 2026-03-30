// contextBridge 预加载脚本 by AI.Coding
const { contextBridge, ipcRenderer } = require('electron');

/**
 * 调用主进程解析 Axure 原型 by AI.Coding
 */
function convert(source) {
  return ipcRenderer.invoke('axure:convert', { source });
}

/**
 * 调用主进程执行 AI 页面筛选 by AI.Coding
 */
function selectPages(params) {
  return ipcRenderer.invoke('axure:select-pages', params);
}

/**
 * 调用主进程开始生成 PRD by AI.Coding
 */
function generate(params) {
  return ipcRenderer.invoke('axure:generate', params);
}

/**
 * 调用主进程取消当前生成任务 by AI.Coding
 */
function cancelGenerate(sessionId) {
  return ipcRenderer.invoke('axure:cancel', { sessionId });
}

/**
 * 订阅主进程推送的生成进度，并返回解绑函数 by AI.Coding
 */
function onProgress(callback) {
  const handler = (_event, data) => callback(data);
  ipcRenderer.on('axure:progress', handler);

  // 返回清理函数，避免页面切换后残留重复监听器。
  return () => ipcRenderer.removeListener('axure:progress', handler);
}

/**
 * 获取全部 LLM 配置 by AI.Coding
 */
function listProfiles() {
  return ipcRenderer.invoke('profile:list');
}

/**
 * 新建或更新 LLM 配置 by AI.Coding
 */
function saveProfile(profile) {
  return ipcRenderer.invoke('profile:save', profile);
}

/**
 * 删除指定 LLM 配置 by AI.Coding
 */
function deleteProfile(id) {
  return ipcRenderer.invoke('profile:delete', { id });
}

/**
 * 设置默认 LLM 配置 by AI.Coding
 */
function setDefaultProfile(id) {
  return ipcRenderer.invoke('profile:set-default', { id });
}

/**
 * 查询历史记录列表 by AI.Coding
 */
function listHistory(search) {
  return ipcRenderer.invoke('history:list', { search });
}

/**
 * 删除指定历史记录 by AI.Coding
 */
function deleteHistory(id) {
  return ipcRenderer.invoke('history:delete', { id });
}

/**
 * 打开指定历史记录的输出目录 by AI.Coding
 */
function openHistoryDir(id) {
  return ipcRenderer.invoke('history:open-dir', { id });
}

/**
 * 检测本机 CLI 工具可用性 by AI.Coding
 */
function detectCli() {
  return ipcRenderer.invoke('cli:detect');
}

/**
 * 强制重新检测本机 CLI 工具 by AI.Coding
 */
function redetectCli() {
  return ipcRenderer.invoke('cli:redetect');
}

/**
 * 获取应用基础信息 by AI.Coding
 */
function getAppInfo() {
  return ipcRenderer.invoke('app:info');
}

// 暴露安全的 IPC API 到渲染进程，确保每个 channel 对应单一函数入口。
contextBridge.exposeInMainWorld('electronAPI', {
  convert,
  selectPages,
  generate,
  cancelGenerate,
  onProgress,
  listProfiles,
  saveProfile,
  deleteProfile,
  setDefaultProfile,
  listHistory,
  deleteHistory,
  openHistoryDir,
  detectCli,
  redetectCli,
  getAppInfo,
});
