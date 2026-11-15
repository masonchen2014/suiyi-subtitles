const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');

function setup(options = {}) {
  const data = { apiKey: 'test-secret', model: 'qwen-mt-plus', enabled: true, mode: 'translate', ...options.stored };
  const calls = [];
  let listener, requests = 0;
  const context = {
    crypto: webcrypto, TextEncoder, AbortSignal, URL,
    chrome: {
      permissions: { contains: async () => options.allowed !== false },
      storage: {
        local: {
          setAccessLevel: async () => {},
          get: async defaults => defaults === null ? { ...data } : typeof defaults === 'string' ? { [defaults]: data[defaults] } : Array.isArray(defaults) ? Object.fromEntries(defaults.map(k => [k, data[k]])) : Object.fromEntries(Object.entries(defaults).map(([k,v]) => [k, data[k] ?? v])),
          set: async values => Object.assign(data, values),
          remove: async keys => keys.forEach(key => delete data[key])
        },
        onChanged: { addListener() {} }
      },
      runtime: { getManifest: () => JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8')), getURL: file => 'chrome-extension://test/' + file, onInstalled: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } } },
      tabs: { sendMessage: async () => {} }
    },
    fetch: async (url, options) => {
      requests++;
      calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ choices: [{ message: { content: '你好' } }] }) };
    }
  };
  vm.runInNewContext(fs.readFileSync('extension/models.js', 'utf8'), context);
  context.importScripts = () => {};
  vm.runInNewContext(fs.readFileSync('extension/background.js', 'utf8'), context);
  return {
    send: (message, url = 'https://www.youtube.com/watch?v=test') => new Promise(resolve => listener(message, { tab: { id: 1, url } }, resolve)),
    count: () => requests,
    data, calls
  };
}

test('translation uses Qwen API and repeated subtitles reuse cache', async () => {
  const app = setup();
  assert.equal((await app.send({ type: 'translate', text: 'Hello' })).text, '你好');
  assert.equal((await app.send({ type: 'translate', text: 'Hello' })).text, '你好');
  assert.equal(app.count(), 1);
  assert.equal(app.calls[0].url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
  assert.equal(app.calls[0].headers.Authorization, 'Bearer test-secret');
  assert.equal(app.calls[0].body.translation_options.target_lang, 'Chinese');
});
test('different endpoint and target language have independent caches', async () => {
  const app = setup();
  await app.send({ type: 'translate', text: 'Hello' });
  app.data.providerConfig = { protocol: 'openai', baseUrl: 'https://custom.example/v1', apiKey: 'other-key', model: 'qwen-mt-plus', targetLanguage: 'Chinese' };
  await app.send({ type: 'translate', text: 'Hello' });
  app.data.providerConfig.targetLanguage = 'Japanese';
  await app.send({ type: 'translate', text: 'Hello' });
  assert.equal(app.count(), 3);
  assert.equal(app.calls[1].headers.Authorization, 'Bearer other-key');
  assert.equal(app.calls[1].body.translation_options, undefined);
});

test('page context reaches translation and cache without sending URL query credentials', async () => {
  const app = setup();
  const text = 'Learn more about retrievers.';
  await app.send({ type: 'translate', text, context: { title: 'RAG overview' } }, 'https://www.youtube.com/watch?v=abc&token=private-value');
  const options = app.calls[0].body.translation_options;
  assert.equal(options.terms.find(term => term.source === 'retrievers').target, '检索器');
  assert.doesNotMatch(options.domains, /private-value/);
  await app.send({ type: 'translate', text, context: { title: 'Dog training' } });
  assert.equal(app.count(), 2);
  assert.equal(app.calls[1].body.translation_options.terms, undefined);
  await app.send({ type: 'translate', text, context: { title: 'Dog training' } });
  assert.equal(app.count(), 2);
});
test('unapproved model host is rejected without sending subtitles or credentials', async () => {
  const app = setup({ allowed: false });
  assert.match((await app.send({ type: 'translate', text: 'Hello' })).error, /允许访问/);
  assert.equal(app.count(), 0);
});
test('course pages cannot use the popup-only connection test', async () => {
  const app = setup();
  assert.ok((await app.send({ type: 'testConnection', config: {} })).error);
  assert.equal(app.count(), 0);
});
test('content scripts receive settings without API credentials', async () => {
  const app = setup();
  const settings = await app.send({ type: 'getSettings' });
  assert.equal(settings.enabled, true);
  assert.equal(settings.apiKey, undefined);
  assert.equal(settings.providerConfig, undefined);
});
test('missing configuration is reported in public settings without exposing secrets', async () => {
  const app = setup();
  app.data.apiKey = '';
  const settings = await app.send({ type: 'getSettings' });
  assert.match(settings.configurationError, /API Key/);
  assert.equal(settings.apiKey, undefined);
});
test('unauthorized page and invalid payload cannot trigger paid requests', async () => {
  const app = setup();
  assert.ok((await app.send({ type: 'translate', text: 'Hello' }, 'https://example.com/')).error);
  assert.ok((await app.send({ type: 'translate', text: 'x'.repeat(4001) })).error);
  assert.equal(app.count(), 0);
});
test('missing key produces an actionable error without network traffic', async () => {
  const app = setup();
  app.data.apiKey = '';
  assert.match((await app.send({ type: 'translate', text: 'Hello' })).error, /API Key/);
  assert.equal(app.count(), 0);
});
test('DeepLearning.AI is supported without trusting lookalike domains', async () => {
  const app = setup();
  assert.equal((await app.send({ type: 'getSettings' }, 'https://learn.deeplearning.ai/courses/test/lesson/one/intro')).enabled, true);
  assert.equal((await app.send({ type: 'translate', text: 'Hello' }, 'https://learn.deeplearning.ai/courses/test/lesson/one/intro')).text, '你好');
  assert.ok((await app.send({ type: 'translate', text: 'Hello' }, 'https://learn.deeplearning.ai.evil.example/')).error);
  assert.ok((await app.send({ type: 'translate', text: 'Hello' }, 'http://learn.deeplearning.ai/')).error);
});
test('subtitle position is saved per site and invalid coordinates are rejected', async () => {
  const app = setup();
  assert.equal((await app.send({ type: 'saveSubtitlePosition', position: { x: .4, y: .6 } })).ok, true);
  assert.equal((await app.send({ type: 'saveSubtitlePosition', position: { x: .5, y: .8 } }, 'https://learn.deeplearning.ai/courses/test')).ok, true);
  assert.equal(app.data.subtitlePositions['www.youtube.com'].x, .4);
  assert.equal(app.data.subtitlePositions['learn.deeplearning.ai'].y, .8);
  assert.ok((await app.send({ type: 'saveSubtitlePosition', position: { x: 5, y: .8 } })).error);
  assert.equal(app.data.subtitlePositions['www.youtube.com'].x, .4);
});
