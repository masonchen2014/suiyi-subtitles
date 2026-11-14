const byId = id => document.getElementById(id);
const configFields = ['protocol', 'baseUrl', 'apiKey', 'model', 'targetLanguage'];
let profiles = {};
const loadedVersion = chrome.runtime.getManifest?.()?.version || SuiyiModels.buildVersion;
byId('version').textContent = '当前加载版本：' + loadedVersion;
byId('update').hidden = loadedVersion === SuiyiModels.buildVersion;
byId('update').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('update.html') }));
for (const [id, preset] of Object.entries(SuiyiModels.presets)) {
  const option = document.createElement('option'); option.value = id; option.textContent = preset.label;
  byId('presetId').append(option);
}
function updateHint() {
  byId('apiKey').disabled = byId('noKey').checked;
  try { byId('destination').textContent = '字幕直连：' + new URL(byId('baseUrl').value).origin; }
  catch { byId('destination').textContent = '请在接口设置中填写服务商地址'; }
}
function fill(config) {
  for (const field of configFields) byId(field).value = config[field] || '';
  byId('noKey').checked = config.useApiKey === false;
  updateHint();
}
function formConfig() {
  return { presetId: byId('presetId').value, ...Object.fromEntries(configFields.map(field => [field, byId(field).value.trim()])), useApiKey: !byId('noKey').checked };
}
function busy(value) { byId('save').disabled = value; byId('test').disabled = value; }
function status(text, error = false) { byId('status').textContent = text; byId('status').style.color = error ? '#b42318' : '#245eea'; }
async function init() {
  try {
    const stored = await chrome.storage.local.get(['enabled', 'mode', 'providerConfig', 'apiKey', 'model', 'modelProfiles']);
    profiles = stored.modelProfiles || {};
    const config = SuiyiModels.readConfig(stored);
    profiles[config.presetId || 'custom'] ||= config;
    byId('enabled').value = String(stored.enabled === true);
    byId('mode').value = stored.mode || 'translate';
    byId('presetId').value = config.presetId in SuiyiModels.presets ? config.presetId : 'custom';
    fill(config);
    busy(false);
  } catch { status('配置读取失败，请重新打开随译', true); }
}
byId('presetId').addEventListener('change', () => {
  const id = byId('presetId').value;
  // 不把上一厂商的密钥带到另一厂商；已保存的配置按服务商分别恢复。
  fill(profiles[id] || { ...SuiyiModels.presets[id], apiKey: '', targetLanguage: 'Chinese' });
  if (['custom', 'local'].includes(id)) byId('advanced').open = true;
  status('已切换配置，保存后生效');
});
byId('noKey').addEventListener('change', updateHint);
byId('baseUrl').addEventListener('input', updateHint);

async function act(testOnly) {
  busy(true);
  try {
    const enabled = byId('enabled').value === 'true';
    const mode = byId('mode').value;
    const needsModel = testOnly || (enabled && mode === 'translate');
    const config = needsModel ? SuiyiModels.normalize(formConfig()) : formConfig();
    if (needsModel) {
      // 用户点击时请求，仅授权当前所选服务商主机。
      const allowed = await chrome.permissions.request({ origins: [SuiyiModels.permissionOrigin(config)] });
      if (!allowed) throw new Error('未允许访问此模型服务，配置尚未应用');
    }
    if (testOnly) {
      status('正在测试模型连接…');
      const result = await chrome.runtime.sendMessage({ type: 'testConnection', config });
      if (!result?.text) throw new Error(result?.error || '模型连接失败');
      const nextProfiles = { ...profiles, [config.presetId]: config };
      await chrome.storage.local.set({ enabled: true, mode: 'translate', providerConfig: config, modelProfiles: nextProfiles });
      await chrome.storage.local.remove(['apiKey', 'model']);
      profiles = nextProfiles;
      byId('enabled').value = 'true'; byId('mode').value = 'translate';
      status('连接成功：' + result.text + '\n已保存并开启双语字幕，请返回课页播放。');
    } else {
      const nextProfiles = { ...profiles, [config.presetId]: config };
      await chrome.storage.local.set({ enabled, mode, providerConfig: config, modelProfiles: nextProfiles });
      await chrome.storage.local.remove(['apiKey', 'model']);
      profiles = nextProfiles;
      status('已保存。首次更新后，请刷新视频页面。');
    }
  } catch (error) { status(error.message || '操作失败，请重试', true); }
  finally { busy(false); }
}
byId('save').addEventListener('click', () => act(false));
byId('test').addEventListener('click', () => act(true));
byId('library').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'openLibrary' }));
init();
