/**
 * Popup logic for YT Playlist Manager.
 * Zero-auth, pure DOM scraping edition.
 */

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ================ DOM References ================
  const screens = {
    noPlaylist: $('#screen-no-playlist'),
    main: $('#screen-main'),
    scanning: $('#screen-scanning'),
    results: $('#screen-results'),
    deleting: $('#screen-deleting'),
    done: $('#screen-done'),
  };

  const els = {
    playlistTitle: $('#playlist-title'),
    playlistMeta: $('#playlist-meta'),
    filterAll: $('#filter-all'),
    filterWatched: $('#filter-watched'),
    filterPartial: $('#filter-partial'),
    filterLost: $('#filter-lost'),
    filterOld: $('#filter-old'),
    filterUnavailable: $('#filter-unavailable'),
    filterAgeMonths: $('#filter-age-months'),
    ageValue: $('#age-value'),
    ageSliderContainer: $('#age-slider-container'),
    btnScan: $('#btn-scan'),
    scanStatus: $('#scan-status'),
    statMatched: $('#stat-matched'),
    statTotal: $('#stat-total'),
    resultsList: $('#results-list'),
    btnSelectAll: $('#btn-select-all'),
    btnDeselectAll: $('#btn-deselect-all'),
    btnBack: $('#btn-back'),
    btnDelete: $('#btn-delete'),
    deleteCount: $('#delete-count'),
    progressBar: $('#progress-bar'),
    progressText: $('#progress-text'),
    progressCurrent: $('#progress-current'),
    btnCancelDelete: $('#btn-cancel-delete'),
    doneTitleEl: $('#done-title'),
    doneMessage: $('#done-message'),
    doneSucceeded: $('#done-succeeded'),
    doneFailed: $('#done-failed'),
    doneFailedGroup: $('#done-failed-group'),
    btnDone: $('#btn-done'),
    modalConfirm: $('#modal-confirm'),
    modalMessage: $('#modal-message'),
    btnModalCancel: $('#btn-modal-cancel'),
    btnModalConfirm: $('#btn-modal-confirm'),
  };

  // ================ State ================
  let allItems = [];
  let filteredItems = [];
  let selectedIds = new Set();

  // ================ Screen Management ================
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.add('hidden'));
    if (screens[name]) screens[name].classList.remove('hidden');
  }

  // ================ Messaging ================
  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response?.error) {
          reject(new Error(response.error));
        } else {
          resolve(response);
        }
      });
    });
  }

  // ================ Init ================
  async function init() {
    try {
      const info = await sendMessage({ action: 'ensureContentScript' });
      
      const status = await sendMessage({ action: 'getStatus' });
      if (status && status.isDeleting && status.progress) {
        resumeDeletion(status.progress);
      } else {
        showPlaylistMain(info);
      }
    } catch (err) {
      showScreen('noPlaylist');
      if (err.message === 'NOT_PLAYLIST_PAGE') {
        document.querySelector('#screen-no-playlist h2').textContent = 'Open a YouTube Playlist';
        document.querySelector('#screen-no-playlist .empty-desc').textContent = 'Navigate to any YouTube playlist page to get started.';
      } else {
        document.querySelector('#screen-no-playlist h2').textContent = 'Connection Error';
        document.querySelector('#screen-no-playlist .empty-desc').textContent = err.message;
        console.warn('[YT-PM] Init error:', err.message);
      }
    }
  }

  function resumeDeletion(progress) {
    showScreen('deleting');
    els.btnCancelDelete.disabled = false;
    updateDeleteProgressUI(progress);
  }

  function showPlaylistMain(info) {
    els.playlistTitle.textContent = info.title || 'Playlist';
    const countText = info.videoCount
      ? `${info.videoCount} video${info.videoCount !== 1 ? 's' : ''}`
      : 'Playlist loaded';
    els.playlistMeta.textContent = countText;
    showScreen('main');
  }

  // ================ Age Filter Toggle ================
  function onOldFilterToggle() {
    if (els.filterOld.checked) {
      els.ageSliderContainer.classList.remove('hidden');
    } else {
      els.ageSliderContainer.classList.add('hidden');
    }
  }

  function onAgeSliderChange() {
    const months = parseInt(els.filterAgeMonths.value, 10);
    if (months >= 12) {
      const years = Math.floor(months / 12);
      const rem = months % 12;
      els.ageValue.textContent = years === 1 && rem === 0 ? '1 year' : 
                                 rem === 0 ? `${years} years` :
                                 `${years} yr ${rem} mo`;
    } else {
      els.ageValue.textContent = months === 1 ? '1 month' : `${months} months`;
    }
  }

  function estimateAgeInMonths(text) {
    if (!text) return 0;
    const match = text.match(/(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/i);
    if (!match) return 0;
    const val = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    if (unit === 'year') return val * 12;
    if (unit === 'month') return val;
    if (unit === 'week') return val * 0.25;
    if (unit === 'day') return val / 30;
    return 0;
  }

  // ================ Scanning ================
  async function startScan() {
    showScreen('scanning');
    els.scanStatus.textContent = 'Scrolling to load all videos...';

    try {
      const response = await sendMessage({ action: 'scrapePlaylist' });

      allItems = response.items || [];
      els.scanStatus.textContent = `Found ${allItems.length} videos. Applying filters...`;

      applyFilters();
      showResults();
    } catch (err) {
      console.error('[YT-PM] Scan error:', err);
      alert('Scan failed: ' + err.message);
      showScreen('main');
    }
  }

  // ================ Filtering ================
  function applyFilters() {
    const wantAll = els.filterAll.checked;
    const wantWatched = els.filterWatched.checked;
    const wantPartial = els.filterPartial.checked;
    const wantLost = els.filterLost.checked;
    const wantOld = els.filterOld.checked;
    const wantUnavailable = els.filterUnavailable.checked;
    const ageThreshold = parseInt(els.filterAgeMonths.value, 10);

    filteredItems = allItems.filter((item) => {
      const reasons = [];

      if (wantAll) {
        reasons.push('all');
      }

      if (wantWatched && item.watchProgress != null && item.watchProgress >= 90) {
        reasons.push('watched');
      }

      if (wantPartial && item.watchProgress != null &&
          item.watchProgress > 5 && item.watchProgress < 90) {
        reasons.push('partial');
      }

      if (wantLost && item.watchProgress != null &&
          item.watchProgress >= 40 && item.watchProgress <= 80) {
        reasons.push('lost');
      }

      if (wantOld) {
        const ageMonths = estimateAgeInMonths(item.metaText);
        if (ageMonths >= ageThreshold) {
          reasons.push('old');
        }
      }

      if (wantUnavailable && item.isUnavailable) {
        reasons.push('unavailable');
      }

      if (reasons.length > 0) {
        item._matchReasons = reasons;
        return true;
      }
      return false;
    });

    selectedIds = new Set(filteredItems.map((i) => i.videoId));
  }

  // ================ Results ================
  function showResults() {
    els.statMatched.textContent = filteredItems.length;
    els.statTotal.textContent = allItems.length;

    if (filteredItems.length === 0) {
      els.resultsList.innerHTML = `
        <div class="no-results">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M8 15h8"/>
            <circle cx="9" cy="9" r="1" fill="currentColor"/>
            <circle cx="15" cy="9" r="1" fill="currentColor"/>
          </svg>
          <h4>No videos matched</h4>
          <p>Try enabling more filters or checking a different playlist.</p>
        </div>
      `;
    } else {
      renderResultsList();
    }

    updateDeleteCount();
    showScreen('results');
  }

  function renderResultsList() {
    const fragment = document.createDocumentFragment();

    for (const item of filteredItems) {
      const row = document.createElement('div');
      row.className = 'result-item';
      row.dataset.videoId = item.videoId;

      const isChecked = selectedIds.has(item.videoId);

      let badgeHTML = '';
      if (item._matchReasons?.includes('watched')) {
        badgeHTML += '<span class="result-badge badge-watched">✓ Watched</span>';
      }
      if (item._matchReasons?.includes('partial')) {
        const pct = Math.round(item.watchProgress || 0);
        badgeHTML += `<span class="result-badge badge-partial">▶ ${pct}%</span>`;
      }
      if (item._matchReasons?.includes('lost')) {
        const pct = Math.round(item.watchProgress || 0);
        badgeHTML += `<span class="result-badge badge-lost" style="background: rgba(33, 150, 243, 0.15); color: #64b5f6;">💤 Lost interest (${pct}%)</span>`;
      }
      if (item._matchReasons?.includes('old')) {
        badgeHTML += '<span class="result-badge badge-old" style="background: rgba(156, 39, 176, 0.15); color: #ce93d8;">🕐 Old</span>';
      }
      if (item._matchReasons?.includes('unavailable')) {
        badgeHTML += '<span class="result-badge badge-unavailable">⚠ Unavailable</span>';
      }

      const metaParts = [];
      if (item.channelTitle) metaParts.push(item.channelTitle);
      if (item.durationText) metaParts.push(item.durationText);

      row.innerHTML = `
        <input type="checkbox" class="result-checkbox"
               data-video-id="${item.videoId}"
               ${isChecked ? 'checked' : ''}>
        <img class="result-thumb"
             src="${escapeAttr(item.thumbnailUrl || '')}"
             alt="" loading="lazy">
        <div class="result-info">
          <div class="result-title" title="${escapeAttr(item.title)}">${escapeHtml(item.title)}</div>
          <div class="result-meta">
            <span>${escapeHtml(metaParts.join(' • '))}</span>
            ${badgeHTML}
          </div>
        </div>
      `;

      const img = row.querySelector('.result-thumb');
      img.addEventListener('error', () => {
        img.style.display = 'none';
      });

      row.addEventListener('click', (e) => {
        if (e.target.type === 'checkbox') return;
        const cb = row.querySelector('.result-checkbox');
        cb.checked = !cb.checked;
        toggleSelection(item.videoId, cb.checked);
      });

      row.querySelector('.result-checkbox').addEventListener('change', (e) => {
        toggleSelection(item.videoId, e.target.checked);
      });

      fragment.appendChild(row);
    }

    els.resultsList.innerHTML = '';
    els.resultsList.appendChild(fragment);
  }

  function toggleSelection(videoId, selected) {
    if (selected) selectedIds.add(videoId);
    else selectedIds.delete(videoId);
    updateDeleteCount();
  }

  function updateDeleteCount() {
    els.deleteCount.textContent = selectedIds.size;
    els.btnDelete.disabled = selectedIds.size === 0;
  }

  function selectAll() {
    selectedIds = new Set(filteredItems.map((i) => i.videoId));
    $$('.result-checkbox').forEach((cb) => (cb.checked = true));
    updateDeleteCount();
  }

  function deselectAll() {
    selectedIds.clear();
    $$('.result-checkbox').forEach((cb) => (cb.checked = false));
    updateDeleteCount();
  }

  // ================ Deletion ================
  function confirmDelete() {
    const count = selectedIds.size;
    if (count === 0) return;
    els.modalMessage.innerHTML =
      `Are you sure you want to remove <strong>${count}</strong> video${count > 1 ? 's' : ''} from this playlist?`;
    els.modalConfirm.classList.remove('hidden');
  }

  async function executeDelete() {
    els.modalConfirm.classList.add('hidden');
    showScreen('deleting');
    els.btnCancelDelete.disabled = false;

    const videoIds = filteredItems
      .filter((i) => selectedIds.has(i.videoId))
      .map((i) => i.videoId);

    els.progressBar.style.width = '0%';
    els.progressText.textContent = `0 / ${videoIds.length}`;
    els.progressCurrent.textContent = 'Starting...';

    try {
      // We don't await this directly for the UI flow because if the popup closes,
      // the promise dies. We rely on the 'deleteComplete' event instead.
      sendMessage({
        action: 'bulkRemove',
        videoIds,
      });
    } catch (err) {
      console.error('[YT-PM] Delete error:', err);
      alert('Deletion failed: ' + err.message);
      showScreen('results');
    }
  }

  async function cancelDelete() {
    els.btnCancelDelete.disabled = true;
    els.progressCurrent.textContent = 'Stopping...';
    try {
      await sendMessage({ action: 'abort' });
    } catch (err) {
      console.error('[YT-PM] Cancel error:', err);
    }
  }

  function showDone(succeeded, failed, aborted = false) {
    els.doneSucceeded.textContent = succeeded;
    els.doneFailed.textContent = failed;

    if (aborted) {
      els.doneFailedGroup.style.display = '';
      els.doneTitleEl.textContent = 'Cleaning Stopped';
      els.doneMessage.textContent = 'The deletion process was cancelled by you.';
    } else if (failed > 0) {
      els.doneFailedGroup.style.display = '';
      els.doneTitleEl.textContent = 'Partially Done';
      els.doneMessage.textContent = 'Some videos could not be removed.';
    } else {
      els.doneFailedGroup.style.display = 'none';
      els.doneTitleEl.textContent = 'Done!';
      els.doneMessage.textContent = 'Successfully removed videos from your playlist.';
    }

    showScreen('done');
  }

  // ================ Progress Listener ================
  function updateDeleteProgressUI(message) {
    const { completed, total, videoTitle } = message;
    const pct = Math.round((completed / total) * 100);
    els.progressBar.style.width = `${pct}%`;
    els.progressText.textContent = `${completed} / ${total}`;
    els.progressCurrent.textContent = videoTitle || `Video ${completed}`;
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'deleteProgress') {
      updateDeleteProgressUI(message);
    }
    if (message.action === 'deleteComplete') {
      const result = message.result || { succeeded: 0, failed: 0, aborted: false };
      showDone(result.succeeded, result.failed, result.aborted);
    }
    if (message.action === 'scanProgress') {
      els.scanStatus.textContent = `Loaded ${message.loaded} videos...`;
    }
  });

  // ================ Utilities ================
  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  function escapeAttr(str) {
    return (str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ================ Event Listeners ================
  els.btnScan.addEventListener('click', startScan);
  els.filterOld.addEventListener('change', onOldFilterToggle);
  els.filterAgeMonths.addEventListener('input', onAgeSliderChange);
  els.btnSelectAll.addEventListener('click', selectAll);
  els.btnDeselectAll.addEventListener('click', deselectAll);
  els.btnBack.addEventListener('click', () => showScreen('main'));
  els.btnDelete.addEventListener('click', confirmDelete);
  els.btnModalCancel.addEventListener('click', () => els.modalConfirm.classList.add('hidden'));
  els.btnModalConfirm.addEventListener('click', executeDelete);
  els.btnCancelDelete.addEventListener('click', cancelDelete);
  els.btnDone.addEventListener('click', () => {
    showScreen('main');
  });

  // Init state
  onOldFilterToggle();
  onAgeSliderChange();

  // Boot
  init();
})();
