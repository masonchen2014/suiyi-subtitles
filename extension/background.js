importScripts('models.js');
const pending = new Map();
const subscribers = new Set();
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.storage.local.set({ activeBuildVersion: SuiyiModels.buildVersion, activeBuildStartedAt: Date.now() });
  const { updateReturn } = await chrome.storage.local.get('updateReturn');
  if (!updateReturn) return;
  await chrome.storage.local.remove('updateReturn');
  if (Date.now() - updateReturn.requestedAt > 60000) return;
  try {
    const tab = await chrome.tabs.get(updateReturn.courseTabId);
    if (!isSupported({ tab })) return;
    await chrome.tabs.reload(tab.id);
    await chrome.tabs.update(tab.id, { active: true });
    if (Number.isInteger(updateReturn.updateTabId)) await chrome.tabs.remove(updateReturn.updateTabId);
  } catch { /* 用户已经关闭了课页时不再操作其他标签。 */ }
});
function isSupported(sender) {
  try {
    const url = new URL(sender.url || sender.tab?.url);
    return url.protocol === 'https:' && chrome.runtime.getManifest().content_scripts.some(entry => entry.matches.some(pattern => {
      const expression = '^' + pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
      return new RegExp(expression).test(url.href);
    }));
  } catch { return false; }
}
async function publicSettings() {
  const settings = await chrome.storage.local.get({ enabled: false, mode: 'translate', subtitlePositions: {} });
  settings.configurationError = '';
  if (settings.enabled && settings.mode === 'translate') {
    try {
      const config = SuiyiModels.normalize(SuiyiModels.readConfig(await chrome.storage.local.get(['providerConfig', 'apiKey', 'model'])));
      if (!await chrome.permissions.contains({ origins: [SuiyiModels.permissionOrigin(config)] })) settings.configurationError = '请在随译设置中保存配置并允许访问模型服务';
    } catch (error) { settings.configurationError = error.message; }
  }
  return settings;
}
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !['enabled', 'mode', 'apiKey', 'model', 'providerConfig', 'subtitlePositions'].some(key => key in changes)) return;
  const settings = await publicSettings();
  for (const tabId of subscribers) {
    chrome.tabs.sendMessage(tabId, { type: 'settings', settings }).catch(() => subscribers.delete(tabId));
  }
});

async function translate(text) {
  const config = SuiyiModels.normalize(SuiyiModels.readConfig(await chrome.storage.local.get(['providerConfig', 'apiKey', 'model'])));
  if (!await chrome.permissions.contains({ origins: [SuiyiModels.permissionOrigin(config)] })) throw new Error('请在随译设置中保存配置，允许访问所选模型服务');
  const key = SuiyiModels.cacheIdentity(config, text);
  const cacheKey = 't:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)))).map(x => x.toString(16).padStart(2, '0')).join('');
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey]) return cached[cacheKey];
  if (pending.has(key)) return pending.get(key);
  const job = (async () => {
    const result = await SuiyiModels.translate(config, text);
    // 限制本地缓存条目，避免长期观看占满扩展存储。
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter(k => k.startsWith('t:'));
    if (keys.length >= 1500) await chrome.storage.local.remove(keys.slice(0, 300));
    await chrome.storage.local.set({ [cacheKey]: result });
    return result;
  })();
  pending.set(key, job);
  try { return await job; } finally { pending.delete(key); }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'saveSubtitlePosition' && isSupported(sender)) {
    const { x, y } = message.position || {};
    if (![x, y].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)) {
      sendResponse({ error: '字幕位置无效' }); return;
    }
    (async () => {
      const { subtitlePositions = {} } = await chrome.storage.local.get('subtitlePositions');
      const site = new URL(sender.url || sender.tab.url).hostname;
      await chrome.storage.local.set({ subtitlePositions: { ...subtitlePositions, [site]: { x, y } } });
      return { ok: true };
    })().then(sendResponse).catch(() => sendResponse({ error: '字幕位置保存失败' }));
    return true;
  }
  if (message.type === 'reportStatus' && isSupported(sender)) {
    const phases = ['disabled', 'configuration', 'loading', 'missing', 'reading', 'translating', 'translated', 'error', 'direct'];
    if (!phases.includes(message.phase)) return;
    chrome.storage.local.set({ lastRuntimeStatus: { tabId: sender.tab.id, version: chrome.runtime.getManifest().version, phase: message.phase, updatedAt: Date.now() } });
    sendResponse({ ok: true }); return;
  }
  if (message.type === 'openSettings' && isSupported(sender)) {
    const url = chrome.runtime.getURL('popup.html');
    chrome.tabs.query({ url }).then(async tabs => {
      if (tabs.length) return chrome.tabs.update(tabs[0].id, { active: true });
      return chrome.tabs.create({ url });
    }).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ error: '请点击浏览器右上角的随译图标打开设置' }));
    return true;
  }
  if (message.type === 'testConnection') {
    if (sender.url !== chrome.runtime.getURL('popup.html')) { sendResponse({ error: '不支持的页面' }); return; }
    (async () => {
      const config = SuiyiModels.normalize(message.config);
      if (!await chrome.permissions.contains({ origins: [SuiyiModels.permissionOrigin(config)] })) throw new Error('尚未允许访问此模型服务');
      return SuiyiModels.translate(config, 'Hello, welcome to the course.');
    })().then(text => sendResponse({ text })).catch(error => sendResponse({ error: error.message }));
    return true;
  }
  if (message.type === 'getSettings' && isSupported(sender)) {
    subscribers.add(sender.tab.id);
    publicSettings().then(sendResponse);
    return true;
  }
  if (message.type !== 'translate') return;
  if (!isSupported(sender)) {
    sendResponse({ error: '不支持的页面' }); return;
  }
  if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 4000) {
    sendResponse({ error: '字幕长度不符合要求' }); return;
  }
  translate(message.text).then(text => sendResponse({ text })).catch(error => sendResponse({ error: error.name === 'TimeoutError' ? '翻译超时，请稍后重试' : error.message }));
  return true;
});
