globalThis.SuiyiPanel = (() => {
  function create({ getCurrent, getSettings, setEnabled, openSettings, openLibrary }) {
    const host = document.createElement('div');
    host.dataset.suiyiPanel = '';
    host.style.cssText = 'position:fixed;z-index:2147483000;display:none;pointer-events:auto';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = '<style>*{box-sizing:border-box}section{width:min(370px,94vw);max-height:75vh;overflow:auto;border:1px solid #d7deeb;border-radius:14px;background:#fff;color:#223047;box-shadow:0 12px 40px #10223a40;padding:16px;font:13px/1.6 system-ui}header{display:flex;justify-content:space-between;align-items:center}h2{font-size:18px;margin:0}button,select{font:inherit;padding:7px 10px;border:1px solid #d4dce9;border-radius:7px;background:#f7f9fd;color:inherit;cursor:pointer}nav,.actions{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}p{margin:7px 0;overflow-wrap:anywhere}.muted{font-size:12px;color:#68768c}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:180px;overflow:auto;background:#f5f7fb;padding:10px;border-radius:8px;font:12px/1.7 system-ui}.item{display:block;width:100%;text-align:left;margin:6px 0}#feedback{color:#245eea}</style><section role="dialog" aria-label="随译功能"><header><h2>随译</h2><button id="close" aria-label="关闭随译弹窗">×</button></header><nav><button id="toggle">字幕开关</button><button id="current">当前视频</button><button id="history">观看记录</button></nav><div id="body"></div><p id="feedback" role="status"></p><div class="actions"><button id="settings">模型设置</button><button id="library">字幕资料库 / AI 接口</button></div><p class="muted">记录与字幕保存在本机；不完整的字幕会明确标记。</p></section>';
    const find = id => root.getElementById(id), body = find('body');
    let record, requestVersion = 0;
    const api = async action => {
      const response = await chrome.runtime.sendMessage({ type: 'library', ...action });
      if (response.error) throw new Error(response.error);
      return response.result;
    };
    function feedback(text) { find('feedback').textContent = text; }
    function download(format) {
      if (!record) return;
      const blob = new Blob([SuiyiLibraryCore.format(record, format)], { type: format === 'json' ? 'application/json' : 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = 'suiyi-transcript.' + (format === 'markdown' ? 'md' : format); link.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
    function showRecord(value) {
      record = value; body.replaceChildren();
      const title = document.createElement('p'); title.textContent = value.video.title;
      const info = document.createElement('p'); info.className = 'muted';
      info.textContent = `${value.transcript.completeness === 'full' ? '完整原文字幕' : '部分字幕'} · ${value.transcript.cues.length} 条 · 译文仅含已生成部分`;
      const pre = document.createElement('pre'); pre.textContent = SuiyiLibraryCore.format(value, 'text');
      const actions = document.createElement('div'); actions.className = 'actions';
      for (const [format, label] of [['markdown', '复制给 AI'], ['json', '导出 JSON'], ['srt', '导出 SRT']]) {
        const button = document.createElement('button'); button.textContent = label;
        button.onclick = async () => {
          try {
            if (format === 'markdown') { await navigator.clipboard.writeText(SuiyiLibraryCore.format(record, format)); feedback('已复制，可以粘贴给 AI 总结'); }
            else download(format);
          } catch { feedback('复制失败，请改用导出 JSON'); }
        };
        actions.append(button);
      }
      body.append(title, info, actions, pre);
    }
    async function current() { requestVersion++; feedback(''); showRecord(getCurrent()); }
    async function history() {
      const version = ++requestVersion; feedback('正在读取观看记录…');
      try {
        const result = await api({ action: 'list', options: { limit: 30 } });
        if (version !== requestVersion) return;
        body.replaceChildren(); feedback(result.total ? '' : '播放视频后会在这里留下记录');
        for (const video of result.videos) {
          const button = document.createElement('button'); button.className = 'item';
          button.textContent = video.title + ' · ' + (video.completeness === 'full' ? '完整字幕' : '部分字幕');
          button.onclick = async () => {
            const selection = ++requestVersion;
            try { const value = await api({ action: 'get', id: video.id }); if (selection === requestVersion) showRecord(value); }
            catch (error) { feedback(error.message); }
          };
          body.append(button);
        }
      } catch (error) { feedback(error.message); }
    }
    function close() { host.style.display = 'none'; requestVersion++; }
    find('close').onclick = close; find('current').onclick = current; find('history').onclick = history;
    find('settings').onclick = openSettings; find('library').onclick = openLibrary;
    find('toggle').onclick = async () => {
      try { await setEnabled(!getSettings().enabled); find('toggle').textContent = getSettings().enabled ? '关闭字幕' : '开启字幕'; }
      catch (error) { feedback(error.message); }
    };
    document.addEventListener('pointerdown', event => { if (host.style.display !== 'none' && !event.composedPath().includes(host) && !event.composedPath().some(node => node?.dataset?.suiyiStatus !== undefined)) close(); }, true);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    return {
      toggle(anchor) {
        if (host.style.display !== 'none') { close(); return; }
        (document.fullscreenElement || document.documentElement).append(host);
        const rect = anchor.getBoundingClientRect();
        host.style.left = Math.max(8, Math.min(innerWidth - 380, rect.right - 370)) + 'px';
        host.style.top = Math.max(8, Math.min(innerHeight - 260, rect.bottom + 8)) + 'px';
        host.style.display = 'block'; find('toggle').textContent = getSettings().enabled ? '关闭字幕' : '开启字幕'; current();
      }, close
    };
  }
  return { create };
})();
