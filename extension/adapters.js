// 网站适配只读取播放器和页面已提供的字幕，不读取页面账户数据。
globalThis.LightSubtitleAdapters = (() => {
  function nativeCaption(video) {
    for (const track of Array.from(video?.textTracks || [])) {
      if (!['subtitles', 'captions'].includes(track.kind)) continue;
      if (track.mode === 'showing' && track.activeCues?.length) {
        return Array.from(track.activeCues).map(cue => cue.text).join(' ').trim();
      }
    }
    return '';
  }

  function lessonIdentity(url) {
    const match = new URL(url).pathname.match(/^\/courses\/([^/]+)\/lesson\/([^/]+)(?:\/|$)/);
    return match ? { course: decodeURIComponent(match[1]), lesson: decodeURIComponent(match[2]) } : null;
  }

  function extractLesson(data, url) {
    const identity = lessonIdentity(url);
    const props = data?.props?.pageProps;
    if (!identity || props?.courseName !== identity.course || props?.lessonId !== identity.lesson) return [];
    const queries = props.trpcState?.json?.queries || props.trpcState?.queries || [];
    const query = queries.find(item => item.queryKey?.[0]?.includes('getLessonVideoSubtitle') &&
      String(item.queryKey?.[1]?.input?.videoId) === String(props.videoId));
    const captions = query?.state?.data?.captions;
    if (!Array.isArray(captions)) return [];
    return captions.filter(cue => typeof cue.text === 'string' && Number.isFinite(cue.startInSeconds) &&
      Number.isFinite(cue.endInSeconds) && cue.endInSeconds > cue.startInSeconds && cue.startInSeconds >= 0)
      .map(cue => ({ start: cue.startInSeconds, end: cue.endInSeconds, text: cue.text }))
      .sort((a, b) => a.start - b.start);
  }

  function captionAt(cues, time) {
    return cues.filter(cue => cue.start <= time && time < cue.end).map(cue => cue.text).join(' ').trim();
  }

  function sentenceEnded(text) {
    if (!/[.!?。！？]["'”’\)\]]*\s*$/.test(text)) return false;
    return !/(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc)|\be\.g|\bi\.e|\b[A-Z])\.$/i.test(text) && !/\b(?:[A-Z]\.){2,}$/.test(text);
  }
  function groupSentences(raw) {
    const result = [];
    let group;
    const flush = () => { if (group) result.push(group); group = undefined; };
    for (const cue of raw) {
      const text = cue.text.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      if (group && cue.start - group.end > 5) flush();
      if (!group) group = { start: cue.start, end: cue.end, text };
      else { group.text += ' ' + text; group.end = cue.end; }
      const length = group.text.length, duration = group.end - group.start;
      // 优先完整句子；很长的句子优先在逗号/分号处收束，避免无限累积。
      const clauseBoundary = (length >= 400 || duration >= 30) && /[,;，；:]\s*$/.test(text);
      if (sentenceEnded(text) || clauseBoundary || length >= 1000 || duration >= 60) flush();
    }
    flush();
    return result;
  }

  function create(document, location, fetchPage = fetch) {
    const isCourse = location.hostname === 'learn.deeplearning.ai';
    let cues = [], rawCues = [], controller, state = 'idle';
    function currentCues(video, grouped = true) {
      for (const track of Array.from(video?.textTracks || [])) {
        if (['subtitles', 'captions'].includes(track.kind) && track.mode === 'showing' && track.cues?.length) {
          const native = Array.from(track.cues).map(cue => ({ start: cue.startTime, end: cue.endTime, text: cue.text }));
          return grouped ? groupSentences(native) : native;
        }
      }
      return grouped ? cues : rawCues;
    }
    function fromDocument(doc, url) {
      try { return extractLesson(JSON.parse(doc.querySelector('#__NEXT_DATA__')?.textContent || 'null'), url); }
      catch { return []; }
    }
    return {
      isCourse,
      get state() { return state; },
      reset() { controller?.abort(); cues = []; rawCues = []; state = 'idle'; },
      async load(url) {
        controller?.abort();
        const current = controller = new AbortController();
        cues = []; rawCues = []; state = 'loading';
        let next = fromDocument(document, url);
        try {
          // Next.js 单页导航后初始 JSON 可能仍属于上一课，只接受当前课程与课节。
          if (!next.length) {
            const response = await fetchPage(url, { credentials: 'same-origin', signal: current.signal });
            if (!response.ok) throw new Error('课节字幕加载失败');
            const html = await response.text();
            if (current.signal.aborted) return;
            next = fromDocument(new DOMParser().parseFromString(html, 'text/html'), url);
          }
          if (current.signal.aborted) return;
          rawCues = next;
          cues = groupSentences(next);
          state = cues.length ? 'ready' : 'missing';
        } catch (error) {
          if (!current.signal.aborted) state = 'error';
        }
      },
      video() {
        return isCourse ? document.querySelector('.lesson-video-player video, media-player video, video') : document.querySelector('#movie_player video');
      },
      container(video) {
        if (!video) return null;
        const full = document.fullscreenElement;
        if (full && full !== video && full.contains(video)) return full;
        return isCourse ? video.closest('.lesson-video-player, media-player, [data-media-player]') || video.parentElement : document.querySelector('#movie_player');
      },
      caption(video) {
        if (isCourse) return captionAt(currentCues(video), video.currentTime) || nativeCaption(video);
        const native = nativeCaption(video);
        if (native) return native;
        return Array.from(document.querySelectorAll('.ytp-caption-window-container .ytp-caption-segment'))
          .map(el => el.textContent).join(' ').replace(/\s+/g, ' ').trim();
      },
      displayCaption(video) {
        return isCourse ? captionAt(currentCues(video, false), video.currentTime) || nativeCaption(video) : '';
      },
      upcoming(video) {
        if (!isCourse) return [];
        const time = video.currentTime;
        return currentCues(video).filter(cue => cue.end > time && cue.start <= time + 30).slice(0, 5).map(cue => cue.text);
      },
      supported() { return isCourse ? !!lessonIdentity(location.href) : location.pathname.startsWith('/watch'); }
    };
  }
  return { create, extractLesson, captionAt, nativeCaption, groupSentences };
})();
