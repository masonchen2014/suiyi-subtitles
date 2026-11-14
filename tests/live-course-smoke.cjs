const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('./helpers/browser.cjs');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('https://learn.deeplearning.ai/courses/retrieval-augmented-generation/lesson/rrngb/a-conversation-with-andrew-ng', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.lesson-video-player video', { timeout: 15000 });
    // 无头测试没有用户登录态；只关闭可关闭的登录提示，不登录或访问受限内容。
    const loginTitle = page.getByText('Log In to Continue', { exact: true });
    await loginTitle.waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});
    if (await loginTitle.isVisible()) {
      await loginTitle.locator('..').getByRole('button', { name: 'Close modal', exact: true }).click();
    }
    await page.evaluate(() => {
      window.chrome = window.chrome || {};
      window.chrome.runtime = {
        onMessage: { addListener() {} },
        sendMessage: async message => {
          if (message.type === 'getSettings') return { enabled: true, mode: 'translate' };
          if (message.type === 'reportStatus') return { ok: true };
          await new Promise(resolve => setTimeout(resolve, 500));
          return { text: '欢迎学习检索增强生成。' };
        }
      };
      const attach = Element.prototype.attachShadow;
      Element.prototype.attachShadow = function(options) { return attach.call(this, { ...options, mode: 'open' }); };
      const video = document.querySelector('.lesson-video-player video');
      video.pause();
      video.currentTime = 1;
    });
    await page.addScriptTag({ content: fs.readFileSync('extension/adapters.js', 'utf8') });
    await page.addScriptTag({ content: fs.readFileSync('extension/content.js', 'utf8') });
    const target = page.locator('[data-light-subtitle] .target').filter({ hasText: '欢迎学习检索增强生成。' });
    await target.waitFor({ timeout: 15000 });
    const bounds = await target.boundingBox();
    const videoBounds = await page.locator('.lesson-video-player video').boundingBox();
    assert.ok(bounds.width > 0 && bounds.height > 0);
    assert.ok(bounds.y >= videoBounds.y && bounds.y + bounds.height <= videoBounds.y + videoBounds.height);
    assert.equal(await target.evaluate(el => {
      const rect = el.getBoundingClientRect();
      const host = el.getRootNode().host;
      const pointerEvents = host.style.pointerEvents;
      host.style.pointerEvents = 'auto';
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      host.style.pointerEvents = pointerEvents;
      return Boolean(top?.closest('[data-light-subtitle]'));
    }), true);
    await page.locator('[data-suiyi-status] button').filter({ hasText: '双语已开启' }).waitFor();
    fs.mkdirSync('tests/output', { recursive: true });
    await page.locator('.lesson-video-player').screenshot({ path: 'tests/output/suiyi-course.png' });
    console.log('PASS: real course page, timed subtitles, visible translated overlay inside video bounds and running status; model response mocked, no paid API call');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
