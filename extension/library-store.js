// IndexedDB 保存视频资料；模型凭据仍独立保留在可信扩展存储中。
globalThis.SuiyiLibrary = (() => {
  let database, writes = Promise.resolve();
  function db() {
    if (!database) database = new Promise((resolve, reject) => {
      const request = indexedDB.open('suiyi-video-library', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('videos', { keyPath: 'id' });
        request.result.createObjectStore('transcripts', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => { database = null; reject(new Error('本地字幕资料库无法打开')); };
    });
    return database;
  }
  async function read(store, id) {
    const database = await db();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(store, 'readonly');
      const request = id === undefined ? transaction.objectStore(store).getAll() : transaction.objectStore(store).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('字幕资料读取失败'));
    });
  }
  async function videoId(url) {
    return 'video_' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url)))).map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function save(snapshot) {
    const job = writes.catch(() => {}).then(async () => {
      const url = SuiyiLibraryCore.canonicalUrl(snapshot.url), id = await videoId(url);
      const previous = await read('videos', id);
      const oldTranscript = await read('transcripts', id);
      const transcript = SuiyiLibraryCore.mergeTranscript(oldTranscript, snapshot.transcript);
      const video = { id, url, site: new URL(url).hostname, title: String(snapshot.title || previous?.title || '未命名视频').slice(0, 500), firstViewedAt: previous?.firstViewedAt || Date.now(), lastViewedAt: Date.now(), lastPosition: Number.isFinite(snapshot.position) ? Math.max(0, snapshot.position) : 0, duration: Number.isFinite(snapshot.duration) ? Math.max(0, snapshot.duration) : 0, completeness: transcript.completeness, cueCount: transcript.cues.length, translationCount: transcript.translations.length };
      const database = await db();
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(['videos', 'transcripts'], 'readwrite');
        transaction.objectStore('videos').put(video);
        transaction.objectStore('transcripts').put({ id, ...transcript });
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(new Error('字幕资料保存失败，请检查本机存储空间'));
        transaction.onabort = () => reject(new Error('字幕资料保存被中断'));
      });
      return { id, completeness: transcript.completeness, cueCount: transcript.cues.length };
    });
    writes = job;
    return job;
  }
  async function list({ query = '', offset = 0, limit = 50 } = {}) {
    await writes.catch(() => {});
    const videos = (await read('videos')).filter(video => `${video.title} ${video.url}`.toLocaleLowerCase().includes(String(query).toLocaleLowerCase())).sort((a, b) => b.lastViewedAt - a.lastViewedAt);
    return { total: videos.length, videos: videos.slice(Math.max(0, offset), Math.max(0, offset) + Math.min(100, Math.max(1, limit))) };
  }
  async function get(id) {
    await writes.catch(() => {});
    const video = await read('videos', id);
    if (!video) throw new Error('未找到这条观看记录');
    const { id: ignored, ...transcript } = await read('transcripts', id);
    return { video, transcript };
  }
  async function exportAll() {
    await writes.catch(() => {});
    const videos = (await read('videos')).sort((a, b) => b.lastViewedAt - a.lastViewedAt);
    const records = [];
    for (const video of videos) records.push(await get(video.id));
    return { schemaVersion: 1, exportedAt: new Date().toISOString(), videos: records };
  }
  async function remove(id) {
    await writes.catch(() => {});
    const database = await db();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(['videos', 'transcripts'], 'readwrite');
      for (const store of ['videos', 'transcripts']) id ? transaction.objectStore(store).delete(id) : transaction.objectStore(store).clear();
      transaction.oncomplete = () => resolve({ ok: true });
      transaction.onerror = () => reject(new Error('删除失败'));
    });
  }
  return { save, list, get, exportAll, remove };
})();
