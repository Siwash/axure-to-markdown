// contextBridge 预加载脚本 by AI.Coding
const { contextBridge, ipcRenderer } = require('electron');

/**
 * 统一 IPC 结果解包：主进程的 registerIpcHandler 在异常时返回
 * { error, message } 对象而非抛异常，此处将其还原为 throw by AI.Coding
 */
function unwrapIpcResult(result) {
  if (result && typeof result === 'object' && result.error && result.message) {
    const err = new Error(result.message);
    err.code = result.error;
    throw err;
  }
  return result;
}

/**
 * 调用主进程解析 Axure 原型 by AI.Coding
 */
async function convert(source) {
  const result = await ipcRenderer.invoke('axure:convert', { source });
  return unwrapIpcResult(result);
}

/**
 * 调用主进程执行 AI 页面筛选 by AI.Coding
 */
async function selectPages(params) {
  const result = await ipcRenderer.invoke('axure:select-pages', params);
  return unwrapIpcResult(result);
}

/**
 * 调用主进程开始生成 PRD by AI.Coding
 */
async function generate(params) {
  const result = await ipcRenderer.invoke('axure:generate', params);
  return unwrapIpcResult(result);
}

/**
 * 调用主进程取消当前生成任务 by AI.Coding
 */
async function cancelGenerate(sessionId) {
  const result = await ipcRenderer.invoke('axure:cancel', { sessionId });
  return unwrapIpcResult(result);
}

/**
 * 打开指定解析会话的临时目录 by AI.Coding
 */
async function openParsedDir(sessionId) {
  const result = await ipcRenderer.invoke('axure:open-parsed-dir', { sessionId });
  return unwrapIpcResult(result);
}

/**
 * 订阅主进程推送的生成进度，并返回解绑函数 by AI.Coding
 */
function onProgress(callback) {
  const handler = (_event, data) => callback(data);
  ipcRenderer.on('axure:progress', handler);

  return () => ipcRenderer.removeListener('axure:progress', handler);
}

/**
 * 获取全部 LLM 配置 by AI.Coding
 */
async function listProfiles() {
  const result = await ipcRenderer.invoke('profile:list');
  return unwrapIpcResult(result);
}

/**
 * 新建或更新 LLM 配置 by AI.Coding
 */
async function saveProfile(profile) {
  const result = await ipcRenderer.invoke('profile:save', profile);
  return unwrapIpcResult(result);
}

/**
 * 删除指定 LLM 配置 by AI.Coding
 */
async function deleteProfile(id) {
  const result = await ipcRenderer.invoke('profile:delete', { id });
  return unwrapIpcResult(result);
}

/**
 * 设置默认 LLM 配置 by AI.Coding
 */
async function setDefaultProfile(id) {
  const result = await ipcRenderer.invoke('profile:set-default', { id });
  return unwrapIpcResult(result);
}

/**
 * 查询历史记录列表 by AI.Coding
 */
async function listHistory(search) {
  const result = await ipcRenderer.invoke('history:list', { search });
  return unwrapIpcResult(result);
}

/**
 * 删除指定历史记录 by AI.Coding
 */
async function deleteHistory(id) {
  const result = await ipcRenderer.invoke('history:delete', { id });
  return unwrapIpcResult(result);
}

/**
 * 打开指定历史记录的输出目录 by AI.Coding
 */
async function openHistoryDir(id) {
  const result = await ipcRenderer.invoke('history:open-dir', { id });
  return unwrapIpcResult(result);
}

/**
 * 获取用户配置的输出目录 by AI.Coding
 */
async function getOutputDir() {
  const result = await ipcRenderer.invoke('settings:get-output-dir');
  return unwrapIpcResult(result);
}

/**
 * 持久化输出目录配置 by AI.Coding
 */
async function setOutputDir(outputDir) {
  const result = await ipcRenderer.invoke('settings:set-output-dir', { outputDir });
  return unwrapIpcResult(result);
}

/**
 * 打开系统目录选择器并返回结果 by AI.Coding
 */
async function selectOutputDir() {
  const result = await ipcRenderer.invoke('settings:select-output-dir');
  return unwrapIpcResult(result);
}

/**
 * 检测本机 CLI 工具可用性 by AI.Coding
 */
async function detectCli() {
  const result = await ipcRenderer.invoke('cli:detect');
  return unwrapIpcResult(result);
}

/**
 * 强制重新检测本机 CLI 工具 by AI.Coding
 */
async function redetectCli() {
  const result = await ipcRenderer.invoke('cli:redetect');
  return unwrapIpcResult(result);
}

/**
 * 构建 CLI 模式的完整提示词，写入文件并返回 prompt 文本 by AI.Coding
 */
async function buildCliPrompt(params) {
  const result = await ipcRenderer.invoke('cli:build-prompt', params);
  return unwrapIpcResult(result);
}

/**
 * 打开系统终端并准备执行本地 CLI 命令 by AI.Coding
 */
async function openTerminal(params) {
  const result = await ipcRenderer.invoke('cli:open-terminal', params);
  return unwrapIpcResult(result);
}

/**
 * 获取应用基础信息 by AI.Coding
 */
async function getAppInfo() {
  const result = await ipcRenderer.invoke('app:info');
  return unwrapIpcResult(result);
}

contextBridge.exposeInMainWorld('electronAPI', {
  convert,
  selectPages,
  generate,
  cancelGenerate,
  openParsedDir,
  onProgress,
  listProfiles,
  saveProfile,
  deleteProfile,
  setDefaultProfile,
  listHistory,
  deleteHistory,
  openHistoryDir,
  getOutputDir,
  setOutputDir,
  selectOutputDir,
  detectCli,
  redetectCli,
  buildCliPrompt,
  openTerminal,
  getAppInfo,
});
