const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const context = { URL, AbortSignal };
vm.runInNewContext(fs.readFileSync('extension/models.js', 'utf8'), context);
const models = context.SuiyiModels;
const base = { protocol: 'openai', baseUrl: 'https://vendor.example/v1/', apiKey: 'secret', model: 'custom-model', targetLanguage: 'Chinese' };

test('custom vendors use a standard chat request, no Qwen-specific parameters', () => {
  const call = models.request(base, 'Hello');
  assert.equal(call.url, 'https://vendor.example/v1/chat/completions');
  assert.equal(call.headers.Authorization, 'Bearer secret');
  assert.equal(call.body.model, 'custom-model');
  assert.equal(call.body.messages[1].content, 'Hello');
  assert.equal(call.body.translation_options, undefined);
  assert.equal(models.request({ ...base, baseUrl: call.url }, 'Hello').url, call.url);
});
test('Claude and Gemini use their native authentication and response shapes', async () => {
  for (const [protocol, response, header, suffix] of [
    ['anthropic', { content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: '你好' }] }, 'x-api-key', '/messages'],
    ['gemini', { candidates: [{ content: { parts: [{ thought: true, text: 'private' }, { text: '你好' }] } }] }, 'x-goog-api-key', '/models/custom-model:generateContent']
  ]) {
    const config = { ...base, protocol };
    const translated = await models.translate(config, 'Hello', async (url, options) => {
      assert.ok(url.endsWith(suffix));
      assert.equal(options.headers[header], 'secret');
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.redirect, 'error');
      return { ok: true, json: async () => response };
    });
    assert.equal(translated, '你好');
  }
});
test('local compatible server can omit credentials and preserves its port', () => {
  const config = { ...base, baseUrl: 'http://localhost:11434/v1', apiKey: '', useApiKey: false };
  const call = models.request(config, 'Hello');
  assert.equal(call.url, 'http://localhost:11434/v1/chat/completions');
  assert.equal(call.headers.Authorization, undefined);
  assert.equal(models.permissionOrigin(config), 'http://localhost/*');
  assert.throws(() => models.normalize({ ...config, baseUrl: 'https://cloud.example/v1' }), /仅支持本机/);
});
test('old settings migrate without changing the original model or key', () => {
  const migrated = models.readConfig({ apiKey: 'old-key', model: 'qwen-mt-turbo' });
  assert.equal(migrated.protocol, 'qwen-mt');
  assert.equal(migrated.apiKey, 'old-key');
  assert.equal(models.request(migrated, 'Hello').body.translation_options.target_lang, 'Chinese');
});
test('invalid destinations and missing model credentials fail before networking', () => {
  for (const baseUrl of ['http://cloud.example/v1', 'https://name:password@cloud.example/v1', 'https://cloud.example/v1?key=secret', 'file:///tmp/key']) {
    assert.throws(() => models.normalize({ ...base, baseUrl }));
  }
  assert.throws(() => models.normalize({ ...base, apiKey: '' }), /API Key/);
  assert.throws(() => models.normalize({ ...base, model: '' }), /模型 ID/);
});
test('truncated output is never accepted as a successful subtitle', () => {
  assert.throws(() => models.parse(base, { choices: [{ finish_reason: 'length', message: { content: '半句' } }] }), /截断/);
  assert.throws(() => models.parse(base, { choices: [{ message: { reasoning_content: 'reasoning only' } }] }), /未返回译文/);
});
test('API failures produce actionable errors without echoing response secrets', async () => {
  await assert.rejects(models.translate(base, 'Hello', async () => ({ ok: false, status: 401, json: async () => ({ message: 'secret' }) })), /401.*API Key/);
});

test('RAG terminology reaches every protocol without changing the subtitle being translated', () => {
  const text = "There's lots more to learn about retrievers.";
  const context = { title: 'A conversation', path: '/courses/retrieval-augmented-generation/lesson/intro' };
  for (const protocol of ['openai', 'anthropic', 'gemini', 'qwen-mt']) {
    const { body } = models.request({ ...base, protocol }, text, context);
    if (protocol === 'qwen-mt') {
      assert.equal(body.messages.length, 1);
      assert.equal(body.messages[0].content, text);
      assert.match(body.translation_options.domains, /retrieval-augmented generation/);
      assert.equal(body.translation_options.terms.find(term => term.source === 'retrievers').target, '检索器');
    } else {
      const system = body.system || body.systemInstruction?.parts[0].text || body.messages[0].content;
      assert.match(system, /检索器/);
      assert.match(system, /Translate only the subtitle/);
    }
  }
});

test('terminology is domain and target-language scoped; cache separates domains and old translations', () => {
  const text = 'We love retrievers.';
  const dog = { title: 'Golden retrievers: dog training' };
  const rag = { title: 'RAG overview' };
  const config = { ...base, protocol: 'qwen-mt' };
  assert.equal(models.request(config, text, dog).body.translation_options.terms, undefined);
  assert.equal(models.request({ ...config, targetLanguage: 'Japanese' }, text, rag).body.translation_options.terms, undefined);
  assert.notEqual(models.cacheIdentity(base, text, dog), models.cacheIdentity(base, text, rag));
  assert.equal(JSON.parse(models.cacheIdentity(base, text, rag))[0], 3);
  assert.equal(models.request(config, text, { title: 'x'.repeat(10000) }).body.translation_options.domains.length < 1100, true);
});
