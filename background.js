/**
 * Background Service Worker for YT Playlist Manager.
 * Pure message router — no API calls, no OAuth.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: err.message }));
  return true;
});

async function handleMessage(message, sender) {
  const { action } = message;

  switch (action) {
    case 'requestWakeLock':
      chrome.power.requestKeepAwake('system');
      return { ok: true };
    case 'releaseWakeLock':
      chrome.power.releaseKeepAwake();
      return { ok: true };

    case 'scrapePlaylist':
    case 'bulkRemove':
    case 'getPlaylistInfo':
    case 'getStatus':
    case 'abort': {
      const tab = await getYouTubePlaylistTab();
      const response = await chrome.tabs.sendMessage(tab.id, message);
      if (response?.error) throw new Error(response.error);
      return response;
    }

    // Inject content script if needed, then forward
    case 'ensureContentScript': {
      const tab = await getYouTubePlaylistTab();
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/content.js'],
        });
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['content/content.css'],
        });
      } catch {
        // Already injected
      }
      // Check if it's a playlist page
      const info = await chrome.tabs.sendMessage(tab.id, {
        action: 'getPlaylistInfo',
      });
      return info;
    }

    // Relay progress updates from content script to popup
    case 'deleteProgress': {
      // Re-broadcast to popup (popup also listens for these)
      chrome.runtime.sendMessage(message).catch(() => {});
      return { ok: true };
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

/**
 * Get the active YouTube tab, or throw.
 */
async function getYouTubePlaylistTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab?.url?.includes('youtube.com/playlist')) {
    throw new Error('NOT_PLAYLIST_PAGE');
  }

  return tab;
}

console.log('[YT Playlist Manager] Service worker started');
