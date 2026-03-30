// LLM 配置管理服务 by AI.Coding
const crypto = require('crypto');
const { safeStorage } = require('electron');

const STORE_KEY = 'profiles';

/**
 * LLM 配置管理服务，负责加密存储与默认配置切换 by AI.Coding
 */
class ProfileService {
  /**
   * 注入 electron-store 实例，统一管理配置数据 by AI.Coding
   */
  constructor(store) {
    this.store = store;
  }

  /**
   * 返回全部配置，并在读取时解密 apiKey by AI.Coding
   */
  list() {
    return this._getProfiles().map(profile => this._deserialize(profile));
  }

  /**
   * 保存配置；无 id 时新建，有 id 时更新 by AI.Coding
   */
  save(profile) {
    const nextProfile = profile || {};
    const profiles = this._getProfiles();
    const currentIndex = nextProfile.id
      ? profiles.findIndex(item => item.id === nextProfile.id)
      : -1;
    const current = currentIndex >= 0 ? profiles[currentIndex] : null;

    const merged = {
      id: nextProfile.id || (current && current.id) || crypto.randomUUID(),
      name: this._normalizeString(nextProfile.name, current && current.name),
      provider: this._normalizeString(nextProfile.provider, current && current.provider),
      baseUrl: this._normalizeOptionalString(nextProfile.baseUrl, current && current.baseUrl),
      model: this._normalizeString(nextProfile.model, current && current.model),
      isDefault: typeof nextProfile.isDefault === 'boolean'
        ? nextProfile.isDefault
        : Boolean(current && current.isDefault),
      createdAt: current && current.createdAt ? current.createdAt : Date.now(),
      apiKey: this._resolveApiKey(nextProfile, current),
    };

    this._validate(merged);

    const serialized = this._serialize(merged);
    let nextProfiles = currentIndex >= 0
      ? profiles.map(item => (item.id === serialized.id ? serialized : item))
      : [...profiles, serialized];

    // 保证默认配置全局唯一，避免设置页与生成页读取到冲突状态。
    if (serialized.isDefault) {
      nextProfiles = nextProfiles.map(item => ({
        ...item,
        isDefault: item.id === serialized.id,
      }));
    }

    this.store.set(STORE_KEY, nextProfiles);
    return this._deserialize(nextProfiles.find(item => item.id === serialized.id));
  }

  /**
   * 删除指定配置 by AI.Coding
   */
  delete(id) {
    const profiles = this._getProfiles().filter(profile => profile.id !== id);
    this.store.set(STORE_KEY, profiles);
  }

  /**
   * 设置默认配置，并清除其他默认标记 by AI.Coding
   */
  setDefault(id) {
    const profiles = this._getProfiles();
    const exists = profiles.some(profile => profile.id === id);

    if (!exists) {
      throw this._createError('NOT_FOUND', '未找到要设为默认的配置');
    }

    const nextProfiles = profiles.map(profile => ({
      ...profile,
      isDefault: profile.id === id,
    }));

    this.store.set(STORE_KEY, nextProfiles);
  }

  /**
   * 获取默认配置；不存在时返回 null by AI.Coding
   */
  getDefault() {
    const profile = this._getProfiles().find(item => item.isDefault);
    return profile ? this._deserialize(profile) : null;
  }

  /**
   * 加密 apiKey；若当前环境不支持则降级为明文 by AI.Coding
   */
  encryptKey(plain) {
    const value = this._normalizeOptionalString(plain, '');
    if (!value) {
      return '';
    }

    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[ProfileService] safeStorage 不可用，apiKey 将以明文存储');
      return value;
    }

    return safeStorage.encryptString(value).toString('base64');
  }

  /**
   * 解密 apiKey；若当前环境不支持则按明文返回 by AI.Coding
   */
  decryptKey(encrypted) {
    const value = this._normalizeOptionalString(encrypted, '');
    if (!value) {
      return '';
    }

    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[ProfileService] safeStorage 不可用，apiKey 将按明文读取');
      return value;
    }

    try {
      return safeStorage.decryptString(Buffer.from(value, 'base64'));
    } catch {
      // 兼容曾在降级模式下写入的明文数据，避免环境恢复后旧配置无法读取。
      return value;
    }
  }

  /**
   * 从 store 中读取原始配置数组 by AI.Coding
   */
  _getProfiles() {
    const profiles = this.store.get(STORE_KEY);
    return Array.isArray(profiles) ? profiles : [];
  }

  /**
   * 将运行时配置转换为持久化结构 by AI.Coding
   */
  _serialize(profile) {
    return {
      ...profile,
      apiKey: this.encryptKey(profile.apiKey),
    };
  }

  /**
   * 将持久化结构转换为渲染层可读结构 by AI.Coding
   */
  _deserialize(profile) {
    return {
      ...profile,
      apiKey: this.decryptKey(profile.apiKey),
    };
  }

  /**
   * 解析保存时的 apiKey，并兼容更新场景保留旧值 by AI.Coding
   */
  _resolveApiKey(profile, current) {
    if (Object.prototype.hasOwnProperty.call(profile, 'apiKey')) {
      return this._normalizeOptionalString(profile.apiKey, '');
    }

    if (!current || !current.apiKey) {
      return '';
    }

    return this.decryptKey(current.apiKey);
  }

  /**
   * 校验保存时的必填字段，缺失时返回明确错误 by AI.Coding
   */
  _validate(profile) {
    if (!profile.name) {
      throw this._createError('VALIDATION', '配置名称不能为空');
    }

    if (!profile.provider) {
      throw this._createError('VALIDATION', 'Provider 不能为空');
    }

    if (!profile.model) {
      throw this._createError('VALIDATION', '模型名称不能为空');
    }
  }

  /**
   * 规范化必填字符串，避免把空白字符串当成有效值 by AI.Coding
   */
  _normalizeString(value, fallback = '') {
    const finalValue = value == null ? fallback : value;
    return String(finalValue == null ? '' : finalValue).trim();
  }

  /**
   * 规范化可选字符串，空值统一转为空串 by AI.Coding
   */
  _normalizeOptionalString(value, fallback = '') {
    if (value == null) {
      return fallback == null ? '' : String(fallback).trim();
    }

    return String(value).trim();
  }

  /**
   * 构造带错误码的异常对象，便于 IPC 层直接透传 by AI.Coding
   */
  _createError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }
}

module.exports = { ProfileService };
