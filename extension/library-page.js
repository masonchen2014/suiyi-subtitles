const byId = id => document.getElementById(id);
let selected, offset = 0, total = 0, requestVersion = 0;
const api = async (action, values = {}) => {
  const response = await chrome.runtime.sendMessage({ type: 'library', action, ...values });
  if (response.error) throw new Error(response.error);
  return response.result;
};
const feedback = message => { byId('feedback').textContent = message; };
function saveFile(content, filename, mime = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type: mime })), link = document.createElement('a');
  link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
function render() {
  if (!selected) { byId('title').textContent = '选择一条观看记录'; byId('transcript').value = ''; byId('source').hidden = true; return; }
  byId('title').textContent = selected.video.title;
  byId('meta').textContent = `${selected.transcript.completeness === 'full' ? '完整原文（网站提供）' : '部分原文（仅已取得内容）'} · ${selected.transcript.cues.length} 条 · 最近观看 ${new Date(selected.video.lastViewedAt).toLocaleString()} · 译文 ${selected.transcript.translations.length} 条（可能不完整）`;
  byId('source').href = selected.video.url; byId('source').hidden = false;
  byId('transcript').value = SuiyiLibraryCore.format(selected, byId('format').value);
}
async function list(append = false) {
  const version = ++requestVersion;
  try {
    if (!append) { offset = 0; byId('videos').replaceChildren(); }
    const result = await api('list', { options: { query: byId('query').value, offset, limit: 50 } });
    if (version !== requestVersion) return;
    total = result.total; offset += result.videos.length;
    byId('count').textContent = `${total} 个视频`; byId('more').hidden = offset >= total;
    for (const video of result.videos) {
      const button = document.createElement('button'); button.className = 'video';
      const title = document.createElement('strong'); title.textContent = video.title;
      const info = document.createElement('small'); info.textContent = `${video.site} · ${video.completeness === 'full' ? '完整字幕' : '部分字幕'} · ${video.cueCount} 条`;
      button.append(title, info);
      button.onclick = async () => {
        try {
          selected = await api('get', { id: video.id }); render(); feedback('');
          for (const entry of byId('videos').children) entry.classList.remove('selected');
          button.classList.add('selected');
        } catch (error) { feedback(error.message); }
      };
      byId('videos').append(button);
    }
  } catch (error) { feedback(error.message); }
}
function showApi(value) {
  byId('apiEnabled').checked = value.libraryApiConfig.enabled;
  byId('token').value = value.libraryApiConfig.token;
}
byId('format').onchange = render;
let searchTimer;
byId('query').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => list(), 200); };
byId('more').onclick = () => list(true);
byId('historyEnabled').onchange = async () => {
  try { await api('setHistory', { enabled: byId('historyEnabled').checked }); feedback('观看记录设置已保存'); }
  catch (error) { feedback(error.message); }
};
byId('copy').onclick = async () => {
  try { if (!selected) throw new Error('请先选择视频'); await navigator.clipboard.writeText(byId('transcript').value); feedback('已复制'); }
  catch (error) { feedback(error.message); }
};
byId('download').onclick = () => {
  if (!selected) { feedback('请先选择视频'); return; }
  const format = byId('format').value;
  saveFile(byId('transcript').value, 'suiyi-transcript.' + (format === 'markdown' ? 'md' : format));
};
byId('exportAll').onclick = async () => {
  try { saveFile(JSON.stringify(await api('export'), null, 2), 'suiyi-library.json', 'application/json'); feedback('资料库 JSON 已导出，可交给 AI 或 MCP 工具读取'); }
  catch (error) { feedback(error.message); }
};
byId('remove').onclick = async () => {
  if (!selected || !confirm('删除这条视频的本地观看记录和字幕？')) return;
  try { await api('remove', { id: selected.video.id }); selected = null; render(); await list(); feedback('已删除'); }
  catch (error) { feedback(error.message); }
};
byId('apiEnabled').onchange = async () => {
  try { showApi(await api('setApi', { enabled: byId('apiEnabled').checked })); feedback('本机只读接口设置已保存'); }
  catch (error) { feedback(error.message); }
};
byId('rotateToken').onclick = async () => {
  if (!byId('apiEnabled').checked) { feedback('请先开启本机只读接口'); return; }
  try { showApi(await api('setApi', { enabled: true })); feedback('访问密钥已更换，旧密钥已失效'); }
  catch (error) { feedback(error.message); }
};
byId('copyToken').onclick = async () => {
  try { if (!byId('token').value) throw new Error('请先开启本机只读接口'); await navigator.clipboard.writeText(byId('token').value); feedback('已复制接口访问密钥，请勿公开分享'); }
  catch (error) { feedback(error.message); }
};
byId('extensionId').textContent = chrome.runtime.id;
byId('apiExample').textContent = `chrome.runtime.sendMessage("${chrome.runtime.id}", {\n  jsonrpc: "2.0", id: 1, method: "videos.list",\n  params: { token: "你的资料库访问密钥", limit: 20 }\n}, console.log);`;
(async () => {
  try { byId('historyEnabled').checked = (await api('settings')).historyEnabled; showApi(await api('apiSettings')); await list(); }
  catch (error) { feedback(error.message); }
})();
