const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('./helpers/browser.cjs');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 380, height: 850 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://suiyi.test/**', route => {
      const file = new URL(route.request().url()).pathname.slice(1) || 'popup.html';
      if (!['popup.html', 'popup.js', 'models.js'].includes(file)) return route.abort();
      route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : 'text/html', body: fs.readFileSync('extension/' + file, 'utf8') });
    });
    await page.addInitScript(() => {
      window.stored = { enabled: true, mode: 'translate', apiKey: 'old-test-key', model: 'qwen-mt-turbo' };
      window.allowed = true;
      window.permissionsRequested = [];
      window.chrome = {
        storage: { local: {
          get: async keys => Object.fromEntries(keys.map(key => [key, window.stored[key]])),
          set: async values => Object.assign(window.stored, values),
          remove: async keys => keys.forEach(key => delete window.stored[key])
        } },
        permissions: { request: async request => { window.permissionsRequested.push(request); return window.allowed; } },
        runtime: { sendMessage: async message => ({ text: message.config.targetLanguage === 'Japanese' ? 'こんにちは' : '你好' }) }
      };
    });
    await page.goto('http://suiyi.test/popup.html');
    await page.waitForFunction(() => !document.querySelector('#save').disabled);
    assert.equal(await page.locator('h1').textContent(), '随译');
    assert.equal(await page.locator('#apiKey').inputValue(), 'old-test-key');
    assert.equal(await page.locator('#model').inputValue(), 'qwen-mt-turbo');
    await page.selectOption('#presetId', 'deepseek');
    assert.equal(await page.locator('#apiKey').inputValue(), '');
    await page.selectOption('#presetId', 'qwen-mt');
    assert.equal(await page.locator('#apiKey').inputValue(), 'old-test-key');
    await page.selectOption('#presetId', 'custom');
    await page.locator('#baseUrl').fill('https://my-model.example/v1');
    await page.locator('#model').fill('my-own-model');
    await page.locator('#apiKey').fill('custom-test-key');
    await page.selectOption('#targetLanguage', 'Japanese');
    await page.evaluate(() => { window.allowed = false; });
    await page.click('#save');
    await page.locator('#status').filter({ hasText: '未允许访问' }).waitFor();
    assert.equal(await page.evaluate(() => window.stored.providerConfig), undefined);
    await page.evaluate(() => { window.allowed = true; });
    await page.click('#save');
    await page.locator('#status').filter({ hasText: '已保存' }).waitFor();
    const saved = await page.evaluate(() => window.stored);
    assert.equal(saved.providerConfig.baseUrl, 'https://my-model.example/v1');
    assert.equal(saved.providerConfig.targetLanguage, 'Japanese');
    assert.equal(saved.apiKey, undefined);
    assert.equal(await page.evaluate(() => window.permissionsRequested.at(-1).origins[0]), 'https://my-model.example/*');
    await page.selectOption('#presetId', 'qwen-mt');
    await page.selectOption('#presetId', 'custom');
    assert.equal(await page.locator('#apiKey').inputValue(), 'custom-test-key');
    await page.click('#test');
    await page.locator('#status').filter({ hasText: '连接成功：こんにちは' }).waitFor();
    assert.equal(await page.evaluate(() => window.stored.enabled), true);
    assert.equal(await page.evaluate(() => window.stored.mode), 'translate');
    await page.locator('#status').filter({ hasText: '已保存并开启双语字幕' }).waitFor();
    await page.selectOption('#presetId', 'local');
    assert.equal(await page.locator('#noKey').isChecked(), true);
    assert.equal(await page.locator('#apiKey').isDisabled(), true);
    await page.locator('#model').fill('my-local-model');
    await page.click('#save');
    await page.locator('#status').filter({ hasText: '已保存' }).waitFor();
    assert.equal(await page.evaluate(() => window.stored.providerConfig.useApiKey), false);
    assert.deepEqual(errors, []);
    console.log('PASS: brand, legacy migration, separate credentials, permission denial, custom endpoint/model/language, per-provider profiles, connection test, local model');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
