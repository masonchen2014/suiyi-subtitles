// 字幕资料的公开数据格式与导出逻辑；可由扩展和本地 AI 工具共同复用。
globalThis.SuiyiLibraryCore = (() => {
  function canonicalUrl(value) {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('视频地址无效');
    url.username = ''; url.password = '';
    if (/^#(?:t=|start=|access_token=|id_token=|token=|code=)/i.test(url.hash)) url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(?:utm_.*|fbclid|gclid|si|t|start|access_?token|api_?key|auth|authorization|session(?:id)?|signature|code|token|key)$/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href;
  }
  function normalizeCues(cues) {
    const result = []; let characters = 0;
    for (const cue of Array.isArray(cues) ? cues : []) {
      if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start || typeof cue.text !== 'string') continue;
      const text = cue.text.trim().slice(0, 10000);
      if (!text) continue;
      characters += text.length;
      if (result.length >= 20000 || characters > 2000000) break;
      result.push({ start: cue.start, end: cue.end, text });
    }
    return result.sort((a, b) => a.start - b.start);
  }
  function mergeTranscript(previous, incoming) {
    const next = normalizeCues(incoming?.cues);
    let cues;
    const incomingFull = incoming?.completeness === 'full' && next.length > 0 && next.length === incoming?.cues?.length;
    const complete = previous?.completeness === 'full' || incomingFull;
    if (incomingFull) cues = next;
    else if (previous?.completeness === 'full') cues = previous.cues;
    else {
      const unique = new Map();
      for (const cue of [...(previous?.cues || []), ...next]) unique.set(JSON.stringify([cue.start, cue.end, cue.text]), cue);
      cues = normalizeCues([...unique.values()]);
    }
    const translations = new Map();
    for (const item of [...(previous?.translations || []), ...(incoming?.translations || [])]) {
      if (!Number.isFinite(item.start) || !Number.isFinite(item.end) || item.end <= item.start || typeof item.text !== 'string') continue;
      const translation = { start: item.start, end: item.end, text: item.text.slice(0, 10000), sourceText: String(item.sourceText || '').slice(0, 10000), targetLanguage: String(item.targetLanguage || '').slice(0, 40) };
      translations.set(JSON.stringify([translation.start, translation.end, translation.sourceText, translation.targetLanguage]), translation);
    }
    return { language: incoming?.language || previous?.language || 'und', completeness: complete && cues.length ? 'full' : 'partial', cues, translations: [...translations.values()].slice(-20000).sort((a, b) => a.start - b.start), updatedAt: Date.now() };
  }
  function timestamp(seconds, separator = '.') {
    const milliseconds = Math.max(0, Math.round(seconds * 1000));
    return `${String(Math.floor(milliseconds / 3600000)).padStart(2, '0')}:${String(Math.floor(milliseconds / 60000) % 60).padStart(2, '0')}:${String(Math.floor(milliseconds / 1000) % 60).padStart(2, '0')}${separator}${String(milliseconds % 1000).padStart(3, '0')}`;
  }
  function format(record, type = 'markdown') {
    if (!['json', 'text', 'markdown', 'srt', 'vtt'].includes(type)) throw new Error('不支持此导出格式');
    if (type === 'json') return JSON.stringify(record, null, 2);
    const cues = record.transcript?.cues || [];
    if (type === 'srt' || type === 'vtt') {
      const separator = type === 'srt' ? ',' : '.';
      return (type === 'vtt' ? 'WEBVTT\n\n' : '') + cues.map((cue, index) => `${type === 'srt' ? index + 1 + '\n' : ''}${timestamp(cue.start, separator)} --> ${timestamp(cue.end, separator)}\n${cue.text}`).join('\n\n') + '\n';
    }
    const title = record.video?.title || '视频字幕';
    const header = `${type === 'markdown' ? '# ' : ''}${title}\n${record.video?.url || ''}\n原文字幕：${record.transcript?.completeness === 'full' ? '完整（网站提供）' : '部分（仅已取得内容）'}\n`;
    return header + '\n' + cues.map(cue => `[${timestamp(cue.start).slice(0, 8)}] ${cue.text}`).join('\n') + (record.transcript?.translations?.length ? '\n\n已生成的译文（可能不完整）\n' + record.transcript.translations.map(cue => `[${timestamp(cue.start).slice(0, 8)}] ${cue.text}`).join('\n') : '');
  }
  function search(records, query, limit = 50) {
    limit = Math.min(100, Math.max(1, Number(limit) || 50));
    const needle = String(query || '').trim().toLocaleLowerCase();
    if (!needle) return [];
    const matches = [];
    for (const record of records) for (const cue of record.transcript?.cues || []) {
      if (cue.text.toLocaleLowerCase().includes(needle)) matches.push({ videoId: record.video.id, title: record.video.title, start: cue.start, end: cue.end, text: cue.text });
      if (matches.length >= limit) return matches;
    }
    return matches;
  }
  return { canonicalUrl, normalizeCues, mergeTranscript, timestamp, format, search };
})();
