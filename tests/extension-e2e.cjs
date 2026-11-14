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
    // 功能按钮应打开页内弹窗，而不是跳转离开视频。
    const pageDevtools = await context.newCDPSession(page);
    async function clickShadowButton(hostSelector, label) {
      const { root } = await pageDevtools.send('DOM.getDocument', { depth: -1, pierce: true });
      const all = [];
      function visit(node) { all.push(node); for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) visit(child); }
      visit(root);
      const host = all.find(node => (node.attributes || []).includes(hostSelector));
      if (!host) throw new Error('Missing shadow host: ' + hostSelector);
      const nodes = []; function collect(node) { nodes.push(node); for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) collect(child); } collect(host);
      const button = nodes.find(node => node.nodeName === 'BUTTON' && (!label || (node.children || []).some(child => child.nodeValue?.includes(label))));
      const { model } = await pageDevtools.send('DOM.getBoxModel', { nodeId: button.nodeId });
      const points = model.border;
      await page.mouse.click((points[0] + points[2]) / 2, (points[1] + points[5]) / 2);
    }
    await clickShadowButton('data-suiyi-status');
    await page.locator('[data-suiyi-panel]').waitFor();
    assert.equal(page.url(), courseUrl);
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
    await page.bringToFront();
    await page.evaluate(async () => {
      const video = document.querySelector('video'), canvas = document.createElement('canvas');
      canvas.width = 32; canvas.height = 32;
      const stream = canvas.captureStream(5), painter = canvas.getContext('2d');
      window.paintTimer = setInterval(() => { painter.fillStyle = 'blue'; painter.fillRect(0, 0, 32, 32); }, 100);
      video.srcObject = stream; video.muted = true; await video.play();
    });
    let videos;
    for (let attempt = 0; attempt < 50; attempt++) {
      const response = await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'library', action: 'list' }));
      videos = response.result?.videos;
      if (videos?.length) break;
      await page.waitForTimeout(200);
    }
    assert.equal(videos?.length, 1);
    assert.equal(videos[0].completeness, 'full');
    const record = await popup.evaluate(id => chrome.runtime.sendMessage({ type: 'library', action: 'get', id }), videos[0].id);
    assert.equal(record.result.transcript.cues.length, 3);
    const library = await context.newPage();
    await library.goto('chrome-extension://' + installed.id + '/library.html');
    await library.locator('.video').first().waitFor();
    await library.locator('.video').first().click();
    assert.match(await library.locator('#transcript').inputValue(), /Welcome to/);
    fs.mkdirSync('tests/output', { recursive: true });
    await library.screenshot({ path: 'tests/output/library-page.png', fullPage: true });
    const downloadEvent = library.waitForEvent('download');
    await library.click('#exportAll');
    assert.equal((await downloadEvent).suggestedFilename(), 'suiyi-library.json');
    // 本机外部调用默认拒绝；测试中显式开启后才可通过只读 JSON-RPC 读取。
    const apiPage = await context.newPage();
    await context.route('http://localhost/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Local API test</title>' }));
    await apiPage.goto('http://localhost/suiyi-test');
    const external = token => apiPage.evaluate(({ extensionId, token }) => new Promise(resolve => chrome.runtime.sendMessage(extensionId, { jsonrpc: '2.0', id: 1, method: 'videos.list', params: { token } }, resolve)), { extensionId: installed.id, token });
    assert.ok((await external('fake-read-key')).error);
    await library.bringToFront();
    await library.locator('summary').click();
    await library.check('#apiEnabled');
    let token = '';
    for (let attempt = 0; attempt < 20; attempt++) { token = await library.locator('#token').inputValue(); if (token) break; await library.waitForTimeout(100); }
    assert.equal(token.length, 64);
    assert.equal((await external(token)).result.total, 1);
    await library.uncheck('#apiEnabled');
    await library.waitForTimeout(100);
    assert.ok((await external(token)).error);
    console.log('PASS: real extension injection, translation, in-page menu, played-video capture, full transcript persistence, library UI/export and gated localhost API');
  } finally { await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
