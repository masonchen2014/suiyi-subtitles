(async () => {
  const status = document.getElementById('status');
  try {
    const tabs = await chrome.tabs.query({ url: ['https://learn.deeplearning.ai/*', 'https://www.youtube.com/watch*'] });
    const course = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    const current = await chrome.tabs.getCurrent();
    const allTabs = await chrome.tabs.query({});
    await chrome.storage.local.set({ lastUpdateResult: { candidateCount: tabs.length, totalTabs: allTabs.length, tabsWithReadableUrl: allTabs.filter(tab => !!tab.url).length, selectedTabId: course?.id || null, loadedVersion: chrome.runtime.getManifest().version, at: Date.now() } });
    if (chrome.runtime.getManifest().version === SuiyiModels.buildVersion) {
      status.textContent = '已加载随译 ' + SuiyiModels.buildVersion + '。正在刷新最近使用的课程页。';
      if (course) {
        await chrome.tabs.reload(course.id);
        await chrome.storage.local.set({ lastUpdateResult: { candidateCount: tabs.length, selectedTabId: course.id, loadedVersion: chrome.runtime.getManifest().version, courseReloaded: true, at: Date.now() } });
        await chrome.tabs.update(course.id, { active: true });
        if (current) await chrome.tabs.remove(current.id);
      }
      return;
    }
    if (course) await chrome.storage.local.set({ updateReturn: { courseTabId: course.id, updateTabId: current?.id, requestedAt: Date.now() } });
    status.textContent = '正在将随译更新到 ' + SuiyiModels.buildVersion + '…';
    chrome.runtime.reload();
  } catch {
    status.textContent = '自动更新未完成。请在 chrome://extensions 点击随译卡片上的重新加载图标，然后刷新课程页。';
  }
})();
