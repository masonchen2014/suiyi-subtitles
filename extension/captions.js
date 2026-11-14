// 所有网站共用的字幕时间轴、句子边界和短字幕显示规则。
globalThis.SuiyiCaptions = (() => {
  function sentenceEnded(text) {
    return /[.!?。！？]["'”’\)\]]*\s*$/.test(text) &&
      !/(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc)|\be\.g|\bi\.e|\b[A-Z])\.$/i.test(text) && !/\b(?:[A-Z]\.){2,}$/.test(text);
  }
  function normalize(raw) {
    return raw.filter(cue => typeof cue.text === 'string' && Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.start >= 0 && cue.end > cue.start)
      .map(cue => ({ start: cue.start, end: cue.end, text: cue.text.replace(/\s+/g, ' ').trim() })).filter(cue => cue.text)
      .sort((a, b) => a.start - b.start);
  }
  function groupSentences(raw) {
    const result = [];
    let group;
    const flush = () => { if (group) result.push(group); group = undefined; };
    for (const cue of normalize(raw)) {
      // 字幕的一条 cue 可能包含上一句结尾与下一句开头，不能只检查 cue 的最后一个字符。
      const pieces = [];
      let offset = 0;
      for (const match of cue.text.matchAll(/[.!?。！？]["'”’\)\]]*(?:\s+|$)/g)) {
        const end = match.index + match[0].length;
        if (sentenceEnded(cue.text.slice(offset, end).trim())) { pieces.push([offset, end]); offset = end; }
      }
      if (offset < cue.text.length) pieces.push([offset, cue.text.length]);
      for (const [from, to] of pieces) {
        const part = { start: cue.start + (cue.end - cue.start) * from / cue.text.length, end: cue.start + (cue.end - cue.start) * to / cue.text.length, text: cue.text.slice(from, to).trim() };
        if (!part.text) continue;
        if (group && part.start - group.end > 5) flush();
        if (!group) group = { ...part }; else { group.text += ' ' + part.text; group.end = part.end; }
        const clause = (group.text.length >= 250 || group.end - group.start >= 15) && /[,;，；:]\s*$/.test(part.text);
        if (sentenceEnded(part.text) || clause || group.text.length >= 600 || group.end - group.start >= 30) flush();
      }
    }
    flush();
    return result;
  }
  function at(cues, time) { return cues.filter(cue => cue.start <= time && time < cue.end); }
  function textAt(cues, time) { return at(cues, time).map(cue => cue.text).join(' ').trim(); }
  function splitTranslation(text) {
    const cjk = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(text);
    const limit = cjk ? 38 : 90;
    const parts = [], tokens = new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text);
    let current = '';
    for (const { segment } of tokens) {
      if (current && current.length + segment.length > limit) { parts.push(current.trim()); current = ''; }
      current += segment;
      if (current.trim().length >= (cjk ? 14 : 35) && /[，。！？；,.!?;:：]$/.test(segment)) { parts.push(current.trim()); current = ''; }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  }
  function displayTranslation(text, window, time) {
    if (!window || !(window.end > window.start)) return text;
    const parts = splitTranslation(text);
    if (parts.length < 2) return text;
    const progress = Math.max(0, Math.min(.999999, (time - window.start) / (window.end - window.start)));
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    let used = 0;
    for (const part of parts) { used += part.length; if (used / total > progress) return part; }
    return parts.at(-1);
  }
  return { normalize, groupSentences, at, textAt, splitTranslation, displayTranslation };
})();
