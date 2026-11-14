// 适配器只负责不同网站的数据入口/容器；时间轴和字幕处理统一复用。
globalThis.LightSubtitleAdapters = (() => {
  const profiles = [];
  function register(profile) { profiles.push(profile); }
  function nativeCaption(video) {
    const track = Array.from(video?.textTracks || []).find(track => ['subtitles', 'captions'].includes(track.kind) && track.mode === 'showing' && track.activeCues?.length);
    return track ? Array.from(track.activeCues).map(cue => cue.text).join(' ').trim() : '';
  }
  function nativeCues(video) {
    const track = Array.from(video?.textTracks || []).find(track => ['subtitles', 'captions'].includes(track.kind) && track.mode === 'showing' && track.cues?.length);
    return track ? SuiyiCaptions.normalize(Array.from(track.cues).map(cue => ({ start: cue.startTime, end: cue.endTime, text: cue.text }))) : [];
  }
  function lessonIdentity(url) {
    const match = new URL(url).pathname.match(/^\/courses\/([^/]+)\/lesson\/([^/]+)(?:\/|$)/);
    return match ? { course: decodeURIComponent(match[1]), lesson: decodeURIComponent(match[2]) } : null;
  }
  function extractLesson(data, url) {
    const identity = lessonIdentity(url), props = data?.props?.pageProps;
    if (!identity || props?.courseName !== identity.course || props?.lessonId !== identity.lesson) return [];
    const queries = props.trpcState?.json?.queries || props.trpcState?.queries || [];
    const query = queries.find(item => item.queryKey?.[0]?.includes('getLessonVideoSubtitle') && String(item.queryKey?.[1]?.input?.videoId) === String(props.videoId));
    const captions = query?.state?.data?.captions;
    return Array.isArray(captions) ? SuiyiCaptions.normalize(captions.map(cue => ({ start: cue.startInSeconds, end: cue.endInSeconds, text: cue.text }))) : [];
  }
  register({
    id: 'deeplearning', matches: location => location.hostname === 'learn.deeplearning.ai',
    supports: location => !!lessonIdentity(location.href),
    container: video => video.closest('.lesson-video-player'),
    async load({ document, url, signal, fetchPage }) {
      const extract = doc => {
        try { return extractLesson(JSON.parse(doc.querySelector('#__NEXT_DATA__')?.textContent || 'null'), url); } catch { return []; }
      };
      const initial = extract(document);
      if (initial.length) return initial;
      const response = await fetchPage(url, { credentials: 'same-origin', signal });
      if (!response.ok) throw new Error('字幕加载失败');
      return extract(new DOMParser().parseFromString(await response.text(), 'text/html'));
    }
  });
  register({
    id: 'youtube', matches: location => location.hostname === 'www.youtube.com',
    supports: location => location.pathname.startsWith('/watch'),
    container: video => video.closest('#movie_player'),
    liveText: document => Array.from(document.querySelectorAll('.ytp-caption-window-container .ytp-caption-segment')).map(el => el.textContent).join(' ').replace(/\s+/g, ' ').trim()
  });

  function create(document, location, fetchPage = fetch) {
    const profile = profiles.find(profile => profile.matches(location)) || { id: 'native' };
    let raw = [], controller, state = 'idle', cacheKey = '', cached = [];
    function timeline(video) {
      const native = nativeCues(video);
      const cues = native.length ? native : raw;
      const key = JSON.stringify(cues);
      if (key !== cacheKey) { cacheKey = key; cached = SuiyiCaptions.groupSentences(cues); }
      return { raw: cues, sentences: cached };
    }
    const live = video => nativeCaption(video) || profile.liveText?.(document, video) || '';
    function frame(video) {
      const data = timeline(video), time = video.currentTime;
      const active = SuiyiCaptions.at(data.sentences, time);
      const window = active.length ? { start: active[0].start, end: active.at(-1).end, text: active.map(cue => cue.text).join(' ') } : null;
      return {
        window, hasTimeline: data.raw.length > 0,
        text: window?.text || live(video),
        displayText: SuiyiCaptions.textAt(data.raw, time) || live(video),
        upcoming: data.sentences.filter(cue => cue.end > time && cue.start <= time + 30).slice(0, 5).map(cue => cue.text)
      };
    }
    return {
      id: profile.id,
      get state() { return state; },
      reset() { controller?.abort(); raw = []; cacheKey = ''; cached = []; state = 'idle'; },
      async load(url) {
        controller?.abort(); const current = controller = new AbortController();
        raw = []; cacheKey = ''; state = 'loading';
        try {
          const next = profile.load ? await profile.load({ document, url, signal: current.signal, fetchPage }) : [];
          if (current.signal.aborted) return;
          raw = SuiyiCaptions.normalize(next); state = profile.load && !raw.length ? 'missing' : 'ready';
        } catch { if (!current.signal.aborted) state = 'error'; }
      },
      video() {
        // 标准 HTML5 视频优先；选择实际占画面最大的播放器，避免误选隐藏预览。
        const videos = Array.from(document.querySelectorAll('video'));
        return videos.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0] || null;
      },
      container(video) {
        if (!video) return null;
        const full = document.fullscreenElement;
        if (full && full !== video && full.contains(video)) return full;
        return profile.container?.(video) || video.closest('media-player, [data-media-player], .video-js, .plyr') || video.parentElement;
      },
      frame,
      window: video => frame(video).window,
      hasTimeline: video => frame(video).hasTimeline,
      caption: video => frame(video).text,
      displayCaption: video => frame(video).displayText,
      upcoming: video => frame(video).upcoming,
      supported() { return profile.supports ? profile.supports(location) : true; }
    };
  }
  return { create, register, extractLesson, nativeCaption, captionAt: SuiyiCaptions.textAt, groupSentences: SuiyiCaptions.groupSentences };
})();
