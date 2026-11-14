const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const context = { URL, AbortController };
vm.runInNewContext(fs.readFileSync('extension/captions.js', 'utf8'), context);
vm.runInNewContext(fs.readFileSync('extension/adapters.js', 'utf8'), context);
const adapter = context.LightSubtitleAdapters;
const fixture = JSON.parse(fs.readFileSync('tests/fixtures/deeplearning-lesson.json', 'utf8'));
const url = 'https://learn.deeplearning.ai/courses/retrieval-augmented-generation/lesson/rrngb/a-conversation-with-andrew-ng';

test('reads real lesson hydration and respects gaps and cue end boundaries', () => {
  const cues = adapter.extractLesson(fixture, url);
  assert.equal(cues.length, 3);
  assert.match(adapter.captionAt(cues, 1), /^Welcome to/);
  assert.equal(adapter.captionAt(cues, 3), '');
  assert.match(adapter.captionAt(cues, 4), /^Retrieval Augmented/);
  assert.equal(adapter.captionAt(cues, 15), '');
});
test('previous lesson metadata is rejected after SPA navigation', () => {
  assert.equal(adapter.extractLesson(fixture, url.replace('/rrngb/', '/another/')).length, 0);
  assert.equal(adapter.extractLesson(fixture, url.replace('/retrieval-augmented-generation/', '/another-course/')).length, 0);
});
test('metadata and chapters are never mistaken for dialogue subtitles', () => {
  const video = { textTracks: [
    { kind: 'metadata', mode: 'showing', activeCues: [{ text: 'not dialogue' }] },
    { kind: 'subtitles', mode: 'hidden', activeCues: [{ text: 'hidden subtitle' }] },
    { kind: 'captions', mode: 'showing', activeCues: [{ text: '字幕' }] }
  ] };
  assert.equal(adapter.nativeCaption(video), '字幕');
});
test('translation reads through a split power-of phrase to the end of the sentence', () => {
  const grouped = adapter.groupSentences([
    { start: 0, end: 4, text: 'This gives us a simple way to focus the power of' },
    { start: 4, end: 8, text: 'language models on our own documents.' },
    { start: 8, end: 10, text: 'Now we can start.' }
  ]);
  assert.equal(grouped.length, 2);
  assert.equal(adapter.captionAt(grouped, 1), 'This gives us a simple way to focus the power of language models on our own documents.');
  assert.equal(adapter.captionAt(grouped, 6), adapter.captionAt(grouped, 1));
  assert.equal(adapter.captionAt(grouped, 8), 'Now we can start.');
});
test('abbreviations do not prematurely terminate a subtitle sentence', () => {
  const grouped = adapter.groupSentences([{ start: 0, end: 2, text: 'We met Dr.' }, { start: 2, end: 5, text: 'Lee at the lab.' }]);
  assert.equal(grouped.length, 1);
});
test('sentence boundaries inside a cue do not accumulate a whole paragraph', () => {
  const cues = adapter.groupSentences([
    { start: 0, end: 5, text: 'First short sentence. A second sentence begins' },
    { start: 5, end: 10, text: 'here. A third sentence is complete.' }
  ]);
  assert.equal(cues.length, 3);
  assert.equal(cues[0].text, 'First short sentence.');
  assert.equal(cues[1].text, 'A second sentence begins here.');
  assert.ok(cues[1].start > 0 && cues[1].end < 10);
});
test('translation context is split into short timed display units instead of a paragraph', () => {
  const text = '大型企业利用系统回答产品问题，并帮助员工查询内部政策。研究人员也在探索新的应用，例如教育和医疗。';
  const core = context.SuiyiCaptions;
  const chunks = core.splitTranslation(text);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every(chunk => chunk.length <= 38));
  assert.equal(core.displayTranslation(text, { start: 0, end: 12 }, 0), chunks[0]);
  assert.equal(core.displayTranslation(text, { start: 0, end: 12 }, 11.99), chunks.at(-1));
  assert.notEqual(core.displayTranslation(text, { start: 0, end: 12 }, 0), text);
});
test('a standard video on a new site reuses sentence grouping and lookahead without an adapter', async () => {
  const raw = [{ startTime: 0, endTime: 3, text: 'We can focus the power of' }, { startTime: 3, endTime: 6, text: 'models on this task.' }];
  const video = { currentTime: 1, clientWidth: 640, clientHeight: 360, closest: () => null, parentElement: {}, textTracks: [{ kind: 'subtitles', mode: 'showing', cues: raw, activeCues: [raw[0]] }] };
  const doc = { querySelectorAll: selector => selector === 'video' ? [video] : [], fullscreenElement: null };
  const site = adapter.create(doc, new URL('https://another-video.example/watch'), () => { throw new Error('native video should not fetch a page'); });
  await site.load('https://another-video.example/watch');
  assert.equal(site.id, 'native');
  assert.equal(site.hasTimeline(video), true);
  assert.equal(site.caption(video), 'We can focus the power of models on this task.');
  assert.equal(site.displayCaption(video), 'We can focus the power of');
  assert.equal(site.upcoming(video)[0], site.caption(video));
});
