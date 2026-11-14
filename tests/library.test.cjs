const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const context = { URL };
vm.runInNewContext(fs.readFileSync('extension/library-core.js', 'utf8'), context);
const core = context.SuiyiLibraryCore;
const cues = [{ start: 0, end: 3, text: 'A searchable subtitle.' }, { start: 3, end: 8, text: 'Second sentence.' }];
test('canonical video URL removes tracking and credential parameters but preserves identity', () => {
  const url = core.canonicalUrl('https://www.youtube.com/watch?v=video123&t=42&utm_source=mail&token=private#t=42');
  assert.equal(url, 'https://www.youtube.com/watch?v=video123');
});
test('generic video identity preserves hash routes and non-secret video identifiers', () => {
  assert.equal(core.canonicalUrl('https://video.example/app?videoCode=123#/watch/456'), 'https://video.example/app?videoCode=123#/watch/456');
});
test('partial observations never overwrite a complete website transcript', () => {
  const full = core.mergeTranscript(null, { cues, completeness: 'full', language: 'en' });
  const merged = core.mergeTranscript(full, { cues: [{ start: 50, end: 51, text: 'live' }], completeness: 'partial' });
  assert.equal(merged.completeness, 'full'); assert.equal(merged.cues.length, 2);
});
test('partial transcript accumulates without duplicates and translations remain separate', () => {
  const first = core.mergeTranscript(null, { cues: [cues[0]], completeness: 'partial' });
  const merged = core.mergeTranscript(first, { cues, translations: [{ start: 0, end: 3, text: '一条可搜索的字幕。', sourceText: cues[0].text, targetLanguage: 'Chinese' }] });
  assert.equal(merged.cues.length, 2); assert.equal(merged.translations.length, 1); assert.equal(merged.completeness, 'partial');
});
test('exports contain transcript data and explicit completeness', () => {
  const record = { video: { id: 'v1', title: 'Demo', url: 'https://video.example/watch' }, transcript: core.mergeTranscript(null, { cues, completeness: 'partial' }) };
  assert.match(core.format(record, 'srt'), /00:00:00,000 --> 00:00:03,000/);
  assert.match(core.format(record, 'vtt'), /^WEBVTT/);
  assert.match(core.format(record), /部分/);
  assert.equal(core.search([record], 'searchable')[0].videoId, 'v1');
  assert.throws(() => core.format(record, 'execute'), /不支持/);
});
test('invalid cues cannot be advertised as complete', () => {
  const data = core.mergeTranscript(null, { completeness: 'full', cues: [{ start: -1, end: 2, text: 'invalid' }] });
  assert.equal(data.completeness, 'partial'); assert.equal(data.cues.length, 0);
});
