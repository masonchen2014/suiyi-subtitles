const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const context = { URL };
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
