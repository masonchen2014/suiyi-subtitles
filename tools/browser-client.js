// 仅用于用户明确允许的本机网页；token 是资料库访问密钥，不是模型 API Key。
export class SuiyiClient {
  constructor({ extensionId, token }) { this.extensionId = extensionId; this.token = token; this.nextId = 1; }
  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!globalThis.chrome?.runtime?.sendMessage) return reject(new Error('请在 Chrome 的 localhost 网页中调用'));
      chrome.runtime.sendMessage(this.extensionId, { jsonrpc: '2.0', id: this.nextId++, method, params: { ...params, token: this.token } }, response => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (response?.error) return reject(new Error(response.error.message));
        resolve(response?.result);
      });
    });
  }
  listVideos(options = {}) { return this.request('videos.list', options); }
  getTranscript(videoId, format = 'json') { return this.request('videos.get', { videoId, format }); }
  searchSubtitles(query, limit = 50) { return this.request('subtitles.search', { query, limit }); }
}
