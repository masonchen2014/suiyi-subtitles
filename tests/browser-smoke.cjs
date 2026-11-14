// 在隔离的无头浏览器中验证真实页面结构，不连接或更改用户 Chrome profile。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('./helpers/browser.cjs');
const fixture = JSON.parse(fs.readFileSync('tests/fixtures/deeplearning-lesson.json', 'utf8'));
const url = 'https://learn.deeplearning.ai/courses/retrieval-augmented-generation/lesson/rrngb/a-conversation-with-andrew-ng';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://learn.deeplearning.ai/**', route => {
      const data = structuredClone(fixture);
      if (route.request().url().includes('/qq2xz/')) {
        data.props.pageProps.lessonId = 'qq2xz';
        data.props.pageProps.trpcState.json.queries[0].state.data.captions = [{ startInSeconds: 0, endInSeconds: 10, text: 'Next lesson subtitle.' }];
      }
      route.fulfill({ contentType: 'text/html', body: '<!doctype html><style>.lesson-video-player{width:640px;height:360px}</style><div class="lesson-video-player"><div><video></video></div></div><script id="__NEXT_DATA__" type="application/json">' + JSON.stringify(data) + '</script>' });
    });
    await page.goto(url);
    await page.evaluate(() => {
      window.requests = [];
      window.settingsListener = null;
      window.chrome = { runtime: {
        onMessage: { addListener(fn) { window.settingsListener = message => { if (message.type === 'settings') window.liveSettings = message.settings; fn(message); }; } },
        sendMessage: async message => {
          if (message.type === 'getSettings') return window.liveSettings || { enabled: false, mode: 'direct' };
          if (message.type === 'openSettings') return { ok: true };
          if (message.type === 'reportStatus') return { ok: true };
          if (message.type === 'saveSubtitlePosition') {
            window.savedPosition = message.position;
            return { ok: true };
          }
          window.requests.push(message.text);
          if (window.translationDelay) await new Promise(resolve => setTimeout(resolve, window.translationDelay));
          return { text: '测试译文：' + message.text };
        }
      } };
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(options) { return attach.call(this, { ...options, mode: 'open' }); };
      document.querySelector('video').currentTime = 1;
    });
    await page.addScriptTag({ path: 'extension/adapters.js' });
    await page.addScriptTag({ path: 'extension/content.js' });
    await page.waitForTimeout(300);
    await page.locator('[data-light-subtitle] .box').waitFor({ state: 'hidden' });
    await page.locator('[data-suiyi-status] button').filter({ hasText: '未开启' }).waitFor();
    await page.evaluate(() => window.settingsListener({ type: 'settings', settings: { enabled: true, mode: 'direct' } }));
    const target = page.locator('[data-light-subtitle] .target');
    await target.filter({ hasText: 'Welcome to' }).waitFor();
    assert.equal(await page.evaluate(() => window.requests.length), 0);
    const subtitleBox = page.locator('[data-light-subtitle] .box');
    await page.evaluate(() => {
      window.playerClicks = 0;
      document.querySelector('.lesson-video-player').addEventListener('click', () => window.playerClicks++);
    });
    const beforeDrag = await subtitleBox.boundingBox();
    await page.mouse.move(beforeDrag.x + beforeDrag.width / 2, beforeDrag.y + beforeDrag.height / 2);
    await page.mouse.down();
    await page.mouse.move(beforeDrag.x + beforeDrag.width / 2 + 20, beforeDrag.y + beforeDrag.height / 2 - 100, { steps: 8 });
    await page.mouse.up();
    const afterDrag = await subtitleBox.boundingBox();
    assert.ok(afterDrag.y < beforeDrag.y - 70);
    assert.equal(await page.evaluate(() => window.playerClicks), 0);
    const savedPosition = await page.evaluate(() => window.savedPosition);
    assert.ok(savedPosition.y < .82);
    await page.evaluate(position => window.settingsListener({ type: 'settings', settings: { enabled: true, mode: 'direct', subtitlePositions: { 'learn.deeplearning.ai': position } } }), savedPosition);
    await page.locator('.lesson-video-player').evaluate(el => { el.style.width = '480px'; el.style.height = '270px'; });
    await page.waitForTimeout(150);
    const resized = await subtitleBox.boundingBox(), resizedPlayer = await page.locator('.lesson-video-player').boundingBox();
    assert.ok(resized.x >= resizedPlayer.x && resized.y >= resizedPlayer.y);
    assert.ok(resized.x + resized.width <= resizedPlayer.x + resizedPlayer.width + 1);
    await subtitleBox.dblclick();
    assert.equal(await page.evaluate(() => window.savedPosition.y), .82);
    await page.locator('.lesson-video-player').evaluate(el => { el.style.width = '640px'; el.style.height = '360px'; });
    await page.evaluate(() => { document.querySelector('video').currentTime = 3.5; });
    await page.locator('[data-light-subtitle] .box').waitFor({ state: 'hidden' });
    await page.evaluate(() => { document.querySelector('video').currentTime = 4; });
    await target.filter({ hasText: 'Retrieval Augmented Generation, or RAG' }).waitFor();
    await page.evaluate(() => window.settingsListener({ type: 'settings', settings: { enabled: true, mode: 'translate' } }));
    await target.filter({ hasText: '测试译文：' }).waitFor();
    // 模型有延迟时，下一条课节字幕提前翻译，切换后能立即显示而非反复丢弃结果。
    await page.evaluate(() => {
      window.translationDelay = 800;
      Object.defineProperty(document.querySelector('video'), 'paused', { configurable: true, get: () => false });
      document.querySelector('video').currentTime = 1;
      window.settingsListener({ type: 'settings', settings: { enabled: true, mode: 'translate', configurationError: '' } });
    });
    await target.filter({ hasText: '测试译文：Welcome to' }).waitFor();
    await page.evaluate(() => { document.querySelector('video').currentTime = 4; });
    await target.filter({ hasText: '测试译文：Retrieval Augmented Generation, or RAG' }).waitFor({ timeout: 700 });
    await page.evaluate(() => {
      window.settingsListener({ type: 'settings', settings: { enabled: true, mode: 'direct' } });
      history.pushState({}, '', '/courses/retrieval-augmented-generation/lesson/qq2xz/module-1-introduction');
      document.querySelector('video').currentTime = 1;
    });
    await target.filter({ hasText: 'Next lesson subtitle.' }).waitFor();
    await page.evaluate(() => window.settingsListener({ type: 'settings', settings: { enabled: false, mode: 'direct' } }));
    await page.locator('[data-light-subtitle] .box').waitFor({ state: 'hidden' });
    console.log('PASS: drag, saved position, resize bounds, double-click reset, no player click, disabled status, cue gaps, translation, slow-model lookahead, SPA switch');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
