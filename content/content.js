/**
 * Content script for YT Playlist Manager.
 * Runs on YouTube playlist pages.
 * ALL playlist logic lives here — scraping, filtering data, and DOM-based deletion.
 */

(function () {
  if (window.__ytPlaylistManagerLoaded) return;
  window.__ytPlaylistManagerLoaded = true;

  console.log('[YT Playlist Manager] Content script loaded');

  // ================ Global State ================
  let isDeleting = false;
  let abortRequested = false;
  let currentProgress = null;
  let lastScrapedItems = [];

  // ======================== Utilities ========================

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getVideoIdFromHref(href) {
    if (!href) return null;
    const match = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  }

  // ======================== Playlist Info ========================

  function getPlaylistInfo() {
    const url = window.location.href;
    const isWatchLater = url.includes('list=WL');
    const isLikedVideos = url.includes('list=LL');

    // Playlist title from page header
    const titleEl = document.querySelector(
      'yt-dynamic-text-view-model .yt-core-attributed-string, ' +
      '#header-description h1, ' +
      'ytd-playlist-header-renderer .metadata-wrapper yt-formatted-string, ' +
      'ytd-playlist-header-renderer #text'
    );

    let title = titleEl?.textContent?.trim() || '';
    if (!title && isWatchLater) title = 'Watch Later';
    if (!title && isLikedVideos) title = 'Liked Videos';
    if (!title) title = 'Playlist';

    // Video count from header stats
    const statsEl = document.querySelector(
      'ytd-playlist-header-renderer .metadata-stats .byline-item-text, ' +
      'ytd-playlist-header-renderer .metadata-text-wrapper yt-formatted-string'
    );
    const statsText = statsEl?.textContent?.trim() || '';
    const countMatch = statsText.match(/([\d,]+)\s*video/i);
    const videoCount = countMatch ? parseInt(countMatch[1].replace(/,/g, ''), 10) : null;

    return {
      title,
      isWatchLater,
      isLikedVideos,
      videoCount,
      url,
    };
  }

  // ======================== Scroll to Load All ========================

  async function scrollToLoadAll(onProgress) {
    let previousCount = 0;
    let stableRounds = 0;
    const maxStableRounds = 3;

    while (stableRounds < maxStableRounds) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleep(1500);

      const currentCount = document.querySelectorAll(
        'ytd-playlist-video-renderer'
      ).length;

      if (onProgress) onProgress({ loaded: currentCount });

      if (currentCount === previousCount) {
        stableRounds++;
      } else {
        stableRounds = 0;
      }
      previousCount = currentCount;
    }

    window.scrollTo(0, 0);
    return previousCount;
  }

  // ======================== Scrape Items ========================

  function scrapeAllItems() {
    const renderers = document.querySelectorAll('ytd-playlist-video-renderer');
    const items = [];

    renderers.forEach((renderer, index) => {
      // Video ID
      const link = renderer.querySelector('a#thumbnail, a#video-title');
      const videoId = getVideoIdFromHref(link?.getAttribute('href'));
      if (!videoId) return;

      // Title
      const titleEl = renderer.querySelector('#video-title');
      const title = titleEl?.textContent?.trim() || 'Unknown Title';

      // Channel
      const channelEl = renderer.querySelector(
        'ytd-channel-name #text a, ytd-channel-name #text'
      );
      const channelTitle = channelEl?.textContent?.trim() || '';

      // Thumbnail
      const thumbEl = renderer.querySelector('#thumbnail img, img.yt-core-image');
      const thumbnailUrl = thumbEl?.src || '';

      // Watch progress (red bar)
      const progressBar = renderer.querySelector(
        'ytd-thumbnail-overlay-resume-playback-renderer #progress'
      );
      let watchProgress = null;
      if (progressBar) {
        const style = progressBar.getAttribute('style') || '';
        const widthMatch = style.match(/width:\s*([\d.]+)%/);
        if (widthMatch) {
          watchProgress = parseFloat(widthMatch[1]);
        } else {
          // Fallback: compute from element width
          const parent = progressBar.parentElement;
          if (parent) {
            const parentW = parent.getBoundingClientRect().width;
            const barW = progressBar.getBoundingClientRect().width;
            if (parentW > 0) watchProgress = (barW / parentW) * 100;
          }
        }
      }

      // Duration
      const durationEl = renderer.querySelector(
        'ytd-thumbnail-overlay-time-status-renderer #text, ' +
        'ytd-thumbnail-overlay-time-status-renderer .badge-shape-wiz__text'
      );
      const durationText = durationEl?.textContent?.trim() || '';

      // Metadata block which usually contains "Channel Name • 1.2M views • 1 year ago"
      const videoInfoEl = renderer.querySelector('#video-info, .ytd-video-meta-block');
      const metaText = videoInfoEl?.textContent?.replace(/\s+/g, ' ')?.trim() || '';

      // Check if the video is unavailable
      const isUnavailable =
        title === '[Private video]' ||
        title === '[Deleted video]' ||
        renderer.querySelector('ytd-badge-supported-renderer [aria-label="Private"]') !== null;

      items.push({
        videoId,
        title,
        channelTitle,
        thumbnailUrl,
        watchProgress,
        durationText,
        metaText,
        isUnavailable,
        index,
      });
    });

    return items;
  }

  // ======================== Remove Video (DOM Automation) ========================

  async function removeVideo(videoId) {
    // Find the renderer for this video
    const renderers = document.querySelectorAll('ytd-playlist-video-renderer');
    let target = null;

    for (const r of renderers) {
      const link = r.querySelector('a#thumbnail, a#video-title');
      const vid = getVideoIdFromHref(link?.getAttribute('href'));
      if (vid === videoId) {
        target = r;
        break;
      }
    }

    if (!target) return false;

    // Scroll into view
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(400);

    // Click the 3-dot menu
    const menuBtn = target.querySelector(
      'button[aria-label="Action menu"], ' +
      '#button.ytd-menu-renderer, ' +
      'yt-icon-button#button'
    );
    if (!menuBtn) {
      console.warn('[YT-PM] No menu button found for', videoId);
      return false;
    }

    menuBtn.click();

    // Poll for the menu item to appear (max ~1000ms)
    let removeItem = null;
    for (let attempts = 0; attempts < 20; attempts++) {
      await sleep(50);
      const menuItems = document.querySelectorAll(
        'ytd-menu-service-item-renderer, ' +
        'tp-yt-paper-item.ytd-menu-service-item-renderer'
      );

      for (const item of menuItems) {
        const text = (item.textContent || '').toLowerCase();
        if (text.includes('remove from') || text.includes('supprimer de')) {
          removeItem = item;
          break;
        }
      }
      if (removeItem) break;
    }

    if (!removeItem) {
      // Close the menu
      document.body.click();
      await sleep(50);
      console.warn('[YT-PM] No "Remove from" option found for', videoId);
      return false;
    }

    removeItem.click();
    await sleep(200); // Shorter sleep, just enough for YT to register the click
    return true;
  }

  // ======================== Bulk Remove ========================

  async function bulkRemove(videoIds, onProgress) {
    isDeleting = true;
    abortRequested = false;
    chrome.runtime.sendMessage({ action: 'requestWakeLock' }).catch(() => {});
    
    try {
      let succeeded = 0;
      let failed = 0;
      const total = videoIds.length;

      for (let i = 0; i < total; i++) {
        if (abortRequested) break;
        const videoId = videoIds[i];

        const item = lastScrapedItems.find(x => x.videoId === videoId);
        const videoTitle = item ? item.title : `Video ${i + 1}`;

        const ok = await removeVideo(videoId);
        if (ok) {
          succeeded++;
        } else {
          failed++;
        }

        currentProgress = { completed: i + 1, total, succeeded, failed, videoId, videoTitle };

        if (onProgress) {
          onProgress(currentProgress);
        }

        // Short pause between removals to prevent YouTube from ignoring clicks
        if (i < total - 1 && !abortRequested) await sleep(250);
      }

      return { succeeded, failed, aborted: abortRequested };
    } finally {
      isDeleting = false;
      currentProgress = null;
      chrome.runtime.sendMessage({ action: 'releaseWakeLock' }).catch(() => {});
    }
  }

  // ======================== Message Handler ========================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  });

  async function handleMessage(message) {
    switch (message.action) {
      case 'getPlaylistInfo': {
        return getPlaylistInfo();
      }

      case 'scrapePlaylist': {
        // Scroll to load everything
        const totalLoaded = await scrollToLoadAll((progress) => {
          chrome.runtime.sendMessage({
            action: 'scanProgress',
            loaded: progress.loaded,
          }).catch(() => {});
        });

        // Scrape all items
        const items = scrapeAllItems();
        lastScrapedItems = items;

        return {
          items,
          totalLoaded,
          ...getPlaylistInfo(),
        };
      }

      case 'bulkRemove': {
        const { videoIds } = message;

        const result = await bulkRemove(videoIds, (progress) => {
          chrome.runtime.sendMessage({
            action: 'deleteProgress',
            ...progress,
          }).catch(() => {});
        });
        
        // Notify popup that we're done (useful if popup was closed and reopened)
        chrome.runtime.sendMessage({
          action: 'deleteComplete',
          result
        }).catch(() => {});

        return { result };
      }
      
      case 'getStatus': {
        return {
          isDeleting,
          progress: currentProgress
        };
      }

      case 'abort': {
        abortRequested = true;
        return { ok: true };
      }

      default:
        throw new Error(`Unknown action: ${message.action}`);
    }
  }
})();
