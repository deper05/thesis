/* Enhanced carousel with all improvements */
(function () {
  // ═══════════════════ CONFIGURATION ═══════════════════
  const CONFIG = {
    AUTO_INTERVAL_MS: 7000,
    REFRESH_INTERVAL_MS: 30000,
    STALE_THRESHOLD_MS: 30 * 60 * 1000,
    INTERACTION_PAUSE_MS: 2200,
    SWIPE_THRESHOLD_PX: 80,
    MAX_RETRIES: 3,
    RETRY_DELAY_MS: 2000,
    CACHE_DURATION_MS: 25000,
    
    SENSOR_THRESHOLDS: {
      ph: { min: 6.5, max: 8.5, unit: '', label: 'pH Level' },
      temp: { min: 15, max: 35, unit: '°C', label: 'Temperature' },
      tds: { max: 500, unit: 'ppm', label: 'TDS' },
      turb: { max: 5, unit: 'NTU', label: 'Turbidity' }
    },
    
    FIREBASE_BASE: 'https://thesis-1bda3-default-rtdb.asia-southeast1.firebasedatabase.app'
  };

  // ═══════════════════ DOM REFERENCES ═══════════════════
  const container = document.getElementById('carousel-container');
  const track = document.getElementById('carousel-track');
  const wrapper = document.getElementById('carousel-wrapper');
  const prevBtn = document.getElementById('carousel-prev');
  const nextBtn = document.getElementById('carousel-next');
  const pageIndicator = document.getElementById('page-indicator');
  const minimizeBtn = document.getElementById('minimize-btn');
  const headerToggle = document.getElementById('carousel-header-toggle');
  const loadingEl = document.getElementById('carousel-loading');
  const updateText = document.getElementById('update-text');
  const srAnnouncements = document.getElementById('screen-reader-announcements');

  // ═══════════════════ STATE ═══════════════════
  let pages = [];
  let currentPage = 0;
  let totalPages = 0;
  let autoInterval = null;
  let userInteracting = false;
  let resumeTimer = null;
  let lastFetchTime = 0;
  let cachedData = null;
  let retryCount = 0;
  let isRefreshing = false;

  // ═══════════════════ UTILITIES ═══════════════════
  function formatTimestamp(ts) {
    if (!ts) return '--';
    try {
      const [datePart, timePart] = ts.split('_');
      const [y, m, d] = datePart.split('-');
      const [hh, mm] = timePart.split('-');
      return `${y}-${m}-${d} ${hh}:${mm}`;
    } catch (e) {
      return '--';
    }
  }

  function isStale(ts) {
    if (!ts) return true;
    try {
      const [datePart, timePart] = ts.split('_');
      const [y, m, d] = datePart.split('-');
      const [hh, mm] = timePart.split('-');
      const t = new Date(y, parseInt(m) - 1, d, hh, mm);
      return (Date.now() - t.getTime()) > CONFIG.STALE_THRESHOLD_MS;
    } catch (e) {
      return true;
    }
  }

  function safeNum(v) {
    return (typeof v === 'number' && !isNaN(v)) ? v : null;
  }

  function sensorStatus(val, type) {
    if (val === null) return 'missing';
    const threshold = CONFIG.SENSOR_THRESHOLDS[type];
    if (!threshold) return 'missing';
    
    if (threshold.min !== undefined && threshold.max !== undefined) {
      return (val >= threshold.min && val <= threshold.max) ? 'good' : 'bad';
    }
    if (threshold.max !== undefined) {
      return val <= threshold.max ? 'good' : 'bad';
    }
    return 'missing';
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));
  }

  function announceToScreenReader(message) {
    srAnnouncements.textContent = message;
    setTimeout(() => { srAnnouncements.textContent = ''; }, 1000);
  }

  function triggerHaptic() {
    if ('vibrate' in navigator) {
      navigator.vibrate(10);
    }
  }

  function updateLastUpdatedDisplay() {
    if (lastFetchTime) {
      const elapsed = Math.floor((Date.now() - lastFetchTime) / 1000);
      if (elapsed < 60) {
        updateText.textContent = `Updated ${elapsed}s ago`;
      } else {
        updateText.textContent = `Updated ${Math.floor(elapsed / 60)}m ago`;
      }
    } else {
      updateText.textContent = 'Checking...';
    }
  }

  // ═══════════════════ DOM CREATION ═══════════════════
  function createBarangayPage(name, desc, ts, sensors) {
    const page = document.createElement('div');
    page.className = 'barangay-page';
    const stale = isStale(ts);
    const hasAlert = sensors.some(s => s.status === 'bad');

    const left = document.createElement('div');
    left.className = 'barangay-card ' + (stale ? 'stale' : '') + (hasAlert ? ' alert' : '');
    left.setAttribute('role', 'article');
    left.setAttribute('aria-label', `${name} water quality station`);
    
    let alertBadge = '';
    if (hasAlert) {
      const alertCount = sensors.filter(s => s.status === 'bad').length;
      alertBadge = `<span class="alert-badge" role="status">⚠ ${alertCount} Alert${alertCount > 1 ? 's' : ''}</span>`;
    }
    
    left.innerHTML = `
      <div>
        <h4>${escapeHtml(name)}</h4>
        <p>${escapeHtml(desc || '')}</p>
        ${alertBadge}
      </div>
      <div class="barangay-timestamp">
        <span class="timestamp-label">Last Reading</span>
        <span class="timestamp-value ${stale ? 'stale' : ''}" ${stale ? 'aria-label="Data is stale"' : ''}>${formatTimestamp(ts)}</span>
      </div>
    `;

    const grid = document.createElement('div');
    grid.className = 'sensors-grid';
    grid.setAttribute('role', 'list');
    grid.setAttribute('aria-label', 'Sensor readings');

    sensors.forEach(s => {
      const card = document.createElement('div');
      card.className = 'compact-sensor-card ' + s.status;
      card.setAttribute('role', 'listitem');
      
      let ariaLabel = `${s.label}: `;
      if (s.status === 'missing') {
        ariaLabel += 'no data';
      } else if (s.status === 'bad') {
        ariaLabel += `${s.display} ${s.unit}, alert level`;
      } else {
        ariaLabel += `${s.display} ${s.unit}, normal`;
      }
      card.setAttribute('aria-label', ariaLabel);
      
      card.innerHTML = `
        <div class="sensor-label-compact">${escapeHtml(s.label)}</div>
        <div class="sensor-value-compact">${s.display}</div>
        <div class="sensor-unit-compact">${s.unit || ''}</div>
      `;
      grid.appendChild(card);
    });

    page.appendChild(left);
    page.appendChild(grid);
    return page;
  }

  function createErrorState(message, details) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'carousel-error';
    errorDiv.setAttribute('role', 'alert');
    errorDiv.innerHTML = `
      <svg class="error-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
      </svg>
      <div class="error-message">${escapeHtml(message)}</div>
      <div class="error-details">${escapeHtml(details)}</div>
      <button class="retry-btn" id="retry-fetch">Retry Now</button>
    `;
    return errorDiv;
  }

  // ═══════════════════ RENDERING ═══════════════════
  function renderPages(pageEls, isError = false) {
    track.innerHTML = '';
    
    if (isError || !pageEls || !pageEls.length) {
      if (isError) {
        track.appendChild(pageEls);
      } else {
        track.appendChild(loadingEl);
      }
      totalPages = 0;
      currentPage = 0;
      updateNav();
      return;
    }

    pageEls.forEach(p => track.appendChild(p));
    totalPages = pageEls.length;
    if (currentPage >= totalPages) currentPage = 0;
    updateTransform();
    updateNav();
  }

  function updateTransform() {
    track.style.transform = `translateX(${-currentPage * 100}%)`;
    pageIndicator.textContent = `${Math.max(1, currentPage + 1)} / ${Math.max(1, totalPages)}`;
    updateNav();
    
    if (totalPages > 0) {
      announceToScreenReader(`Showing station ${currentPage + 1} of ${totalPages}`);
    }
  }

  function updateNav() {
    prevBtn.disabled = currentPage === 0 || totalPages === 0;
    nextBtn.disabled = currentPage >= totalPages - 1 || totalPages === 0;
  }

  // ═══════════════════ AUTO-SCROLL ═══════════════════
  function startAuto() {
    if (autoInterval || totalPages <= 1) return;
    autoInterval = setInterval(() => {
      if (userInteracting) return;
      currentPage = (currentPage + 1) % totalPages;
      updateTransform();
    }, CONFIG.AUTO_INTERVAL_MS);
  }

  function stopAuto() {
    if (autoInterval) {
      clearInterval(autoInterval);
      autoInterval = null;
    }
  }

  function pauseAutoForInteraction() {
    userInteracting = true;
    stopAuto();
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      userInteracting = false;
      startAuto();
    }, CONFIG.INTERACTION_PAUSE_MS);
  }

  // ═══════════════════ DATA FETCHING ═══════════════════
  async function fetchWithRetry(url, retries = CONFIG.MAX_RETRIES) {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json();
      } catch (err) {
        if (i === retries - 1) throw err;
        await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY_MS * (i + 1)));
      }
    }
  }

  async function fetchCarouselData(forceRefresh = false) {
    // Use cache if recent
    if (!forceRefresh && cachedData && (Date.now() - lastFetchTime) < CONFIG.CACHE_DURATION_MS) {
      renderPages(cachedData);
      return;
    }

    try {
      isRefreshing = true;
      container.classList.add('refreshing');
      loadingEl.style.display = 'flex';
      updateText.textContent = 'Refreshing...';

      // Fetch metadata
      const metadata = await fetchWithRetry(`${CONFIG.FIREBASE_BASE}/unitsMetadata.json`);
      if (!metadata || typeof metadata !== 'object') {
        throw new Error('Invalid metadata format');
      }

      const unitIds = Object.keys(metadata).sort();
      if (!unitIds.length) {
        renderPages([]);
        lastFetchTime = Date.now();
        updateLastUpdatedDisplay();
        return;
      }

      // Fetch all units in parallel
      const unitPromises = unitIds.map(async uid => {
        try {
          const raw = await fetchWithRetry(`${CONFIG.FIREBASE_BASE}/${uid}.json`);
          return { uid, raw, meta: metadata[uid] };
        } catch (err) {
          console.warn('Unit fetch failed', uid, err);
          return { uid, raw: null, meta: metadata[uid] };
        }
      });

      const results = await Promise.all(unitPromises);
      const newPages = [];
      let alertCount = 0;

      // Process results
      for (const { uid, raw, meta } of results) {
        const suffix = uid.split('_').pop();
        const name = meta?.name || uid;
        const desc = meta?.description || '';

        if (!raw || typeof raw !== 'object') {
          // Missing data page
          const sensors = Object.keys(CONFIG.SENSOR_THRESHOLDS).map(type => ({
            label: CONFIG.SENSOR_THRESHOLDS[type].label,
            display: '--',
            unit: CONFIG.SENSOR_THRESHOLDS[type].unit,
            status: 'missing'
          }));
          newPages.push(createBarangayPage(name, desc, null, sensors));
          continue;
        }

        const timestamps = Object.keys(raw)
          .filter(k => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}$/.test(k))
          .sort();

        if (!timestamps.length) {
          const sensors = Object.keys(CONFIG.SENSOR_THRESHOLDS).map(type => ({
            label: CONFIG.SENSOR_THRESHOLDS[type].label,
            display: '--',
            unit: CONFIG.SENSOR_THRESHOLDS[type].unit,
            status: 'missing'
          }));
          newPages.push(createBarangayPage(name, desc, null, sensors));
          continue;
        }

        const latest = timestamps[timestamps.length - 1];
        const data = raw[latest] || {};

        const sensors = Object.entries(CONFIG.SENSOR_THRESHOLDS).map(([type, config]) => {
          const key = `${type === 'temp' ? 'temperature' : type === 'turb' ? 'turbidity' : type}_${suffix}`;
          const val = safeNum(data[key]);
          const status = sensorStatus(val, type);
          
          if (status === 'bad') alertCount++;
          
          return {
            label: config.label,
            display: val === null ? '--' : val.toFixed(type === 'tds' ? 0 : (type === 'ph' ? 2 : 1)),
            unit: config.unit,
            status: status
          };
        });

        newPages.push(createBarangayPage(name, desc, latest, sensors));
      }

      // Sort pages: alerts first, then by name
      newPages.sort((a, b) => {
        const aHasAlert = a.querySelector('.alert-badge') !== null;
        const bHasAlert = b.querySelector('.alert-badge') !== null;
        if (aHasAlert && !bHasAlert) return -1;
        if (!aHasAlert && bHasAlert) return 1;
        return 0;
      });

      if (!newPages.length) {
        renderPages([]);
      } else {
        pages = newPages;
        cachedData = newPages;
        renderPages(pages);
        container.classList.remove('minimized');
        
        if (alertCount > 0) {
          announceToScreenReader(`Alert: ${alertCount} sensor${alertCount > 1 ? 's' : ''} outside normal range`);
        }
      }

      lastFetchTime = Date.now();
      retryCount = 0;
      updateLastUpdatedDisplay();

    } catch (err) {
      console.error('Carousel fetch error', err);
      retryCount++;
      
      const errorEl = createErrorState(
        'Unable to load water quality data',
        retryCount >= CONFIG.MAX_RETRIES 
          ? 'Please check your connection and try again' 
          : `Retrying... (${retryCount}/${CONFIG.MAX_RETRIES})`
      );
      
      renderPages(errorEl, true);
      
      // Auto-retry with exponential backoff
      if (retryCount < CONFIG.MAX_RETRIES) {
        setTimeout(() => fetchCarouselData(true), CONFIG.RETRY_DELAY_MS * retryCount);
      }
      
      announceToScreenReader('Error loading data');
    } finally {
      isRefreshing = false;
      container.classList.remove('refreshing');
      loadingEl.style.display = 'none';
    }
  }

  // ═══════════════════ EVENT HANDLERS ═══════════════════
  prevBtn.addEventListener('click', () => {
    if (currentPage > 0) {
      currentPage--;
      updateTransform();
      pauseAutoForInteraction();
      triggerHaptic();
    }
  });

  nextBtn.addEventListener('click', () => {
    if (currentPage < totalPages - 1) {
      currentPage++;
      updateTransform();
      pauseAutoForInteraction();
      triggerHaptic();
    }
  });

  minimizeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isMinimized = container.classList.toggle('minimized');
    headerToggle.setAttribute('aria-expanded', String(!isMinimized));
    minimizeBtn.textContent = isMinimized ? '+' : '−';
    minimizeBtn.setAttribute('aria-label', isMinimized ? 'Expand carousel' : 'Minimize carousel');
    announceToScreenReader(isMinimized ? 'Carousel minimized' : 'Carousel expanded');
  });

  headerToggle.addEventListener('click', (e) => {
    if (e.target.closest('.nav-btn') || e.target.closest('#minimize-btn')) return;
    const isMinimized = container.classList.toggle('minimized');
    headerToggle.setAttribute('aria-expanded', String(!isMinimized));
    minimizeBtn.textContent = isMinimized ? '+' : '−';
    announceToScreenReader(isMinimized ? 'Carousel minimized' : 'Carousel expanded');
  });

  headerToggle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      headerToggle.click();
    }
  });

  // Drag / swipe
  let startX = null, isDown = false, currentTranslate = 0;
  
  wrapper.addEventListener('pointerdown', (e) => {
    startX = e.clientX;
    isDown = true;
    currentTranslate = -currentPage * wrapper.offsetWidth;
    track.classList.add('dragging');
    pauseAutoForInteraction();
  }, { passive: true });

  window.addEventListener('pointerup', (e) => {
    if (!isDown) return;
    isDown = false;
    track.classList.remove('dragging');
    
    const dx = startX - e.clientX;
    if (Math.abs(dx) > CONFIG.SWIPE_THRESHOLD_PX) {
      if (dx > 0 && currentPage < totalPages - 1) {
        currentPage++;
        triggerHaptic();
      } else if (dx < 0 && currentPage > 0) {
        currentPage--;
        triggerHaptic();
      }
      updateTransform();
    }
  });

  wrapper.addEventListener('pointermove', (e) => {
    if (!isDown) return;
    e.preventDefault();
    const dx = e.clientX - startX;
    const translate = currentTranslate + dx;
    track.style.transform = `translateX(${translate}px)`;
  }, { passive: false });

  // Keyboard
  container.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' && currentPage > 0) {
      e.preventDefault();
      currentPage--;
      updateTransform();
      pauseAutoForInteraction();
    }
    if (e.key === 'ArrowRight' && currentPage < totalPages - 1) {
      e.preventDefault();
      currentPage++;
      updateTransform();
      pauseAutoForInteraction();
    }
    if (e.key === 'Home') {
      e.preventDefault();
      currentPage = 0;
      updateTransform();
      pauseAutoForInteraction();
    }
    if (e.key === 'End') {
      e.preventDefault();
      currentPage = totalPages - 1;
      updateTransform();
      pauseAutoForInteraction();
    }
  });

  // Retry button (delegated)
  track.addEventListener('click', (e) => {
    if (e.target.id === 'retry-fetch') {
      retryCount = 0;
      fetchCarouselData(true);
    }
  });

  // Tab visibility
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopAuto();
    } else {
      startAuto();
      // Refresh data if stale
      if (Date.now() - lastFetchTime > CONFIG.CACHE_DURATION_MS) {
        fetchCarouselData(true);
      }
    }
  });

  // ═══════════════════ INITIALIZATION ═══════════════════
  fetchCarouselData().then(() => {
    if (pages.length > 1) startAuto();
  });

  // Periodic refresh
  setInterval(() => {
    if (!document.hidden && !isRefreshing) {
      fetchCarouselData(true);
    }
  }, CONFIG.REFRESH_INTERVAL_MS);

  // Update "last updated" display every 10s
  setInterval(updateLastUpdatedDisplay, 10000);

  // ═══════════════════ PUBLIC API ═══════════════════
  window._sc_carousel = {
    refresh: () => fetchCarouselData(true),
    goto: (n) => {
      if (n >= 0 && n < totalPages) {
        currentPage = n;
        updateTransform();
        pauseAutoForInteraction();
      }
    },
    minimize: () => {
      container.classList.add('minimized');
      headerToggle.setAttribute('aria-expanded', 'false');
      minimizeBtn.textContent = '+';
    },
    expand: () => {
      container.classList.remove('minimized');
      headerToggle.setAttribute('aria-expanded', 'true');
      minimizeBtn.textContent = '−';
    },
    getConfig: () => CONFIG,
    getStats: () => ({
      totalPages,
      currentPage,
      lastFetchTime,
      retryCount,
      isRefreshing,
      cacheAge: Date.now() - lastFetchTime
    })
  };
})();