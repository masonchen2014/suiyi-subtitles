(() => {
  let settings = { enabled: false, mode: 'translate' };
  let last = '', timer, lastUrl = location.href, loadedUrl = '', boundVideo, connectionError = '';
  const newSession = () => ({ queue: [], pending: new Set(), results: new Map(), active: 0 });
  let session = newSession();
  let settingsReady = false, watchedUrl = '', lastRecordedAt = 0, lastTranscriptSignature = '';
  function currentRecord() {
    const video = adapter.video(), metadata = adapter.metadata();
    const source = video ? adapter.transcript(video) : { cues: [], sentences: [], completeness: 'partial', language: 'und' };
    const translations = source.sentences.filter(cue => session.results.get(cue.text)?.text).map(cue => ({ ...cue, sourceText: cue.text, text: session.results.get(cue.text).text, targetLanguage: settings.targetLanguage || 'Chinese' }));
    return { video: { ...metadata, position: video?.currentTime || 0, duration: Number.isFinite(video?.duration) ? video.duration : 0 }, transcript: { language: source.language, completeness: source.completeness, cues: source.cues, translations } };
  }
  async function recordVideo(force = false) {
    if (!settingsReady || settings.historyEnabled === false || !adapter.supported()) return;
    const video = adapter.video();
    if (!video || (!force && video.paused) || (video.paused && watchedUrl !== location.href)) return;
    if (!video.paused) watchedUrl = location.href;
    if (!force && Date.now() - lastRecordedAt < 5000) return;
    lastRecordedAt = Date.now();
    const record = currentRecord(), transcript = record.transcript;
    if (!transcript.cues.length) {
      const frame = adapter.frame(video);
      if (frame.displayText) transcript.cues = [{ start: video.currentTime, end: video.currentTime + .2, text: frame.displayText }];
    }
    const signature = JSON.stringify([transcript.completeness, transcript.cues]);
    const snapshot = { ...record.video, transcript: { ...transcript, cues: signature === lastTranscriptSignature ? [] : transcript.cues } };
    try {
      const response = await chrome.runtime.sendMessage({ type: 'library', action: 'record', snapshot });
      if (!response.error && !response.result?.skipped) lastTranscriptSignature = signature;
    } catch { /* 本地资料库异常不影响视频字幕。 */ }
  }
  let positionedContainer, originalPosition;
  const adapter = LightSubtitleAdapters.create(document, location);
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:50%;top:82%;width:max-content;max-width:90%;transform:translate(-50%,-100%);z-index:60;pointer-events:none;text-align:center';
  const shadow = host.attachShadow({ mode: 'closed' });
  host.dataset.lightSubtitle = 'overlay';
  shadow.innerHTML = '<style>[hidden]{display:none!important}.box{display:inline-block;max-width:100%;padding:8px 16px;border-radius:8px;background:rgba(0,0,0,.82);color:white;font:clamp(17px,2.2vw,28px)/1.5 system-ui;text-shadow:0 1px 2px black;white-space:pre-wrap;overflow-wrap:anywhere;pointer-events:auto;cursor:grab;touch-action:none;user-select:none}.box.dragging{cursor:grabbing}.source{font-size:.72em;color:#ddd}.status{font-size:14px;color:#ddd}</style><div class="box" title="按住拖动字幕，双击恢复默认位置" hidden><div class="source"></div><div class="target"></div></div>';
  const box = shadow.querySelector('.box'), source = shadow.querySelector('.source'), target = shadow.querySelector('.target');
  let position = { x: .5, y: .82 }, drag = null;
  function place() {
    const parent = host.parentElement;
    if (!parent || box.hidden) return;
    const area = parent.getBoundingClientRect(), bounds = host.getBoundingClientRect();
    if (!area.width || !area.height) return;
    const marginX = 6 / area.width, marginY = 6 / area.height;
    const halfWidth = bounds.width / area.width / 2, height = bounds.height / area.height;
    const x = Math.max(halfWidth + marginX, Math.min(1 - halfWidth - marginX, position.x));
    const y = Math.max(height + marginY, Math.min(1 - marginY, position.y));
    host.style.left = (x * 100) + '%'; host.style.top = (y * 100) + '%';
  }
  function savePosition() {
    chrome.runtime.sendMessage({ type: 'saveSubtitlePosition', position }).catch(() => {});
  }
  box.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault(); event.stopPropagation();
    const area = host.parentElement.getBoundingClientRect(), bounds = host.getBoundingClientRect();
    drag = { id: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: (bounds.x + bounds.width / 2 - area.x) / area.width, y: (bounds.bottom - area.y) / area.height, moved: false };
    box.setPointerCapture(event.pointerId); box.classList.add('dragging');
  });
  box.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault(); event.stopPropagation();
    const area = host.parentElement.getBoundingClientRect();
    if (!area.width || !area.height) return;
    const dx = event.clientX - drag.clientX, dy = event.clientY - drag.clientY;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    if (!drag.moved) return;
    position = { x: Math.max(0, Math.min(1, drag.x + dx / area.width)), y: Math.max(0, Math.min(1, drag.y + dy / area.height)) };
    place();
  });
  function finishDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    event.stopPropagation();
    const moved = drag.moved;
    if (box.hasPointerCapture(event.pointerId)) box.releasePointerCapture(event.pointerId);
    drag = null; box.classList.remove('dragging');
    if (moved) savePosition();
  }
  box.addEventListener('pointerup', finishDrag);
  box.addEventListener('pointercancel', finishDrag);
  box.addEventListener('lostpointercapture', event => { if (drag?.id === event.pointerId) { drag = null; box.classList.remove('dragging'); } });
  box.addEventListener('click', event => event.stopPropagation());
  box.addEventListener('dblclick', event => {
    event.preventDefault(); event.stopPropagation(); position = { x: .5, y: .82 }; place(); savePosition();
  });
  const resizeObserver = new ResizeObserver(place);
  resizeObserver.observe(box);
  const indicator = document.createElement('div');
  indicator.dataset.suiyiStatus = '';
  indicator.style.cssText = 'position:absolute;top:12px;right:12px;z-index:100;pointer-events:auto';
  const statusRoot = indicator.attachShadow({ mode: 'closed' });
  statusRoot.innerHTML = '<style>button{border:1px solid #ffffff55;border-radius:16px;background:#15243be8;color:white;padding:5px 12px;font:12px/1.5 system-ui;cursor:pointer}</style><button type="button" title="打开随译设置">随译 · 正在连接</button>';
  const statusButton = statusRoot.querySelector('button');
  let reportedPhase = '';
  function report(phase) {
    if (phase === reportedPhase) return;
    reportedPhase = phase;
    chrome.runtime.sendMessage({ type: 'reportStatus', phase }).catch(() => {});
  }
  const panel = SuiyiPanel.create({
    getCurrent: currentRecord, getSettings: () => settings,
    setEnabled: async enabled => {
      const response = await chrome.runtime.sendMessage({ type: 'setEnabled', enabled });
      if (response.error) throw new Error(response.error);
      applySettings({ ...settings, enabled });
    },
    openSettings: () => chrome.runtime.sendMessage({ type: 'openSettings' }),
    openLibrary: () => chrome.runtime.sendMessage({ type: 'openLibrary' })
  });
  statusButton.addEventListener('click', () => panel.toggle(indicator));

  function clear() { last = ''; clearTimeout(timer); box.hidden = true; }
  function mount(player) {
    if (host.parentNode === player && indicator.parentNode === player) return;
    if (positionedContainer) positionedContainer.style.position = originalPosition;
    positionedContainer = null;
    if (getComputedStyle(player).position === 'static') {
      positionedContainer = player;
      originalPosition = player.style.position;
      player.style.position = 'relative';
    }
    player.append(host, indicator);
    resizeObserver.disconnect(); resizeObserver.observe(box); resizeObserver.observe(player);
    place();
  }
  function applySettings(value) {
    settingsReady = true;
    if (JSON.stringify(settings) === JSON.stringify(value)) return;
    const saved = value.subtitlePositions?.[location.hostname];
    if (!drag && saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) position = { ...saved };
    place();
    const { subtitlePositions: previousPositions, historyEnabled: previousHistory, ...previous } = settings;
    const { subtitlePositions: nextPositions, historyEnabled: nextHistory, ...next } = value;
    settings = value;
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    clear(); loadedUrl = ''; adapter.reset(); session = newSession();
  }
  function pump(context) {
    if (context !== session) return;
    while (context.active < 2 && context.queue.length) {
      const text = context.queue.shift(); context.active++;
      chrome.runtime.sendMessage({ type: 'translate', text }).then(result => {
        context.results.set(text, result || { error: '模型未返回结果' });
        if (context.results.size > 500) context.results.delete(context.results.keys().next().value);
        if (context === session && result?.text) recordVideo(true);
      }).catch(() => context.results.set(text, { error: '插件已更新，请刷新页面' })).finally(() => {
        context.pending.delete(text); context.active--; pump(context);
      });
    }
  }
  function schedule(text, priority = false) {
    if (!text || session.results.has(text)) return;
    if (session.pending.has(text)) {
      const index = session.queue.indexOf(text);
      if (priority && index > 0) { session.queue.splice(index, 1); session.queue.unshift(text); }
      return;
    }
    session.pending.add(text);
    if (priority) session.queue.unshift(text); else session.queue.push(text);
    pump(session);
  }
  function poll() {
    if (location.href !== lastUrl) { lastUrl = location.href; clear(); loadedUrl = ''; adapter.reset(); session = newSession(); watchedUrl = ''; lastTranscriptSignature = ''; lastRecordedAt = 0; panel.close(); }
    const video = adapter.video();
    if (video !== boundVideo) { boundVideo = video; clear(); }
    const player = adapter.container(video);
    if (!player || !adapter.supported()) { clear(); host.remove(); indicator.remove(); report('missing'); return; }
    mount(player);
    place();
    if (settingsReady && (settings.enabled || settings.historyEnabled !== false) && loadedUrl !== location.href) {
      loadedUrl = location.href;
      adapter.load(loadedUrl).then(() => recordVideo(true));
    }
    recordVideo();
    if (connectionError) { clear(); statusButton.textContent = '随译 · 请刷新页面'; return; }
    if (!settings.enabled) { clear(); statusButton.textContent = '随译 · 未开启，点此设置'; report('disabled'); return; }
    if (settings.configurationError) {
      box.hidden = false; source.textContent = ''; target.className = 'target status'; target.textContent = settings.configurationError;
      statusButton.textContent = '随译 · 请配置模型'; report('configuration'); return;
    }
    statusButton.textContent = settings.mode === 'direct' ? '随译 · 原字幕模式' : '随译 · 双语已开启';
    const frame = adapter.frame(video);
    const text = frame.text;
    if (!text) {
      if (last) clear();
      const messages = { loading: '正在读取视频字幕…', missing: '未找到可读取字幕，请尝试开启播放器 CC 或刷新页面', error: '字幕加载失败，请刷新页面重试' };
      const status = messages[adapter.state];
      report(adapter.state === 'error' ? 'error' : adapter.state === 'loading' ? 'loading' : 'reading');
      box.hidden = !status;
      if (status) { source.textContent = ''; target.className = 'target status'; target.textContent = status; }
      return;
    }
    box.hidden = false;
    const displayText = frame.displayText || text;
    source.textContent = settings.mode === 'direct' ? '' : displayText;
    if (settings.mode === 'direct') { last = text; target.className = 'target'; target.textContent = displayText; report('direct'); return; }
    if (frame.hasTimeline) {
      schedule(text, true);
      if (!video.paused) for (const next of frame.upcoming) schedule(next);
    } else if (text !== last) {
      clearTimeout(timer);
      timer = setTimeout(() => schedule(text, true), 450);
    }
    last = text;
    const result = session.results.get(text);
    target.className = result?.text ? 'target' : 'target status';
    target.textContent = result?.text ? SuiyiCaptions.displayTranslation(result.text, frame.window, video.currentTime) : result?.error || '翻译中…';
    if (result?.error) statusButton.textContent = '随译 · 翻译失败，点此设置';
    report(result?.error ? 'error' : result?.text ? 'translated' : 'translating');
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'settings') applySettings(message.settings);
  });
  // 配置由可信后台转发，页面脚本无需接触密钥。
  function refreshSettings() {
    chrome.runtime.sendMessage({ type: 'getSettings' }).then(value => {
      connectionError = ''; if (value) applySettings(value);
    }).catch(() => { connectionError = '插件连接失败'; });
  }
  refreshSettings();
  // Service Worker 重启后订阅列表会丢失，定期读取状态以恢复配置同步。
  setInterval(refreshSettings, 5000);
  document.addEventListener('pause', () => recordVideo(true), true);
  document.addEventListener('seeking', () => {
    clear();
    // 跳转后清除尚未发出的预翻译任务；已完成结果仍可回看复用。
    for (const text of session.queue) session.pending.delete(text);
    session.queue = [];
  }, true);
  setInterval(poll, 200);
})();
