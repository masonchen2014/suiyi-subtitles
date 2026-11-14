const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
function setup() {
  const stored = { libraryApiConfig: { enabled: false, token: 'test-read-token' } };
  const context = { URL, isSupported: sender => sender.url?.startsWith('https://video.example/'), chrome: { runtime: { getURL: path => 'chrome-extension://test/' + path }, storage: { local: { get: async key => ({ [key]: stored[key] }) } } }, SuiyiLibrary: { list: async () => ({ total: 1, videos: [{ id: 'v1', title: 'Demo' }] }) } };
  vm.runInNewContext(fs.readFileSync('extension/library-api.js', 'utf8'), context);
  return { api: context.SuiyiLibraryApi, stored };
}
test('external API is closed by default and rejects wrong keys and remote origins', async () => {
  const { api, stored } = setup();
  const request = { jsonrpc: '2.0', id: 1, method: 'videos.list', params: { token: 'test-read-token' } };
  assert.ok((await api.external(request, { url: 'http://localhost:3000/' })).error);
  stored.libraryApiConfig.enabled = true;
  assert.ok((await api.external(request, { url: 'https://attacker.example/' })).error);
  assert.ok((await api.external({ ...request, params: { token: 'wrong' } }, { url: 'http://localhost/' })).error);
  assert.equal((await api.external(request, { url: 'http://localhost:3000/' })).result.total, 1);
});
test('external API cannot delete records or access model configuration', async () => {
  const { api, stored } = setup(); stored.libraryApiConfig.enabled = true;
  for (const method of ['library.remove', 'getSettings', 'translate']) {
    assert.equal((await api.external({ jsonrpc: '2.0', id: 2, method, params: { token: 'test-read-token' } }, { url: 'http://127.0.0.1/' })).error.code, -32601);
  }
});
