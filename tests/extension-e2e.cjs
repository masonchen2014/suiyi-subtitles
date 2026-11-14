// 使用临时无头 Chrome、私有调试管道加载真正的扩展，不接触用户 profile。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('./helpers/browser.cjs');
const fixture = JSON.parse(fs.readFileSync('tests/fixtures/deeplearning-lesson.json', 'utf8'));
const courseUrl = 'https://learn.deeplearning.ai/courses/retrieval-augmented-generation/lesson/rrngb/a-conversation-with-andrew-ng';
(async () => {
  const context = await chromium.launchPersistentContext('', { channel: 'chrome', headless: true, args: ['--enable-unsafe-extension-debugging'], ignoreDefaultArgs: ['--disable-extensions'] });
  const browser = context.browser();
  try {
    const devtools = await browser.newBrowserCDPSession();
    const installed = await devtools.send('Extensions.loadUnpacked', { path: path.resolve('extension') });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') console.log('BROWSER_ERROR', message.text()); });
    await context.route('https://learn.deeplearning.ai/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>.lesson-video-player{width:800px;height:450px;background:#223}</style><div class="lesson-video-player"><div><video></video></div></div><script id="__NEXT_DATA__" type="application/json">' + JSON.stringify(fixture) + '</script>' }));
    await page.goto(courseUrl);
    await page.locator('[data-suiyi-status]').waitFor({ timeout: 10000 });
    const popup = await context.newPage();
    await popup.goto('chrome-extension://' + installed.id + '/popup.html');
    await popup.evaluate(async () => {
      await chrome.storage.local.set({ enabled: true, mode: 'direct' });
    });
    await page.evaluate(() => { document.querySelector('video').currentTime = 1; });
    await page.waitForFunction(() => {
      const host = document.querySelector('[data-light-subtitle]');
      return host && host.getBoundingClientRect().height > 0;
    });
    assert.deepEqual(errors, []);
    let modelRequests = 0;
    await context.route('https://dashscope.aliyuncs.com/**', route => {
      modelRequests++;
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: '欢迎使用随译。' } }] }) });
    });
    await popup.evaluate(async () => {
      await chrome.storage.local.set({ enabled: true, mode: 'translate', providerConfig: { protocol: 'qwen-mt', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: 'fake-e2e-key', model: 'qwen-mt-plus', targetLanguage: 'Chinese' } });
    });
    let phase;
    for (let attempt = 0; attempt < 50; attempt++) {
      phase = await popup.evaluate(async () => (await chrome.storage.local.get('lastRuntimeStatus')).lastRuntimeStatus?.phase);
      if (phase === 'translated') break;
      await page.waitForTimeout(200);
    }
    assert.equal(phase, 'translated');
    assert.ok(modelRequests > 0);
    console.log('PASS: manifest install, real content-script injection, background messages and storage changes, timed subtitle overlay');
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
