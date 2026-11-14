globalThis.SuiyiLibraryApi = (() => {
  const trustedPage = sender => ['library.html', 'popup.html'].some(page => sender.url === chrome.runtime.getURL(page) || sender.url?.startsWith(chrome.runtime.getURL(page) + '?'));
  async function handle(message, sender) {
    if (!trustedPage(sender) && !isSupported(sender)) throw new Error('不支持的调用来源');
    const { action } = message;
    if (action === 'record') {
      if (!isSupported(sender)) throw new Error('只允许视频页面记录播放');
      const { historyEnabled = true } = await chrome.storage.local.get('historyEnabled');
      if (!historyEnabled) return { skipped: true };
      const url = new URL(message.snapshot?.url), origin = new URL(sender.url || sender.tab.url);
      if (url.origin !== origin.origin) throw new Error('视频地址与页面不匹配');
      return SuiyiLibrary.save(message.snapshot);
    }
    if (action === 'list') return SuiyiLibrary.list(message.options);
    if (action === 'get') return SuiyiLibrary.get(message.id);
    if (action === 'export') return SuiyiLibrary.exportAll();
    if (action === 'settings') return chrome.storage.local.get({ historyEnabled: true });
    if (action === 'setHistory') {
      await chrome.storage.local.set({ historyEnabled: message.enabled === true });
      return { ok: true };
    }
    if (!trustedPage(sender)) throw new Error('请在字幕资料库中进行此操作');
    if (action === 'remove') return SuiyiLibrary.remove(message.id);
    if (action === 'apiSettings') return chrome.storage.local.get({ libraryApiConfig: { enabled: false, token: '' } });
    if (action === 'setApi') {
      const config = { enabled: message.enabled === true, token: message.enabled === true ? crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '') : '' };
      await chrome.storage.local.set({ libraryApiConfig: config });
      return { libraryApiConfig: config };
    }
    throw new Error('未知资料库操作');
  }
  async function external(request, sender) {
    const failure = (code, message) => ({ jsonrpc: '2.0', id: request?.id ?? null, error: { code, message } });
    try {
      const url = new URL(sender.url);
      if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1'].includes(url.hostname)) return failure(-32001, '只允许本机网页调用');
      const { libraryApiConfig } = await chrome.storage.local.get('libraryApiConfig');
      if (!libraryApiConfig?.enabled || !libraryApiConfig.token || request?.params?.token !== libraryApiConfig.token) return failure(-32001, '接口未开启或访问密钥无效');
      if (request.jsonrpc !== '2.0' || !['string', 'number'].includes(typeof request.id)) return failure(-32600, 'JSON-RPC 请求格式无效');
      let result;
      if (request.method === 'videos.list') result = await SuiyiLibrary.list(request.params);
      else if (request.method === 'videos.get') {
        const record = await SuiyiLibrary.get(request.params.videoId);
        result = request.params.format && request.params.format !== 'json' ? SuiyiLibraryCore.format(record, request.params.format) : record;
      } else if (request.method === 'subtitles.search') result = SuiyiLibraryCore.search((await SuiyiLibrary.exportAll()).videos, request.params.query, request.params.limit);
      else return failure(-32601, '只读接口不支持此方法');
      return { jsonrpc: '2.0', id: request.id, result };
    } catch (error) { return failure(-32000, error.message); }
  }
  return { handle, external, trustedPage };
})();
