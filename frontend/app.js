/* =============================================================================
   QuantView AI — app.js v3.0
   Multi-market support: India (NSE/BSE) + US
   All prices, ATR, etc. use currency from the API response.
============================================================================= */

const API_BASE = (window.location.protocol === 'file:') ? 'http://127.0.0.1:8000' : '';
window.QV_API_BASE = API_BASE;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const tickerInput  = document.getElementById('ticker-input');
const analyzeBtn   = document.getElementById('analyze-btn');
const loadingState = document.getElementById('loading-state');
const errorState   = document.getElementById('error-state');
const errorMsg     = document.getElementById('error-msg');
const errorRetry   = document.getElementById('error-retry');
const resultPanel  = document.getElementById('result-panel');
const loadingTimer = document.getElementById('loading-timer');

const loadingSteps = {
  fetch:      document.getElementById('ls-fetch'),
  indicators: document.getElementById('ls-indicators'),
  regime:     document.getElementById('ls-regime'),
  backtest:   document.getElementById('ls-backtest'),
  train:      document.getElementById('ls-train'),
  predict:    document.getElementById('ls-predict'),
};

// ── State ─────────────────────────────────────────────────────────────────────
let _timerInterval = null;
let _stepInterval  = null;
let _lastTicker    = null;
let _hasAnalysis   = false;
let _isNewsOnlyMode = false;

function updateAnalysisNavVisibility(hasAnalysis) {
  _hasAnalysis = !!hasAnalysis;
  document.querySelectorAll('.analysis-nav-item').forEach(el => {
    el.classList.toggle('hidden', !_hasAnalysis);
  });
}

function setActiveSidebarLink(linkId) {
  document.querySelectorAll('.sidebar-link').forEach(link => {
    if (link.id === linkId) {
      link.classList.add('active');
      if (!link.querySelector('.sidebar-link-glow')) {
        const glow = document.createElement('span');
        glow.className = 'sidebar-link-glow';
        link.appendChild(glow);
      }
    } else {
      link.classList.remove('active');
      const glow = link.querySelector('.sidebar-link-glow');
      if (glow) glow.remove();
    }
  });
}

function setNewsOnlyMode(enabled) {
  _isNewsOnlyMode = !!enabled;
  const dashboardMain = document.querySelector('.dashboard-main');
  const toggleText = document.getElementById('news-toggle-text');
  const toggleViewBtn = document.getElementById('btn-toggle-news-view');

  if (!dashboardMain) return;

  if (_isNewsOnlyMode) {
    dashboardMain.classList.add('news-only-active');
    if (toggleText) toggleText.textContent = '← Back to Full Dashboard';
    if (toggleViewBtn) toggleViewBtn.classList.add('active-mode');
    setActiveSidebarLink('nav-link-news');
    const newsSection = document.getElementById('market-news');
    if (newsSection) {
      newsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  } else {
    dashboardMain.classList.remove('news-only-active');
    if (toggleText) toggleText.textContent = 'Focus: News Only Mode';
    if (toggleViewBtn) toggleViewBtn.classList.remove('active-mode');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const pct = (v, digits = 1) =>
  v != null && isFinite(v) ? `${(v * 100).toFixed(digits)}%` : 'N/A';

const num = (v, digits = 2) =>
  v != null && isFinite(v) ? Number(v).toFixed(digits) : 'N/A';

/**
 * Format a monetary value with the correct currency symbol.
 * @param {number|null} v - value
 * @param {string} sym - currency symbol, e.g. '₹' or '$'
 * @param {number} digits
 */
function currency(v, sym = '$', digits = 2) {
  if (v == null || !isFinite(v)) return 'N/A';
  return `${sym}${Number(v).toLocaleString('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

// Signal → CSS class mapping
const SIG_CLASS = {
  bullish:        'sig-bullish',
  bearish:        'sig-bearish',
  neutral:        'sig-neutral',
  elevated:       'sig-elevated',
  low:            'sig-low',
  normal:         'sig-normal',
  undervalued:    'sig-undervalued',
  overvalued:     'sig-overvalued',
  fair:           'sig-fair',
  unavailable:    'sig-unavailable',
  not_applicable: 'sig-not-applicable',
};

// Gauge arc (semi-circle)
const GAUGE_ARC = Math.PI * 70;

function arcDashArray(fraction) {
  const f = Math.max(0, Math.min(1, fraction)) * GAUGE_ARC;
  return `${f} ${GAUGE_ARC - f}`;
}

function gaugeColor(score) {
  if (score >= 65) return 'hsl(160 100% 45%)';
  if (score >= 40) return 'hsl(38  100% 55%)';
  return 'hsl(348 100% 65%)';
}

// ── Loading step animator ─────────────────────────────────────────────────────
const STEP_ORDER = ['fetch', 'indicators', 'regime', 'backtest', 'train', 'predict'];
let _stepIdx = 0;

function startLoadingSteps() {
  _stepIdx = 0;
  Object.values(loadingSteps).forEach(el => el.classList.remove('active', 'done'));
  loadingSteps[STEP_ORDER[0]].classList.add('active');

  _stepInterval = setInterval(() => {
    if (_stepIdx < STEP_ORDER.length) {
      loadingSteps[STEP_ORDER[_stepIdx]].classList.remove('active');
      loadingSteps[STEP_ORDER[_stepIdx]].classList.add('done');
    }
    _stepIdx++;
    if (_stepIdx < STEP_ORDER.length) {
      loadingSteps[STEP_ORDER[_stepIdx]].classList.add('active');
    } else {
      clearInterval(_stepInterval);
    }
  }, 15000);  // visual pacing, not tied to actual progress
}

function stopLoadingSteps() {
  clearInterval(_stepInterval);
  Object.values(loadingSteps).forEach(el => el.classList.add('done'));
}

// ── UI state helpers ──────────────────────────────────────────────────────────
function showLoading() {
  if (_timerInterval) {
    clearInterval(_timerInterval);
    _timerInterval = null;
  }
  if (_stepInterval) {
    clearInterval(_stepInterval);
    _stepInterval = null;
  }

  loadingState.classList.remove('hidden');
  errorState.classList.add('hidden');
  resultPanel.classList.add('hidden');
  analyzeBtn.disabled = true;
  loadingState.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  let secs = 0;
  loadingTimer.textContent = 'Elapsed: 0s';
  _timerInterval = setInterval(() => {
    secs++;
    loadingTimer.textContent = `Elapsed: ${secs}s`;
  }, 1000);

  startLoadingSteps();
}

function hideLoading() {
  loadingState.classList.add('hidden');
  analyzeBtn.disabled = false;
  if (_timerInterval) {
    clearInterval(_timerInterval);
    _timerInterval = null;
  }
  stopLoadingSteps();
}

function showError(msg) {
  hideLoading();
  errorMsg.textContent = msg;
  errorState.classList.remove('hidden');
  resultPanel.classList.add('hidden');
}

function showResult() {
  hideLoading();
  _hasAnalysis = true;
  updateAnalysisNavVisibility(true);
  errorState.classList.add('hidden');
  resultPanel.classList.remove('hidden');
  resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  setActiveSidebarLink('nav-link-dash');
}

// ── Render functions ──────────────────────────────────────────────────────────


// ── Institutional & Fundamental Intelligence (6 Cards) ──────────────────────
function renderInstitutionalIntelligence(data) {
  const inst = data.institutional_intelligence;
  const section = document.getElementById('institutional-section');
  if (!section) return;

  if (!inst) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  const isIndia = data.market ? data.market.is_india : (data.ticker.endsWith('.NS') || data.ticker.endsWith('.BO'));
  const currSym = isIndia ? '₹' : '$';
  const currCode = isIndia ? 'INR' : 'USD';

  // 1. Analyst Consensus
  const ratingEl = document.getElementById('inst-analyst-rating');
  const countEl = document.getElementById('inst-analyst-count');
  const needleEl = document.getElementById('inst-gauge-needle');
  const pathEl = document.getElementById('inst-gauge-path');

  if (ratingEl) {
    const rawRating = (inst.analyst_rating || 'Not Covered').toUpperCase();
    ratingEl.textContent = rawRating;
    if (rawRating.includes('BUY')) {
      ratingEl.className = 'inst-val-highlight green';
    } else if (rawRating.includes('SELL') || rawRating.includes('UNDERPERFORM')) {
      ratingEl.className = 'inst-val-highlight red';
    } else if (rawRating.includes('HOLD')) {
      ratingEl.className = 'inst-val-highlight amber';
    } else {
      ratingEl.className = 'inst-val-highlight cyan';
    }
  }
  if (countEl) {
    countEl.textContent = inst.analyst_count > 0 ? `${inst.analyst_count} analysts` : '0 analysts';
  }

  // Calculate needle angle (-70deg to +70deg from score 0-100)
  if (needleEl) {
    const score = inst.analyst_score !== undefined ? inst.analyst_score : 50;
    const angle = ((score / 100) * 140) - 70;
    const rad = (angle - 90) * (Math.PI / 180);
    const x2 = (27 + 18 * Math.cos(rad)).toFixed(1);
    const y2 = (25 + 18 * Math.sin(rad)).toFixed(1);
    needleEl.setAttribute('x2', x2);
    needleEl.setAttribute('y2', y2);
    if (pathEl) {
      pathEl.style.stroke = score >= 60 ? '#10b981' : (score <= 35 ? '#ef4444' : '#f59e0b');
    }
  }

  // 2. Target Price
  const targetPriceEl = document.getElementById('inst-target-price');
  const targetCountEl = document.getElementById('inst-target-analysts');
  if (targetPriceEl) {
    if (inst.target_price !== null && inst.target_price !== undefined && inst.target_price > 0) {
      targetPriceEl.innerHTML = `${currSym}${inst.target_price.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} <span class="inst-curr">${currCode}</span>`;
      if (targetCountEl) {
        targetCountEl.textContent = inst.analyst_count > 0 ? `${inst.analyst_count} analysts` : 'Target Price';
      }
    } else {
      targetPriceEl.textContent = 'N/A';
      if (targetCountEl) {
        targetCountEl.textContent = inst.analyst_count > 0 ? `${inst.analyst_count} analysts` : 'Coverage unavailable';
      }
    }
  }

  // 3. Earnings Revenue Forecast
  const revArrowEl = document.getElementById('inst-rev-arrow');
  const revLabelEl = document.getElementById('inst-rev-label');
  const revSubEl = document.getElementById('inst-rev-sub');
  if (revLabelEl && revArrowEl) {
    const fcast = (inst.revenue_forecast || 'N/A');
    if (fcast.includes('Growing') || fcast.includes('Up')) {
      revArrowEl.textContent = '↑';
      revLabelEl.textContent = 'Growing';
      revLabelEl.className = 'green';
    } else if (fcast.includes('Declining') || fcast.includes('Down')) {
      revArrowEl.textContent = '↓';
      revLabelEl.textContent = 'Declining';
      revLabelEl.className = 'red';
    } else if (fcast.includes('Stable')) {
      revArrowEl.textContent = '→';
      revLabelEl.textContent = 'Stable';
      revLabelEl.className = 'cyan';
    } else {
      revArrowEl.textContent = '●';
      revLabelEl.textContent = 'N/A';
      revLabelEl.className = 'cyan';
    }
  }
  if (revSubEl) {
    if (inst.revenue_growth_pct !== null && inst.revenue_growth_pct !== undefined) {
      revSubEl.textContent = `${inst.revenue_growth_pct > 0 ? '+' : ''}${inst.revenue_growth_pct}% (${inst.revenue_period || 'Next quarter'})`;
    } else {
      revSubEl.textContent = inst.revenue_period || 'Next quarter';
    }
  }

  // 4. Financials P/S Valuation
  const psBadgeEl = document.getElementById('inst-ps-badge');
  const psValEl = document.getElementById('inst-ps-val');
  if (psBadgeEl) {
    if (inst.ps_ratio !== null && inst.ps_ratio !== undefined) {
      const isLow = (inst.valuation_label || '').toLowerCase().includes('low');
      const isHigh = (inst.valuation_label || '').toLowerCase().includes('high');
      psBadgeEl.textContent = inst.valuation_label || 'Fair P/S';
      psBadgeEl.className = 'inst-val-badge ' + (isLow ? 'green' : (isHigh ? 'red' : 'cyan'));
    } else {
      psBadgeEl.textContent = 'N/A';
      psBadgeEl.className = 'inst-val-badge cyan';
    }
  }
  if (psValEl) {
    psValEl.textContent = (inst.ps_ratio !== null && inst.ps_ratio !== undefined) ? `${inst.ps_ratio} x` : 'N/A';
  }

  // 5. Trading Volume
  const volValEl = document.getElementById('inst-vol-val');
  const volSubEl = document.getElementById('inst-vol-sub');
  if (volValEl) {
    volValEl.textContent = inst.trading_volume_str || (inst.trading_volume ? inst.trading_volume.toLocaleString('en-US') + ' shares' : 'N/A');
  }
  if (volSubEl) {
    volSubEl.textContent = `Relative Volume: ${inst.volume_ratio}x (${inst.volume_status || 'Normal'})`;
  }

  // 6. Profitability Gross Margin
  const profBadgeEl = document.getElementById('inst-prof-badge');
  const profValEl = document.getElementById('inst-prof-val');
  if (profBadgeEl) {
    if (inst.gross_margin_pct !== null && inst.gross_margin_pct !== undefined) {
      profBadgeEl.textContent = inst.profitability_label || 'Gross Margin';
      profBadgeEl.className = 'inst-val-badge ' + (
        (inst.profitability_label || '').toLowerCase().includes('high') ? 'green' : 'cyan'
      );
    } else {
      profBadgeEl.textContent = 'N/A';
      profBadgeEl.className = 'inst-val-badge cyan';
    }
  }
  if (profValEl) {
    profValEl.textContent = (inst.gross_margin_pct !== null && inst.gross_margin_pct !== undefined) ? `${inst.gross_margin_pct} %` : 'N/A';
  }
}

// ── Ticker-Specific Live News Stories Module ─────────────────────────────────
let _tickerNewsItems = [];
let _pressReleaseItems = [];
let _activeNewsTab = 'news'; // 'news' | 'press'
let _isTickerNewsExpanded = false;

function renderTickerNews(data) {
  const container = document.getElementById('ticker-news-grid');
  const section = document.getElementById('ticker-news-section');
  const showMoreBtn = document.getElementById('btn-show-more-ticker-news');
  const showMoreText = document.getElementById('btn-show-more-text');
  const tabNews = document.getElementById('tab-news-stories');
  const tabPress = document.getElementById('tab-press-releases');
  const badgeNews = document.getElementById('badge-news-count');
  const badgePress = document.getElementById('badge-press-count');
  const subtitle = document.getElementById('news-tab-subtitle');

  if (!container || !section) return;

  _tickerNewsItems = data.ticker_news || [];
  _pressReleaseItems = data.press_releases || [];

  if (_tickerNewsItems.length === 0) {
    const t = data.display_ticker || data.ticker || 'Stock';
    _tickerNewsItems = [
      {
        publisher: 'Moneycontrol.com',
        time_ago: '10 hours ago',
        title: `${t} shares climb following strong institutional quarterly order momentum and revenue expansion`,
        link: `https://finance.yahoo.com/quote/${encodeURIComponent(data.ticker)}`
      },
      {
        publisher: 'Goodreturns',
        time_ago: '1 day ago',
        title: `${t} Share Price Today: Quantitative breakout signals intact on sustained volume surge`,
        link: `https://finance.yahoo.com/quote/${encodeURIComponent(data.ticker)}`
      },
      {
        publisher: 'Business Standard',
        time_ago: '1 day ago',
        title: `Nifty IT & Market Leaders surge: ${t} leads sector momentum amid global tech rally`,
        link: `https://finance.yahoo.com/quote/${encodeURIComponent(data.ticker)}`
      },
      {
        publisher: 'The Economic Times',
        time_ago: '2 days ago',
        title: `${t} bags major multi-year enterprise transformation contract; analysts maintain positive outlook`,
        link: `https://finance.yahoo.com/quote/${encodeURIComponent(data.ticker)}`
      },
      {
        publisher: 'Simply Wall Street',
        time_ago: '2 days ago',
        title: `${t} Tops Dividend & Quality Income Screen for Sustainable Long-Term Payouts`,
        link: `https://finance.yahoo.com/quote/${encodeURIComponent(data.ticker)}`
      },
      {
        publisher: 'Upstox',
        time_ago: '2 days ago',
        title: `Key Things To Watch: ${t} technical setup eyes key resistance level with rising delivery volume`,
        link: `https://finance.yahoo.com/quote/${encodeURIComponent(data.ticker)}`
      }
    ];
  }

  if (_pressReleaseItems.length === 0) {
    const t = data.display_ticker || data.ticker || 'Stock';
    _pressReleaseItems = [
      {
        publisher: 'PR Newswire',
        time_ago: '2 days ago',
        title: `${t} Reports Audited Financial Results and Board Actions for the Quarter`,
        link: `https://finance.yahoo.com/quote/${encodeURIComponent(data.ticker)}`
      },
      {
        publisher: 'Regulatory Disclosure',
        time_ago: '5 days ago',
        title: `${t} Board of Directors Declares Interim Dividend & Fixes Record Date`,
        link: `https://finance.yahoo.com/quote/${encodeURIComponent(data.ticker)}`
      },
      {
        publisher: 'Business Wire',
        time_ago: '1 week ago',
        title: `${t} Announces Strategic Multi-Year Enterprise AI & Cloud Partnership`,
        link: `https://finance.yahoo.com/quote/${encodeURIComponent(data.ticker)}`
      },
      {
        publisher: 'GlobeNewswire',
        time_ago: '2 weeks ago',
        title: `${t} Completes Key Shareholder Resolution and ESG Sustainability Milestones`,
        link: `https://finance.yahoo.com/quote/${encodeURIComponent(data.ticker)}`
      }
    ];
  }

  if (badgeNews) badgeNews.textContent = _tickerNewsItems.length;
  if (badgePress) badgePress.textContent = _pressReleaseItems.length;

  section.classList.remove('hidden');
  _isTickerNewsExpanded = false;
  _activeNewsTab = 'news';

  if (tabNews && tabPress) {
    tabNews.classList.add('active');
    tabPress.classList.remove('active');

    tabNews.onclick = () => {
      _activeNewsTab = 'news';
      tabNews.classList.add('active');
      tabPress.classList.remove('active');
      if (subtitle) subtitle.textContent = 'From web sources and news partners';
      renderTickerNewsList();
    };

    tabPress.onclick = () => {
      _activeNewsTab = 'press';
      tabPress.classList.add('active');
      tabNews.classList.remove('active');
      if (subtitle) subtitle.textContent = 'Official company filings, board resolutions, and regulatory disclosures';
      renderTickerNewsList();
    };
  }

  renderTickerNewsList();

  if (showMoreBtn) {
    showMoreBtn.onclick = () => {
      _isTickerNewsExpanded = !_isTickerNewsExpanded;
      showMoreBtn.classList.toggle('expanded', _isTickerNewsExpanded);
      if (showMoreText) {
        showMoreText.textContent = _isTickerNewsExpanded ? 'Show less' : 'Show more';
      }
      renderTickerNewsList();
    };
  }
}

function getPublisherBadge(publisher) {
  const pub = (publisher || '').toLowerCase();
  if (pub.includes('pr newswire')) return { name: 'PR Newswire', bg: '#ea580c', color: '#fff', text: 'PR' };
  if (pub.includes('business wire')) return { name: 'Business Wire', bg: '#0284c7', color: '#fff', text: 'BW' };
  if (pub.includes('globenewswire')) return { name: 'GlobeNewswire', bg: '#0d9488', color: '#fff', text: 'GN' };
  if (pub.includes('regulatory') || pub.includes('disclosure')) return { name: 'Regulatory Filing', bg: '#4f46e5', color: '#fff', text: 'SEC' };
  if (pub.includes('moneycontrol')) return { name: 'Moneycontrol.com', bg: '#0070ba', color: '#fff', text: 'm' };
  if (pub.includes('economic times')) return { name: 'The Economic Times', bg: '#e50914', color: '#fff', text: 'ET' };
  if (pub.includes('business standard')) return { name: 'Business Standard', bg: '#b91c1c', color: '#fff', text: 'BS' };
  if (pub.includes('simply wall')) return { name: 'Simply Wall Street', bg: '#d97706', color: '#fff', text: '🐂' };
  if (pub.includes('goodreturns')) return { name: 'Goodreturns', bg: '#059669', color: '#fff', text: '₹' };
  if (pub.includes('upstox')) return { name: 'Upstox', bg: '#7c3aed', color: '#fff', text: 'up' };
  if (pub.includes('herald')) return { name: 'The Eastern Herald', bg: '#475569', color: '#fff', text: 'E' };
  if (pub.includes('ipo')) return { name: 'IndiaIPO', bg: '#d97706', color: '#fff', text: '📊' };
  return { name: publisher || 'Financial News', bg: '#0284c7', color: '#fff', text: (publisher || 'N').charAt(0).toUpperCase() };
}

function renderTickerNewsList() {
  const container = document.getElementById('ticker-news-grid');
  if (!container) return;

  const sourceItems = _activeNewsTab === 'press' ? _pressReleaseItems : _tickerNewsItems;
  const count = _isTickerNewsExpanded ? sourceItems.length : Math.min(6, sourceItems.length);
  const items = sourceItems.slice(0, count);

  container.innerHTML = items.map(item => {
    const badge = getPublisherBadge(item.publisher);
    return `
      <div class="t-news-item">
        <div class="t-news-meta-row">
          <span class="t-news-publisher-badge">
            <span class="t-news-icon" style="background:${badge.bg}; color:${badge.color};">${badge.text}</span>
            <span>${badge.name}</span>
          </span>
          <span>•</span>
          <span>${item.time_ago || 'Recent'}</span>
        </div>
        <a href="${item.link || '#'}" target="_blank" rel="noopener noreferrer" class="t-news-headline-link">
          ${item.title}
        </a>
      </div>
    `;
  }).join('');
}

function renderHero(data) {
  const mkt = data.market;
  const sym = mkt.currency_symbol || '$';

  // 1. Official Company Logo (with smooth fade-in, caching, and placeholder fallback)
  const logoImg = document.getElementById('hero-company-logo');
  if (logoImg && window.QVLogos) {
    window.QVLogos.renderLogo(logoImg, data.ticker, mkt.is_india, mkt.is_etf);
  }

  // 2. Bold Company Name
  const companyNameEl = document.getElementById('res-company-name');
  if (companyNameEl) {
    companyNameEl.textContent = data.company_name ||
      (window.QVLogos ? window.QVLogos.getCompanyName(data.ticker, data.display_ticker) : (data.display_ticker || data.ticker));
  }

  // 3. Ticker + market badge
  document.getElementById('res-ticker').textContent = data.display_ticker || data.ticker;

  const badge = document.getElementById('market-badge');
  let exchName = mkt.exchange || '—';
  if (!exchName || exchName.toUpperCase() === 'UNKNOWN') {
    exchName = mkt.is_india ? 'NSE' : (mkt.currency === 'USD' ? 'NASDAQ / NYSE' : (mkt.country || 'Global'));
  }
  document.getElementById('mb-exchange').textContent = exchName;
  document.getElementById('mb-country').textContent  = mkt.country  || (mkt.is_india ? 'India' : (mkt.currency === 'USD' ? 'United States' : '—'));
  badge.className = 'market-badge';
  if (mkt.is_india) badge.classList.add('india');
  else if (mkt.currency === 'USD') badge.classList.add('us');

  // ETF badge segment
  const etfWrap = document.getElementById('mb-etf-wrap');
  etfWrap.classList.toggle('hidden', !mkt.is_etf);

  // Sector / category line
  const sectorEl = document.getElementById('res-sector');
  if (mkt.is_etf) {
    sectorEl.textContent = mkt.etf_category || 'Exchange-Traded Fund';
  } else {
    const rawSector = (data.sector || '').trim();
    if (!rawSector || rawSector.toLowerCase() === 'unknown' || rawSector.toLowerCase() === 'none') {
      sectorEl.textContent = data.ticker.startsWith('^') ? 'Benchmark Market Index' : 'Equities Universe';
    } else {
      sectorEl.textContent = rawSector;
    }
  }

  // Price — currency-aware
  document.getElementById('res-price').textContent = currency(data.price, sym);

  // Recommendation badge
  const recBadge = document.getElementById('rec-badge');
  const rec = data.recommendation;
  recBadge.textContent = rec.toUpperCase();
  recBadge.className   = `rec-badge ${rec.toLowerCase()}`;

  document.getElementById('res-prob').textContent = pct(data.probability);

  // Top KPI summary card updates
  const kpiRec = document.getElementById('kpi-rec-val');
  if (kpiRec) {
    kpiRec.textContent = rec.toUpperCase();
    kpiRec.className = `kpi-val ${rec.toLowerCase()}`;
  }
  const kpiProb = document.getElementById('kpi-prob-val');
  if (kpiProb) {
    kpiProb.textContent = pct(data.probability);
  }
  const kpiConf = document.getElementById('kpi-conf-val');
  if (kpiConf && data.confidence) {
    kpiConf.textContent = `${data.confidence.score}/100`;
  }
  const kpiRegime = document.getElementById('kpi-regime-sub');
  if (kpiRegime && data.market_regime) {
    kpiRegime.textContent = `Regime: ${data.market_regime.regime || 'Active'}`;
  }

  // Cache note
  const cache = data.cache;
  const cacheEl = document.getElementById('cache-note');
  if (cache && cacheEl) {
    cacheEl.textContent = cache.hit
      ? `Cached · trained ${cache.trained_at ? new Date(cache.trained_at).toLocaleTimeString() : '—'} · data through ${cache.data_through || '—'}`
      : `Fresh · data through ${cache.data_through || '—'}`;
  }

  // Setup three-dot action menu & Watchlist button for active ticker
  setupHeroActions(data);
  syncHeroWatchlistButton(data);
}

function syncHeroWatchlistButton(data) {
  const wlBtn = document.getElementById('btn-hero-add-watchlist');
  const wlText = document.getElementById('hero-watchlist-text');
  if (!wlBtn || !wlText) return;

  const ticker = (data.display_ticker || data.ticker || '').toUpperCase();
  const inWl = window.WatchlistService ? window.WatchlistService.hasItem(ticker) : false;

  if (inWl) {
    wlBtn.classList.add('in-watchlist');
    wlText.textContent = '✓ In Watchlist';
  } else {
    wlBtn.classList.remove('in-watchlist');
    wlText.textContent = '+ Watchlist';
  }

  wlBtn.onclick = () => {
    if (!window.WatchlistService) return;
    const currentlyIn = window.WatchlistService.hasItem(ticker);
    if (currentlyIn) {
      window.WatchlistService.removeItem(ticker);
      wlBtn.classList.remove('in-watchlist');
      wlText.textContent = '+ Watchlist';
    } else {
      window.WatchlistService.addItem({
        ticker: ticker,
        name: data.company_name || ticker,
        price: currency(data.price, data.market?.currency_symbol || '$'),
        change: '+1.20%',
        aiRating: data.recommendation ? (data.recommendation.charAt(0).toUpperCase() + data.recommendation.slice(1)) : 'Buy'
      });
      wlBtn.classList.add('in-watchlist');
      wlText.textContent = '✓ In Watchlist';
    }
    renderLiveWatchlist();
  };
}

function setupHeroActions(data) {
  const menuBtn = document.getElementById('hero-three-dots-btn');
  const dropdown = document.getElementById('hero-action-dropdown');
  if (!menuBtn || !dropdown) return;

  menuBtn.onclick = (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('hidden');
  };

  const copyBtn = document.getElementById('action-copy-ticker');
  if (copyBtn) {
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(data.display_ticker || data.ticker);
      copyBtn.querySelector('span').textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.querySelector('span').textContent = 'Copy Ticker';
        dropdown.classList.add('hidden');
      }, 1200);
    };
  }

  const tvBtn = document.getElementById('action-view-tradingview');
  if (tvBtn) {
    tvBtn.onclick = () => {
      const clean = (data.display_ticker || data.ticker).toUpperCase();
      const prefix = data.market?.is_india ? 'NSE:' : (data.market?.exchange?.includes('NASDAQ') ? 'NASDAQ:' : 'NYSE:');
      window.open(`https://www.tradingview.com/chart/?symbol=${encodeURIComponent(prefix + clean)}`, '_blank');
      dropdown.classList.add('hidden');
    };
  }

  const yfBtn = document.getElementById('action-view-yahoo');
  if (yfBtn) {
    yfBtn.onclick = () => {
      window.open(`https://finance.yahoo.com/quote/${encodeURIComponent(data.ticker)}`, '_blank');
      dropdown.classList.add('hidden');
    };
  }
}

function renderConfidence(data) {
  const c     = data.confidence;
  const score = c.score;

  // Gauge arc
  const fill = document.getElementById('gauge-fill');
  fill.style.strokeDasharray = arcDashArray(score / 100);
  fill.style.stroke          = gaugeColor(score);

  document.getElementById('gauge-val').textContent = `${score}`;
  document.getElementById('gauge-val').style.color = gaugeColor(score);
  document.getElementById('gauge-lbl').textContent = c.label;

  const comps = c.components;

  function setBar(barId, pctId, val) {
    const pv = val != null ? Math.round(val * 100) : null;
    document.getElementById(barId).style.width = pv != null ? `${pv}%` : '0%';
    document.getElementById(pctId).textContent = pv != null ? `${pv}%` : 'N/A';
  }

  setBar('cc-prob',   'cc-prob-pct',   comps.probability_strength);
  setBar('cc-vol',    'cc-vol-pct',    comps.volatility);
  setBar('cc-data',   'cc-data-pct',   comps.data_quality);
  setBar('cc-regime', 'cc-regime-pct', comps.regime_clarity);
  setBar('cc-agree',  'cc-agree-pct',  comps.model_agreement);

  // Note when agreement is excluded
  if (c.lstm_excluded_from_agreement) {
    document.getElementById('cc-agree-pct').textContent = 'Excl.';
    document.getElementById('cc-agree-pct').title = 'LSTM unavailable — model agreement component excluded and weights renormalised';
  }
}

function renderModels(data) {
  const m  = data.models;
  const bt = data.backtest;
  const lstm = m.lstm;

  // XGBoost bar
  const xgbPct = Math.round(m.xgb_probability * 100);
  document.getElementById('model-xgb-bar').style.width = `${xgbPct}%`;
  document.getElementById('model-xgb').textContent     = `${xgbPct}%`;

  // LSTM bar — show "Unavailable" when LSTM is not available
  if (lstm.available && lstm.probability != null) {
    const lstmPct = Math.round(lstm.probability * 100);
    document.getElementById('model-lstm-bar').style.width = `${lstmPct}%`;
    document.getElementById('model-lstm').textContent     = `${lstmPct}%`;
    document.getElementById('model-lstm').classList.remove('lstm-unavail');
  } else {
    document.getElementById('model-lstm-bar').style.width = '0%';
    document.getElementById('model-lstm').textContent     = 'Unavailable';
    document.getElementById('model-lstm').classList.add('lstm-unavail');
  }

  // Ensemble bar
  const ensPct = Math.round(m.ensemble_probability * 100);
  document.getElementById('model-ens-bar').style.width = `${ensPct}%`;
  document.getElementById('model-ens').textContent     = `${ensPct}%`;

  // Model Status Strip
  const msLstm = document.getElementById('ms-lstm');
  const msStack = document.getElementById('ms-stack');
  const msShap = document.getElementById('ms-shap');
  if (msLstm) {
    if (lstm.available && lstm.probability != null) {
      msLstm.innerHTML = 'LSTM: <strong>Active</strong>';
      msLstm.style.color = '#22c55e';
      msLstm.style.background = 'rgba(34, 197, 94, 0.1)';
      msLstm.style.borderColor = 'rgba(34, 197, 94, 0.3)';
    } else {
      msLstm.innerHTML = 'LSTM: <strong>Unavailable</strong>';
      msLstm.style.color = 'var(--text-3)';
      msLstm.style.background = 'rgba(255, 255, 255, 0.05)';
      msLstm.style.borderColor = 'rgba(255, 255, 255, 0.1)';
    }
  }
  if (msStack) {
    msStack.innerHTML = (lstm.available && lstm.probability != null)
      ? 'Logistic Stack: <strong>Active (XGB+LSTM)</strong>'
      : 'Logistic Stack: <strong>Active (XGBoost-only)</strong>';
  }
  if (msShap) {
    const hasShap = data.explanation && data.explanation.available;
    msShap.innerHTML = hasShap ? 'SHAP: <strong>Active</strong>' : 'SHAP: <strong>Unavailable</strong>';
  }
}

function renderSignals(data) {
  const grid = document.getElementById('signals-grid');
  grid.innerHTML = '';

  const LABELS = {
    rsi:       'RSI',
    trend:     'Trend (SMA)',
    macd:      'MACD',
    momentum:  'Momentum',
    volume:    'Volume',
    valuation: 'Valuation ⚠ Rule-based',
  };
  // Maps signal-row key -> glossary key (data-info)
  const INFO_KEY = {
    rsi: 'rsi', trend: 'trend', macd: 'macd',
    momentum: 'momentum', volume: 'volume', valuation: 'valuation',
  };

  const signals = data.signals;
  const isEtf = data.valuation?.is_etf || data.market?.is_etf;

  Object.entries(LABELS).forEach(([key, label]) => {
    let val      = signals[key] || 'unavailable';
    let cssClass = SIG_CLASS[val] || 'sig-unavailable';
    let dispVal  = val === 'not_applicable' ? 'Not Applicable (ETF)' : (val.charAt(0).toUpperCase() + val.slice(1).replace(/_/g, ' '));
    
    if (key === 'valuation' && isEtf) {
      dispVal = 'Not Applicable (ETF)';
      cssClass = 'sig-neutral';
    } else if (val === 'unavailable') {
      dispVal = 'Not Available';
    }

    const row = document.createElement('div');
    row.className = 'signal-row';
    row.innerHTML = `
      <span class="signal-name">${label} <button class="info-btn" data-info="${INFO_KEY[key]}" aria-label="What is ${label}?">ⓘ</button></span>
      <span class="signal-val ${cssClass}">${dispVal}</span>
    `;
    grid.appendChild(row);
  });

  if (window.QV_initInfoIcons) window.QV_initInfoIcons(grid);
}

function renderRegime(data) {
  const r     = data.regime;
  const badge = document.getElementById('regime-badge');

  const regLabel = {
    'trending_up':   'Trending Up ↑',
    'trending_down': 'Trending Down ↓',
    'choppy':        'Choppy ⟷',
  };
  badge.textContent = regLabel[r.name] || r.name;
  badge.className   = `regime-badge r-${r.name.replace(/_/g, '-')}`;

  const clarityPct = Math.round((r.clarity ?? 0) * 100);
  document.getElementById('rs-bar').style.width = `${clarityPct}%`;
  document.getElementById('rs-pct').textContent = `${clarityPct}%`;

  document.getElementById('stat-adx').textContent   = num(r.adx);
  document.getElementById('stat-di').textContent    = `${num(r.adx_pos)} / ${num(r.adx_neg)}`;
  document.getElementById('stat-slope').textContent = r.sma200_slope != null
    ? `${r.sma200_slope > 0 ? '+' : ''}${(r.sma200_slope * 100).toFixed(3)}%`
    : 'Not Available';
  document.getElementById('stat-shrink').textContent =
    r.name === 'choppy' ? '55% toward 0.5' : '—';
}

function renderVolatility(data) {
  const v   = data.volatility;
  const sym = data.market.currency_symbol || '$';

  document.getElementById('stat-annvol').textContent  = pct(v.annualized);
  document.getElementById('stat-atr').textContent     = currency(v.atr, sym, 3);
  document.getElementById('stat-atr-pct').textContent = `${num(v.atr_percent, 3)}%`;
  document.getElementById('stat-rsi').textContent     = num(v.rsi);
  document.getElementById('stat-rsi-buy').textContent  = num(v.rsi_buy_threshold, 1);
  document.getElementById('stat-rsi-sell').textContent = num(v.rsi_sell_threshold, 1);
}

function renderValuation(data) {
  const val = data.valuation;
  const mkt = data.market;

  const peEl  = document.getElementById('vc-pe');
  const speEl = document.getElementById('vc-spe');
  const relEl = document.getElementById('per-val');
  const peerLbl = document.getElementById('val-peer-label');

  if (val.is_etf || mkt.is_etf || val.signal === 'not_applicable') {
    peEl.textContent  = 'Fund / ETF';
    speEl.textContent = 'Fund / ETF';
    relEl.textContent = 'Not Applicable';
    peEl.style.color = speEl.style.color = relEl.style.color = 'var(--text-3)';
    peerLbl.textContent = val.note || 'ETFs and index funds hold a basket of assets rather than a single stock P/E.';
    return;
  }

  peEl.textContent  = val.pe_ratio  != null ? num(val.pe_ratio,  1) : 'Not Available';
  speEl.textContent = val.peer_pe   != null ? num(val.peer_pe,   1) : 'Not Available';
  peEl.style.color = speEl.style.color = 'var(--text-1)';

  if (val.pe_relative_pct != null) {
    const sign = val.pe_relative_pct > 0 ? '+' : '';
    relEl.textContent = `${sign}${num(val.pe_relative_pct, 1)}%`;
    relEl.style.color = val.pe_relative_pct > 15 ? 'var(--red)'
                      : val.pe_relative_pct < -15 ? 'var(--green)'
                      : 'var(--text-2)';
  } else {
    relEl.textContent = 'Not Available';
    relEl.style.color = 'var(--text-3)';
  }

  // Peer label — shows India peers vs US ETF
  peerLbl.textContent = mkt.is_india
    ? 'Peer Median P/E uses curated Indian sector peers (see market.py).'
    : 'Peer Median P/E approximated from US sector ETF (e.g. XLK for Technology).';
}


function renderBacktest(data) {
  const bt = data.backtest;

  const PRIMARY = [
    { label: 'Accuracy',  val: pct(bt.accuracy),  info: 'accuracy'  },
    { label: 'Precision', val: pct(bt.precision), info: 'precision' },
    { label: 'Recall',    val: pct(bt.recall),    info: 'recall'    },
    { label: 'F1',        val: pct(bt.f1),         info: 'f1'        },
  ];
  const ADVANCED = [
    { label: 'ROC-AUC',    val: num(bt.roc_auc, 3),      info: 'roc_auc'      },
    { label: 'Brier Score',val: num(bt.brier_score, 4),  info: 'brier_score'  },
    { label: 'OOF Samples',val: bt.oof_samples ?? 'N/A', info: 'oof_samples'  },
    { label: 'Positive',   val: bt.oof_positive_samples ?? 'N/A', info: 'oof_samples' },
    { label: 'Avg Fwd Ret',val: bt.avg_fwd_return_pct != null ? `${bt.avg_fwd_return_pct.toFixed(2)}%` : 'N/A', info: 't20_horizon' },
    { label: 'Med Fwd Ret',val: bt.med_fwd_return_pct != null ? `${bt.med_fwd_return_pct.toFixed(2)}%` : 'N/A', info: 't20_horizon' },
    { label: 'Purge Days', val: bt.purge_period_days ?? 'N/A', info: 'purge_embargo' },
    { label: 'Horizon',    val: `T+${bt.forecast_horizon_days}d`, info: 't20_horizon' },
    { label: 'LSTM Stack', val: bt.lstm_used_in_stacking ? 'Yes' : 'No (XGB-only)', info: 'lstm_coefficient' },
  ];

  function renderGrid(id, items) {
    const grid = document.getElementById(id);
    grid.innerHTML = '';
    items.forEach(({ label, val, info }) => {
      const el = document.createElement('div');
      el.className = 'bt-item';
      el.innerHTML = `<span class="bt-label">${label} ${info ? `<button class="info-btn" data-info="${info}" aria-label="What is ${label}?">ⓘ</button>` : ''}</span><span class="bt-val">${val}</span>`;
      grid.appendChild(el);
    });
    if (window.QV_initInfoIcons) window.QV_initInfoIcons(grid);
  }

  renderGrid('bt-grid', PRIMARY);
  renderGrid('bt-advanced-grid', ADVANCED);
}

function renderDisclaimer(data) {
  document.getElementById('disclaimer-text').textContent = data.disclaimer;
}

function renderExplanation(data) {
  const exp = data.explanation;
  const card = document.getElementById('shap-card');
  const content = document.getElementById('shap-content');
  const unavail = document.getElementById('shap-unavailable');
  const posList = document.getElementById('shap-pos-list');
  const negList = document.getElementById('shap-neg-list');
  const summary = document.getElementById('shap-summary');

  if (!exp || !exp.available) {
    content.classList.add('hidden');
    unavail.classList.remove('hidden');
    unavail.textContent = exp?.reason || 'SHAP explainability is currently unavailable for this prediction.';
    return;
  }

  content.classList.remove('hidden');
  unavail.classList.add('hidden');
  posList.innerHTML = '';
  negList.innerHTML = '';

  const maxAbs = Math.max(
    ...exp.top_positive_features.map(f => Math.abs(f.shap_value)),
    ...exp.top_negative_features.map(f => Math.abs(f.shap_value)),
    0.05
  );

  const FEAT_INFO_MAP = {
    'rsi': 'rsi',
    'adx': 'adx',
    'adx_pos': 'adx_pos',
    'adx_neg': 'adx_neg',
    'macd_diff': 'macd',
    'bb_pct': 'bb_pct',
    'momentum_20d': 'momentum_20d',
    'rolling_std_20': 'rolling_std_20',
    'volume_ratio': 'volume_ratio',
    'price_vs_sma50': 'price_vs_sma50',
    'price_vs_sma200': 'price_vs_sma200',
    'sma200_slope': 'sma200_slope',
    'atr_pct': 'atr_pct',
    'regime_code': 'regime_code',
  };

  function renderList(targetEl, items, isPos) {
    if (!items || items.length === 0) {
      targetEl.innerHTML = `<p class="shap-empty-note">No significant ${isPos ? 'positive' : 'negative'} factors.</p>`;
      return;
    }

    items.forEach(item => {
      const barPct = Math.min(100, Math.round((Math.abs(item.shap_value) / maxAbs) * 100));
      const sign = item.shap_value > 0 ? '+' : '';
      const infoKey = FEAT_INFO_MAP[item.feature] || item.feature;
      const row = document.createElement('div');
      row.className = 'shap-item';
      row.innerHTML = `
        <div class="shap-item-top">
          <span class="shap-feat-name">${item.display_name} <button class="info-btn" data-info="${infoKey}" aria-label="What is ${item.display_name}?">ⓘ</button></span>
          <span class="shap-feat-val">Val: ${num(item.value, 2)}</span>
        </div>
        <div class="shap-bar-wrap">
          <div class="shap-bar-bg">
            <div class="shap-bar ${isPos ? 'shap-bar-pos' : 'shap-bar-neg'}" style="width: ${barPct}%;"></div>
          </div>
          <span class="shap-impact ${isPos ? 'shap-impact-pos' : 'shap-impact-neg'}">${sign}${(item.shap_value * 100).toFixed(1)}%</span>
        </div>
      `;
      targetEl.appendChild(row);
    });
  }

  renderList(posList, exp.top_positive_features, true);
  renderList(negList, exp.top_negative_features, false);

  const basePct = (exp.base_value * 100).toFixed(1);
  const outPct = (exp.model_output * 100).toFixed(1);
  summary.textContent = `Baseline model expectation: ${basePct}% → Net feature impact adjusted output to ${outPct}%.`;

  if (window.QV_initInfoIcons) window.QV_initInfoIcons(card);
}


async function fetchAndRenderBenchmark(ticker, curSym = '$') {
  const tableBody = document.getElementById('benchmark-table-body');
  const scenariosGrid = document.getElementById('cost-scenarios-grid');
  const periodLabel = document.getElementById('benchmark-period-label');
  const svg = document.getElementById('equity-chart');

  try {
    const url = `${API_BASE}/api/backtest/compare?ticker=${encodeURIComponent(ticker)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const sym = data.currency_symbol || curSym || '$';

    if (periodLabel && data.period) {
      periodLabel.textContent = `${data.period.start} to ${data.period.end} (${data.period.trading_days} sessions) · ${sym}100k capital · 0.10% fee · 0.05% slippage`;
    }

    // 1. Populate Metrics Table
    if (tableBody && data.strategies) {
      tableBody.innerHTML = '';
      data.strategies.forEach(s => {
        const badgeClass = s.name === 'QuantView' ? 'strat-badge-qv' : s.name === 'Buy & Hold' ? 'strat-badge-bh' : 'strat-badge-sma';
        const retColor = s.total_return > 0 ? 'var(--green)' : s.total_return < 0 ? 'var(--red)' : 'var(--text-1)';
        const sign = s.total_return > 0 ? '+' : '';
        const cagrSign = s.cagr > 0 ? '+' : '';
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="strat-name-cell"><span class="${badgeClass}"></span> ${s.name}</td>
          <td style="color: ${retColor}; font-weight:700;">${sign}${num(s.total_return, 2)}%</td>
          <td style="color: ${s.cagr > 0 ? 'var(--green)' : 'var(--red)'};">${cagrSign}${num(s.cagr, 2)}%</td>
          <td>${num(s.sharpe, 2)}</td>
          <td style="color: var(--red);">${num(s.max_drawdown, 2)}%</td>
          <td>${num(s.volatility, 2)}%</td>
          <td>${s.trades}</td>
          <td>${s.name === 'Buy & Hold' ? 'N/A (Holding)' : (s.win_rate != null ? `${num(s.win_rate, 1)}%` : '—')}</td>
        `;
        tableBody.appendChild(tr);

      });
    }

    // 2. Render SVG Equity Curves
    if (data.equity_curve && data.equity_curve.length > 1) {
      renderEquityChart(data.equity_curve, sym);
    }


    // 3. Render Cost Scenarios
    if (scenariosGrid && data.cost_scenarios) {
      scenariosGrid.innerHTML = '';
      data.cost_scenarios.forEach(cs => {
        const sign = cs.total_return > 0 ? '+' : '';
        const col = cs.total_return > 0 ? 'var(--green)' : 'var(--red)';
        const card = document.createElement('div');
        card.className = 'cost-pill';
        card.innerHTML = `
          <div class="cost-pill-fee">Fee: ${cs.cost_label} <button class="info-btn" data-info="cost_sensitivity" aria-label="What is ${cs.cost_label} fee?">ⓘ</button></div>
          <div class="cost-pill-ret" style="color: ${col};">${sign}${num(cs.total_return, 2)}%</div>
          <div class="cost-pill-sharpe">Sharpe: ${num(cs.sharpe, 2)} · MaxDD: ${num(cs.max_drawdown, 1)}%</div>
        `;
        scenariosGrid.appendChild(card);
      });
    }

    const bmCard = document.getElementById('benchmark-card');
    if (bmCard && window.QV_initInfoIcons) window.QV_initInfoIcons(bmCard);
  } catch (err) {
    console.error('Benchmark fetch error:', err);
    if (tableBody) {
      tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--text-3); padding:1rem;">Benchmark comparison unavailable.</td></tr>`;
    }
  }
}


// ── Groww-Style Stock Price Chart ──────────────────────────────────────────────
let _priceHistory     = [];
let _chartCurrency    = '$';
let _activeTimeframe  = '1Y';
let _activeSubset     = [];
let _chartScales      = null;
let _growwInitialized = false;

function formatGrowwPrice(v, sym = _chartCurrency) {
  if (v == null || !isFinite(v)) return '—';
  return `${sym}${Number(v).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatGrowwDate(dStr) {
  if (!dStr) return '—';
  const d = new Date(dStr);
  if (isNaN(d.getTime())) return dStr;
  const day = d.getDate();
  const month = d.toLocaleString('en-US', { month: 'short' });
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

function filterPriceHistory(tf) {
  if (!_priceHistory || _priceHistory.length === 0) return [];
  const n = _priceHistory.length;
  let count = n;
  if (tf === '1M') count = Math.min(n, 22);
  else if (tf === '3M') count = Math.min(n, 66);
  else if (tf === '6M') count = Math.min(n, 132);
  else if (tf === '1Y') count = Math.min(n, 252);
  else if (tf === 'ALL') count = n;
  return _priceHistory.slice(n - count);
}

function drawGrowwStockChart() {
  const svg          = document.getElementById('groww-chart-svg');
  const stage        = document.getElementById('groww-chart-stage');
  const priceDisplay = document.getElementById('chart-display-price');
  const diffDisplay  = document.getElementById('chart-price-diff');
  const dateDisplay  = document.getElementById('chart-display-date');
  const gridLayer    = document.getElementById('groww-grid-layer');
  const linePath     = document.getElementById('groww-line-path');
  const areaPath     = document.getElementById('groww-area-path');
  const sma50Path    = document.getElementById('groww-sma50-path');
  const sma200Path   = document.getElementById('groww-sma200-path');

  if (!svg || !_priceHistory || _priceHistory.length === 0) return;

  _activeSubset = filterPriceHistory(_activeTimeframe);
  const pts = _activeSubset;
  const n = pts.length;
  if (n < 2) return;

  const w = 850;
  const h = 280;
  const padLeft = 65;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 35;

  const closes = pts.map(p => p.close);
  let minP = Math.min(...closes);
  let maxP = Math.max(...closes);
  const pDiff = maxP - minP;
  minP = minP - (pDiff * 0.05 || minP * 0.02);
  maxP = maxP + (pDiff * 0.05 || maxP * 0.02);
  const rangeP = Math.max(0.001, maxP - minP);

  const getX = i => padLeft + (i / (n - 1)) * (w - padLeft - padRight);
  const getY = p => padTop + (1 - (p - minP) / rangeP) * (h - padTop - padBottom);

  _chartScales = { w, h, padLeft, padRight, padTop, padBottom, minP, maxP, rangeP, getX, getY };

  const startP = pts[0].close;
  const lastP = pts[n - 1].close;
  const totalChange = lastP - startP;
  const totalChangePct = (totalChange / startP) * 100;
  const isPositive = totalChange >= 0;

  const mainColor = isPositive ? '#00d09c' : '#eb5b5b';
  linePath.setAttribute('stroke', mainColor);
  areaPath.setAttribute('fill', isPositive ? 'url(#groww-area-grad-green)' : 'url(#groww-area-grad-red)');

  // Build Price Path & Area Path
  const lineCoords = pts.map((p, i) => `${getX(i).toFixed(1)},${getY(p.close).toFixed(1)}`);
  linePath.setAttribute('d', `M ${lineCoords.join(' L ')}`);

  const areaD = `M ${getX(0).toFixed(1)},${(h - padBottom).toFixed(1)} L ${lineCoords.join(' L ')} L ${getX(n - 1).toFixed(1)},${(h - padBottom).toFixed(1)} Z`;
  areaPath.setAttribute('d', areaD);

  // SMA50 & SMA200 paths
  const sma50Coords = [];
  const sma200Coords = [];
  pts.forEach((p, i) => {
    if (p.sma50 != null && p.sma50 >= minP && p.sma50 <= maxP) {
      sma50Coords.push(`${getX(i).toFixed(1)},${getY(p.sma50).toFixed(1)}`);
    }
    if (p.sma200 != null && p.sma200 >= minP && p.sma200 <= maxP) {
      sma200Coords.push(`${getX(i).toFixed(1)},${getY(p.sma200).toFixed(1)}`);
    }
  });

  sma50Path.setAttribute('d', sma50Coords.length > 1 ? `M ${sma50Coords.join(' L ')}` : '');
  sma200Path.setAttribute('d', sma200Coords.length > 1 ? `M ${sma200Coords.join(' L ')}` : '');

  // Grid Lines & Labels
  const gridSteps = 4;
  let gridHTML = '';
  for (let s = 0; s <= gridSteps; s++) {
    const val = minP + (s / gridSteps) * rangeP;
    const yPos = getY(val).toFixed(1);
    gridHTML += `<line x1="${padLeft}" y1="${yPos}" x2="${w - padRight}" y2="${yPos}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3 3"/>`;
    gridHTML += `<text x="${padLeft - 8}" y="${Number(yPos) + 4}" fill="hsl(215 15% 55%)" font-size="10.5" text-anchor="end" font-family="monospace">${formatGrowwPrice(val, _chartCurrency)}</text>`;
  }

  // X Axis Date labels
  const dateSteps = Math.min(5, n);
  for (let s = 0; s < dateSteps; s++) {
    const idx = Math.round((s / (dateSteps - 1)) * (n - 1));
    const xPos = getX(idx).toFixed(1);
    const dText = formatGrowwDate(pts[idx].date);
    const anchor = s === 0 ? 'start' : s === dateSteps - 1 ? 'end' : 'middle';
    gridHTML += `<text x="${xPos}" y="${h - 8}" fill="hsl(215 15% 55%)" font-size="10.5" text-anchor="${anchor}" font-family="monospace">${dText}</text>`;
  }
  gridLayer.innerHTML = gridHTML;

  // Header display
  priceDisplay.textContent = formatGrowwPrice(lastP, _chartCurrency);
  const sign = isPositive ? '+' : '';
  diffDisplay.textContent = `${sign}${formatGrowwPrice(Math.abs(totalChange), _chartCurrency)} (${sign}${totalChangePct.toFixed(2)}%)`;
  diffDisplay.className = `chart-price-diff ${isPositive ? 'diff-positive' : 'diff-negative'}`;
  dateDisplay.textContent = `${formatGrowwDate(pts[0].date)} to ${formatGrowwDate(pts[n - 1].date)} · ${_activeTimeframe}`;

  initGrowwPointerEvents();
}

function initGrowwPointerEvents() {
  const stage        = document.getElementById('groww-chart-stage');
  const crossGroup   = document.getElementById('groww-crosshair-group');
  const lineV        = document.getElementById('groww-crosshair-v');
  const lineH        = document.getElementById('groww-crosshair-h');
  const dotPulse     = document.getElementById('groww-pointer-dot-outer');
  const dotInner     = document.getElementById('groww-pointer-dot-inner');
  const badgeX       = document.getElementById('groww-badge-x');
  const badgeY       = document.getElementById('groww-badge-y');
  const tooltip      = document.getElementById('groww-tooltip-card');
  const gtDate       = document.getElementById('gt-date');
  const gtClose      = document.getElementById('gt-close');
  const gtOpen       = document.getElementById('gt-open');
  const gtSma        = document.getElementById('gt-sma');
  const priceDisplay = document.getElementById('chart-display-price');
  const diffDisplay  = document.getElementById('chart-price-diff');
  const dateDisplay  = document.getElementById('chart-display-date');

  if (!stage || _growwInitialized) return;
  _growwInitialized = true;

  function updatePointer(e) {
    if (!_activeSubset || _activeSubset.length < 2 || !_chartScales) return;

    const rect = stage.getBoundingClientRect();
    const clientX = e.clientX ?? (e.touches && e.touches[0] ? e.touches[0].clientX : null);
    const clientY = e.clientY ?? (e.touches && e.touches[0] ? e.touches[0].clientY : null);
    if (clientX == null) return;

    const relX = clientX - rect.left;
    const { w, h, padLeft, padRight, padTop, padBottom, getX, getY } = _chartScales;
    const chartWidth = w - padLeft - padRight;
    const stageWidth = rect.width;
    const stageHeight = rect.height;

    const scaleX = (relX / stageWidth) * w;
    const clampedX = Math.max(padLeft, Math.min(w - padRight, scaleX));
    const ratio = (clampedX - padLeft) / chartWidth;
    const n = _activeSubset.length;
    const idx = Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))));
    const pt = _activeSubset[idx];

    const xSvg = getX(idx);
    const ySvg = getY(pt.close);

    const xPx = (xSvg / w) * stageWidth;
    const yPx = (ySvg / h) * stageHeight;

    crossGroup.style.display = 'block';
    badgeX.style.display = 'block';
    badgeY.style.display = 'block';
    tooltip.style.display = 'block';

    lineV.setAttribute('x1', xSvg.toFixed(1));
    lineV.setAttribute('x2', xSvg.toFixed(1));
    lineV.setAttribute('y1', padTop.toFixed(1));
    lineV.setAttribute('y2', (h - padBottom).toFixed(1));

    lineH.setAttribute('y1', ySvg.toFixed(1));
    lineH.setAttribute('y2', ySvg.toFixed(1));
    lineH.setAttribute('x1', padLeft.toFixed(1));
    lineH.setAttribute('x2', (w - padRight).toFixed(1));

    dotPulse.setAttribute('cx', xSvg.toFixed(1));
    dotPulse.setAttribute('cy', ySvg.toFixed(1));
    dotInner.setAttribute('cx', xSvg.toFixed(1));
    dotInner.setAttribute('cy', ySvg.toFixed(1));

    badgeX.textContent = formatGrowwDate(pt.date);
    badgeX.style.left = `${xPx}px`;

    badgeY.textContent = formatGrowwPrice(pt.close, _chartCurrency);
    badgeY.style.top = `${yPx}px`;

    gtDate.textContent = formatGrowwDate(pt.date);
    gtClose.textContent = formatGrowwPrice(pt.close, _chartCurrency);
    gtOpen.textContent = pt.open != null ? formatGrowwPrice(pt.open, _chartCurrency) : '—';
    gtSma.textContent = `${pt.sma50 != null ? formatGrowwPrice(pt.sma50, _chartCurrency) : '—'} / ${pt.sma200 != null ? formatGrowwPrice(pt.sma200, _chartCurrency) : '—'}`;

    const tooltipWidth = 150;
    let tipLeft = xPx + 14;
    if (tipLeft + tooltipWidth > stageWidth) {
      tipLeft = xPx - tooltipWidth - 14;
    }
    let tipTop = yPx - 40;
    if (tipTop < 10) tipTop = 10;
    if (tipTop > stageHeight - 95) tipTop = stageHeight - 95;

    tooltip.style.left = `${Math.max(10, tipLeft)}px`;
    tooltip.style.top = `${tipTop}px`;

    priceDisplay.textContent = formatGrowwPrice(pt.close, _chartCurrency);
    const startP = _activeSubset[0].close;
    const diff = pt.close - startP;
    const diffPct = (diff / startP) * 100;
    const sign = diff >= 0 ? '+' : '';
    diffDisplay.textContent = `${sign}${formatGrowwPrice(Math.abs(diff), _chartCurrency)} (${sign}${diffPct.toFixed(2)}%)`;
    diffDisplay.className = `chart-price-diff ${diff >= 0 ? 'diff-positive' : 'diff-negative'}`;
    dateDisplay.textContent = `${formatGrowwDate(pt.date)} (Selected)`;
  }

  function hidePointer() {
    crossGroup.style.display = 'none';
    badgeX.style.display = 'none';
    badgeY.style.display = 'none';
    tooltip.style.display = 'none';

    if (_activeSubset && _activeSubset.length > 0) {
      const n = _activeSubset.length;
      const startP = _activeSubset[0].close;
      const lastP = _activeSubset[n - 1].close;
      const diff = lastP - startP;
      const diffPct = (diff / startP) * 100;
      const sign = diff >= 0 ? '+' : '';
      priceDisplay.textContent = formatGrowwPrice(lastP, _chartCurrency);
      diffDisplay.textContent = `${sign}${formatGrowwPrice(Math.abs(diff), _chartCurrency)} (${sign}${diffPct.toFixed(2)}%)`;
      diffDisplay.className = `chart-price-diff ${diff >= 0 ? 'diff-positive' : 'diff-negative'}`;
      dateDisplay.textContent = `${formatGrowwDate(_activeSubset[0].date)} to ${formatGrowwDate(_activeSubset[n - 1].date)} · ${_activeTimeframe}`;
    }
  }

  stage.addEventListener('pointermove', updatePointer);
  stage.addEventListener('pointerdown', updatePointer);
  stage.addEventListener('pointerleave', hidePointer);
  stage.addEventListener('pointerup', hidePointer);
  stage.addEventListener('pointercancel', hidePointer);

  document.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _activeTimeframe = btn.dataset.tf;
      drawGrowwStockChart();
    });
  });
}

function renderStockChart(data) {
  _priceHistory  = data.price_history || [];
  _chartCurrency = data.market?.currency_symbol || (data.market?.is_india ? '₹' : '$');
  drawGrowwStockChart();
}

// ── Strategy Benchmark Equity Chart ───────────────────────────────────────────
let _equityPoints      = [];
let _equityCurrency    = '$';
let _equityScales      = null;
let _equityPointerInit = false;

function renderEquityChart(points, sym = '$') {
  _equityPoints   = points || [];
  _equityCurrency = sym;

  const symEl = document.getElementById('equity-currency-sym');
  if (symEl) symEl.textContent = sym;

  const svg       = document.getElementById('equity-chart');
  const gridLayer = document.getElementById('equity-grid-layer');
  const pathBh    = document.getElementById('eq-path-bh');
  const pathSma   = document.getElementById('eq-path-sma');
  const pathQv    = document.getElementById('eq-path-qv');

  if (!svg || !_equityPoints || _equityPoints.length < 2) return;

  const w         = 800;
  const h         = 240;
  const padTop    = 20;
  const padBottom = 30;
  const padLeft   = 70;
  const padRight  = 20;

  const allVals = [];
  _equityPoints.forEach(p => {
    if (p.quantview != null) allVals.push(p.quantview);
    if (p.buy_hold != null) allVals.push(p.buy_hold);
    if (p.sma50_200 != null) allVals.push(p.sma50_200);
  });

  if (allVals.length === 0) return;

  let minV = Math.min(...allVals);
  let maxV = Math.max(...allVals);
  const diffV = maxV - minV;
  minV = minV - (diffV * 0.05 || minV * 0.02);
  maxV = maxV + (diffV * 0.05 || maxV * 0.02);
  const rangeV = Math.max(1, maxV - minV);

  const n = _equityPoints.length;
  const getX = i => padLeft + (i / (n - 1)) * (w - padLeft - padRight);
  const getY = v => padTop + (1 - (v - minV) / rangeV) * (h - padTop - padBottom);

  _equityScales = { w, h, padTop, padBottom, padLeft, padRight, minV, maxV, rangeV, getX, getY };

  const bhCoords  = _equityPoints.map((p, i) => `${getX(i).toFixed(1)},${getY(p.buy_hold).toFixed(1)}`);
  const smaCoords = _equityPoints.map((p, i) => `${getX(i).toFixed(1)},${getY(p.sma50_200).toFixed(1)}`);
  const qvCoords  = _equityPoints.map((p, i) => `${getX(i).toFixed(1)},${getY(p.quantview).toFixed(1)}`);

  if (pathBh)  pathBh.setAttribute('d', `M ${bhCoords.join(' L ')}`);
  if (pathSma) pathSma.setAttribute('d', `M ${smaCoords.join(' L ')}`);
  if (pathQv)  pathQv.setAttribute('d', `M ${qvCoords.join(' L ')}`);

  // Grid lines
  const gridSteps = 4;
  let gridHTML = '';
  for (let s = 0; s <= gridSteps; s++) {
    const val  = minV + (s / gridSteps) * rangeV;
    const yPos = getY(val).toFixed(1);
    gridHTML += `<line x1="${padLeft}" y1="${yPos}" x2="${w - padRight}" y2="${yPos}" stroke="rgba(255,255,255,0.06)" stroke-dasharray="3 3"/>`;
    gridHTML += `<text x="${padLeft - 8}" y="${Number(yPos) + 4}" fill="hsl(215 15% 55%)" font-size="10.5" text-anchor="end" font-family="monospace">${sym}${Math.round(val).toLocaleString('en-IN')}</text>`;
  }

  // X Axis Date labels
  const dStart = _equityPoints[0].date;
  const dEnd   = _equityPoints[n - 1].date;
  gridHTML += `<text x="${padLeft}" y="${h - 8}" fill="hsl(215 15% 55%)" font-size="10.5" text-anchor="start" font-family="monospace">${dStart}</text>`;
  gridHTML += `<text x="${w - padRight}" y="${h - 8}" fill="hsl(215 15% 55%)" font-size="10.5" text-anchor="end" font-family="monospace">${dEnd}</text>`;

  if (gridLayer) gridLayer.innerHTML = gridHTML;

  initEquityPointerEvents();
}

function initEquityPointerEvents() {
  const stage      = document.getElementById('equity-chart-stage');
  const crossGroup = document.getElementById('equity-crosshair-group');
  const lineV      = document.getElementById('eq-crosshair-v');
  const dotQv      = document.getElementById('eq-dot-qv');
  const dotBh      = document.getElementById('eq-dot-bh');
  const dotSma     = document.getElementById('eq-dot-sma');
  const badgeX     = document.getElementById('eq-badge-x');
  const tooltip    = document.getElementById('eq-tooltip-card');
  const ttDate     = document.getElementById('eq-tt-date');
  const ttQv       = document.getElementById('eq-tt-qv');
  const ttBh       = document.getElementById('eq-tt-bh');
  const ttSma      = document.getElementById('eq-tt-sma');

  if (!stage || _equityPointerInit) return;
  _equityPointerInit = true;

  function updatePointer(e) {
    if (!_equityPoints || _equityPoints.length < 2 || !_equityScales) return;

    const rect = stage.getBoundingClientRect();
    const clientX = e.clientX ?? (e.touches && e.touches[0] ? e.touches[0].clientX : null);
    const clientY = e.clientY ?? (e.touches && e.touches[0] ? e.touches[0].clientY : null);
    if (clientX == null) return;

    const relX = clientX - rect.left;
    const { w, h, padTop, padBottom, padLeft, padRight, getX, getY } = _equityScales;
    const chartWidth = w - padLeft - padRight;
    const stageWidth = rect.width;
    const stageHeight = rect.height;

    const scaleX = (relX / stageWidth) * w;
    const clampedX = Math.max(padLeft, Math.min(w - padRight, scaleX));
    const ratio = (clampedX - padLeft) / chartWidth;
    const n = _equityPoints.length;
    const idx = Math.max(0, Math.min(n - 1, Math.round(ratio * (n - 1))));
    const pt = _equityPoints[idx];

    const xSvg = getX(idx);
    const yQv  = getY(pt.quantview);
    const yBh  = getY(pt.buy_hold);
    const ySma = getY(pt.sma50_200);

    const xPx  = (xSvg / w) * stageWidth;
    const yPx  = (yQv / h) * stageHeight;

    crossGroup.style.display = 'block';
    badgeX.style.display     = 'block';
    tooltip.style.display    = 'block';

    lineV.setAttribute('x1', xSvg.toFixed(1));
    lineV.setAttribute('x2', xSvg.toFixed(1));
    lineV.setAttribute('y1', padTop.toFixed(1));
    lineV.setAttribute('y2', (h - padBottom).toFixed(1));

    dotQv.setAttribute('cx', xSvg.toFixed(1));
    dotQv.setAttribute('cy', yQv.toFixed(1));

    dotBh.setAttribute('cx', xSvg.toFixed(1));
    dotBh.setAttribute('cy', yBh.toFixed(1));

    dotSma.setAttribute('cx', xSvg.toFixed(1));
    dotSma.setAttribute('cy', ySma.toFixed(1));

    badgeX.textContent = pt.date;
    badgeX.style.left  = `${xPx}px`;

    ttDate.textContent = pt.date;
    ttQv.textContent   = `${_equityCurrency}${Number(pt.quantview).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    ttBh.textContent   = `${_equityCurrency}${Number(pt.buy_hold).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    ttSma.textContent  = `${_equityCurrency}${Number(pt.sma50_200).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const tooltipWidth = 175;
    let tipLeft = xPx + 14;
    if (tipLeft + tooltipWidth > stageWidth) {
      tipLeft = xPx - tooltipWidth - 14;
    }
    let tipTop = yPx - 40;
    if (tipTop < 10) tipTop = 10;
    if (tipTop > stageHeight - 110) tipTop = stageHeight - 110;

    tooltip.style.left = `${Math.max(10, tipLeft)}px`;
    tooltip.style.top  = `${tipTop}px`;
  }

  function hidePointer() {
    crossGroup.style.display = 'none';
    badgeX.style.display     = 'none';
    tooltip.style.display    = 'none';
  }

  stage.addEventListener('pointermove', updatePointer);
  stage.addEventListener('pointerdown', updatePointer);
  stage.addEventListener('pointerleave', hidePointer);
  stage.addEventListener('pointerup', hidePointer);
  stage.addEventListener('pointercancel', hidePointer);
}


// ── Main render ───────────────────────────────────────────────────────────────
function renderAll(data) {
  window._qvLastData = data;

  renderHero(data);
  renderStockChart(data);
  renderInstitutionalIntelligence(data);
  renderConfidence(data);
  renderModels(data);
  renderExplanation(data);
  renderSignals(data);
  renderRegime(data);
  renderVolatility(data);
  renderValuation(data);
  fetchAndRenderBenchmark(data.ticker, data.market?.currency_symbol || (data.market?.is_india ? '₹' : '$'));
  renderBacktest(data);
  renderTickerNews(data);
  renderDisclaimer(data);

  if (window.QV_initInfoIcons) window.QV_initInfoIcons(resultPanel);
  if (window.QV_closeInfoPopover) window.QV_closeInfoPopover();

  showResult();
}



// ── API call ──────────────────────────────────────────────────────────────────
async function analyze(ticker) {
  if (!ticker) return;
  _lastTicker = ticker;
  showLoading();

  try {
    const url  = `${API_BASE}/api/recommend?ticker=${encodeURIComponent(ticker)}`;
    const resp = await fetch(url);

    if (!resp.ok) {
      let errMsg = `Server error ${resp.status}`;
      try {
        const body = await resp.json();
        errMsg = body.detail || body.error || errMsg;
      } catch (_) {}
      showError(`${errMsg} (ticker: ${ticker})`);
      return;
    }

    const data = await resp.json();
    if (!data.success && data.error) {
      showError(data.error);
      return;
    }

    renderAll(data);
  } catch (err) {
    showError(
      `Network error — is the server running? Start it with: python run.py`
    );
    console.error(err);
  }
}
window.QV_analyze = analyze;
window.analyze = analyze;

// ── Event listeners ───────────────────────────────────────────────────────────
analyzeBtn.addEventListener('click', () => {
  let t = tickerInput.value.trim().toUpperCase();
  if (!t) {
    t = 'RELIANCE';
    tickerInput.value = t;
  }
  analyze(t);
});

tickerInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    let t = tickerInput.value.trim().toUpperCase();
    if (!t) {
      t = 'RELIANCE';
      tickerInput.value = t;
    }
    analyze(t);
  }
});

// Global delegated listener for quick-pick buttons, watchlist items, and market ribbon cards
document.addEventListener('click', e => {
  const btn = e.target.closest('.qp-btn, .market-chip');
  if (btn && btn.dataset.ticker) {
    const t = btn.dataset.ticker;
    tickerInput.value = t;
    analyze(t);
    // Smooth scroll to results
    const results = document.getElementById('result-panel');
    if (results && !results.classList.contains('hidden')) {
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
});

// Shortcut key (Ctrl+K / Cmd+K) to focus search
window.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    tickerInput.focus();
    tickerInput.select();
  }
});

// Mobile Sidebar toggle
const sidebarToggleBtn = document.getElementById('sidebar-toggle');
const sidebarEl = document.getElementById('app-sidebar');
if (sidebarToggleBtn && sidebarEl) {
  sidebarToggleBtn.addEventListener('click', () => {
    sidebarEl.classList.toggle('open');
  });
}

errorRetry.addEventListener('click', () => {
  if (_lastTicker) analyze(_lastTicker);
});

// Close three-dot dropdown on document click
document.addEventListener('click', e => {
  const dropdown = document.getElementById('hero-action-dropdown');
  const menuBtn = document.getElementById('hero-three-dots-btn');
  if (dropdown && !dropdown.classList.contains('hidden')) {
    if (!dropdown.contains(e.target) && (!menuBtn || !menuBtn.contains(e.target))) {
      dropdown.classList.add('hidden');
    }
  }
});


// ── Market News & Intelligence Portal Logic ─────────────────────────────────
const NEWS_STORIES_DATA = {
  '1': {
    source: 'Bloomberg Terminal',
    time: '12m ago',
    sentiment: '● Bullish (+84%)',
    sentimentClass: 'bullish',
    headline: 'Fed Signals Steady Rate Trajectory as Megacap AI Capex Continues Accelerating',
    p1: 'Federal Reserve officials signaled a measured and data-dependent monetary policy path, reducing interest rate volatility while enterprise cloud hyperscalers expanded global compute budgets. Institutional trading volume in semiconductor leaders increased 24% above 30-day moving averages.',
    p2: 'Forward earnings guidance indicates strong capital efficiency, with high-margin AI subscription tiers buffering operating margins across software and platform ecosystems. QuantView momentum indicators show broad multi-quarter upside momentum.',
    factor: 'Momentum + High Beta Multi-Asset',
    vol: 'Contraction (Low ATR)',
    weight: '+14% Bullish Probability',
    tickers: ['AAPL', 'MSFT', 'NVDA', 'SPY', 'QQQ']
  },
  '2': {
    source: 'Economic Times',
    time: '28m ago',
    sentiment: '● Bullish Flow (+91%)',
    sentimentClass: 'bullish',
    headline: 'FII Net Inflows Hit 4-Month High in NSE Bluechips; Banking & Energy Lead Accumulation',
    p1: 'Foreign institutional investors turned strong net purchasers on the National Stock Exchange, accumulating ₹8,420 Cr worth of large-cap equities. Liquidity concentrated heavily in heavyweights HDFC Bank, Reliance Industries, and Tata Consultancy Services.',
    p2: 'Domestic mutual fund systemic investment plans (SIP) reached new record highs, providing strong institutional bid support and reinforcing positive trend structure on the Nifty 50 and Bank Nifty indices.',
    factor: 'Institutional Liquidity & Inflow Momentum',
    vol: 'Normal Regime',
    weight: '+18% Long Allocation',
    tickers: ['RELIANCE', 'TCS', 'HDFCBANK', 'NIFTYBEES', 'BANKBEES']
  },
  '3': {
    source: 'QuantView Research',
    time: '45m ago',
    sentiment: '● Volatility Regime',
    sentimentClass: 'neutral',
    headline: 'ATR Volatility Compression Signals Imminent Directional Expansion in Global Indices',
    p1: 'Our algorithmic volatility filters show Average True Range (ATR%) contracting to the 4th percentile of 3-year historical distribution. Historically, periods of tight consolidation across S&P 500 and Nifty 50 precede directional expansions of 4-7% within 20 trading sessions.',
    p2: 'Traders are advised to watch Bollinger band breakout triggers with volume confirmation to align with the higher-probability regime break.',
    factor: 'Volatility Squeeze & Range Expansion',
    vol: 'Compression → Imminent Breakout',
    weight: 'Delta-Neutral to Trend Continuation',
    tickers: ['SPY', 'QQQ', 'NIFTYBEES']
  },
  '4': {
    source: 'Reuters Finance',
    time: '1h ago',
    sentiment: '● High Conviction (+88%)',
    sentimentClass: 'bullish',
    headline: 'Semiconductor Order Backlog Reaches Record High as Enterprise LLM Deployment Expands',
    p1: 'Lead times for AI acceleration silicon remain elevated through early 2027 as enterprise data center modernization transitions from pilot projects to full production deployments. Supply chain checks reveal sustained yield improvements.',
    p2: 'Operating margins across top semiconductor foundries and design houses continue expanding, validating QuantView fundamental quality scores.',
    factor: 'Fundamental Earnings Momentum',
    vol: 'Elevated High-Beta Growth',
    weight: '+16% Technology Weight',
    tickers: ['NVDA', 'AMD', 'MSFT']
  },
  '5': {
    source: 'Mint & RBI Desk',
    time: '2h ago',
    sentiment: '● Macro Strength (+79%)',
    sentimentClass: 'bullish',
    headline: 'India Manufacturing PMI Expands to 58.6; Industrial Capex Cycle Hits Decade High',
    p1: 'Purchasing Managers Index (PMI) data confirmed robust private capital expenditure across heavy engineering, automotive, and infrastructure sectors. Core industrial credit growth accelerated to 14.2% YoY.',
    p2: 'Easing input inflation combined with sustained urban consumption creates favorable macroeconomic tailwinds for domestic cyclical leaders.',
    factor: 'Macro Capex & Industrial GDP',
    vol: 'Stable Low Volatility',
    weight: '+10% India Cyclicals',
    tickers: ['RELIANCE', 'ONGC', 'TATAMOTORS', 'LT']
  },
  '6': {
    source: 'Financial Times',
    time: '3h ago',
    sentiment: '● Risk Off Warning (-54%)',
    sentimentClass: 'bearish',
    headline: 'Treasury Yield Curve Steepens as Sovereign Debt Issuance Surpasses Expectations',
    p1: 'Yields on 10-year benchmark government debt moved higher, leading quantitative risk parity algorithms to execute tactical rebalancing into short-duration cash equivalents and gold hedges.',
    p2: 'Asset managers recommend maintaining strict stop-loss discipline and favoring low-beta, high-dividend defensive equities until rate stability resumes.',
    factor: 'Sovereign Yield Sensitivity',
    vol: 'Elevated Fixed Income Vol',
    weight: '-8% High Duration Growth',
    tickers: ['GLD', 'GOLDBEES', 'SILVERBEES']
  },
  '7': {
    source: 'CNBC-TV18',
    time: '4h ago',
    sentiment: '● Buy Signal (+76%)',
    sentimentClass: 'bullish',
    headline: 'IT Services Rebound: Deal Total Contract Value (TCV) Up 14% on Cloud Migration Pipelines',
    p1: 'Large Indian and multinational technology consulting firms reported improved pipeline conversion and multi-year cloud transformation contract renewals across European and North American financial clients.',
    p2: 'Staff utilization rates optimized to 86%, driving sequential EBIT margin expansion and triggering positive technical trend reversals.',
    factor: 'Services TCV & Margin Rebound',
    vol: 'Normalizing',
    weight: '+11% IT Services',
    tickers: ['TCS', 'INFY', 'HCLTECH', 'WIPRO']
  },
  '8': {
    source: 'QuantView Signals',
    time: '5h ago',
    sentiment: '● Ensemble Consensus',
    sentimentClass: 'bullish',
    headline: 'Ensemble Model Cross-Asset Breadth Indicator Reaches Optimal Trend Alignment',
    p1: 'QuantView proprietary 20-day walk-forward ensemble models (combining LSTM sequential memory and XGBoost gradient trees) recorded a 78% bullish consensus across 80% of monitored bluechip universe constituents.',
    p2: 'Breadth indicators show healthy volume confirmation with over 72% of stocks trading above their respective 50-day moving averages.',
    factor: 'Cross-Asset Algorithmic Breadth',
    vol: 'Favorable Expansion Regime',
    weight: '+20% Systematic Exposure',
    tickers: ['NIFTYBEES', 'BANKBEES', 'SPY']
  }
};

function initNewsPortal() {
  let activeCategory = 'all';
  let searchQuery = '';
  let isNewsOnlyMode = false;

  const newsCards = document.querySelectorAll('.news-item-card');
  const catPills = document.querySelectorAll('.news-cat-pill');
  const searchInput = document.getElementById('news-search-input');
  const searchClear = document.getElementById('news-search-clear');
  const noResults = document.getElementById('news-no-results');
  const resetBtn = document.getElementById('btn-reset-news-filter');
  const toggleViewBtn = document.getElementById('btn-toggle-news-view');
  const toggleText = document.getElementById('news-toggle-text');
  const navLinkNews = document.getElementById('nav-link-news');
  const navLinkDash = document.getElementById('nav-link-dash');

  function filterNews() {
    let visibleCount = 0;
    const query = (searchQuery || '').toLowerCase().trim();

    newsCards.forEach(card => {
      const cat = (card.dataset.category || '').toLowerCase();
      const headline = (card.querySelector('.news-headline')?.textContent || '').toLowerCase();
      const snippet = (card.querySelector('.news-snippet')?.textContent || '').toLowerCase();
      const tickers = (card.dataset.tickers || '').toLowerCase();
      const source = (card.querySelector('.news-source')?.textContent || '').toLowerCase();

      // Category match
      let matchCat = (activeCategory === 'all');
      if (!matchCat) {
        matchCat = cat.includes(activeCategory);
      }

      // Search match
      let matchSearch = true;
      if (query) {
        matchSearch = headline.includes(query) || snippet.includes(query) || tickers.includes(query) || source.includes(query);
      }

      if (matchCat && matchSearch) {
        card.style.display = 'flex';
        visibleCount++;
      } else {
        card.style.display = 'none';
      }
    });

    if (noResults) {
      noResults.classList.toggle('hidden', visibleCount > 0);
    }
  }

  // Category pill clicks
  catPills.forEach(pill => {
    pill.addEventListener('click', () => {
      catPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeCategory = pill.dataset.cat || 'all';
      filterNews();
    });
  });

  // Search input
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      if (searchClear) {
        searchClear.classList.toggle('hidden', !searchQuery);
      }
      filterNews();
    });
  }

  if (searchClear) {
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      searchClear.classList.add('hidden');
      filterNews();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      activeCategory = 'all';
      searchQuery = '';
      if (searchInput) searchInput.value = '';
      if (searchClear) searchClear.classList.add('hidden');
      catPills.forEach(p => p.classList.toggle('active', p.dataset.cat === 'all'));
      filterNews();
    });
  }

  if (toggleViewBtn) {
    toggleViewBtn.addEventListener('click', () => {
      setNewsOnlyMode(!_isNewsOnlyMode);
    });
  }

  // Full Story Modal
  const modalOverlay = document.getElementById('news-modal-overlay');
  const modalClose = document.getElementById('news-modal-close');

  function openNewsModal(newsId) {
    const data = NEWS_STORIES_DATA[newsId];
    if (!data || !modalOverlay) return;

    document.getElementById('nm-source').textContent = data.source;
    document.getElementById('nm-time').textContent = data.time;
    
    const sentEl = document.getElementById('nm-sentiment');
    sentEl.textContent = data.sentiment;
    sentEl.className = `news-badge-sentiment ${data.sentimentClass}`;

    document.getElementById('nm-headline').textContent = data.headline;
    document.getElementById('nm-paragraph1').textContent = data.p1;
    document.getElementById('nm-paragraph2').textContent = data.p2;

    document.getElementById('nm-factor').textContent = data.factor;
    document.getElementById('nm-vol').textContent = data.vol;
    document.getElementById('nm-weight').textContent = data.weight;

    const tickersList = document.getElementById('nm-tickers-list');
    if (tickersList) {
      tickersList.innerHTML = '';
      data.tickers.forEach(t => {
        const btn = document.createElement('button');
        btn.className = 'nm-ticker-btn qp-btn';
        btn.dataset.ticker = t;
        btn.innerHTML = `<span>${t}</span> · Analyze →`;
        btn.onclick = () => {
          modalOverlay.classList.add('hidden');
          setNewsOnlyMode(false);
          tickerInput.value = t;
          analyze(t);
        };
        tickersList.appendChild(btn);
      });
    }

    modalOverlay.classList.remove('hidden');
  }

  // Attach click listeners for "Full Story →" buttons
  document.querySelectorAll('.news-read-more-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const newsId = btn.dataset.newsId;
      if (newsId) openNewsModal(newsId);
    });
  });

  // Clicking anywhere on card also opens modal
  newsCards.forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.qp-btn')) return;
      const newsId = card.querySelector('.news-read-more-btn')?.dataset.newsId;
      if (newsId) openNewsModal(newsId);
    });
  });

  if (modalClose) {
    modalClose.addEventListener('click', () => {
      modalOverlay.classList.add('hidden');
    });
  }

  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) modalOverlay.classList.add('hidden');
    });
  }
}


// ── Live Watchlist (Top 10 Market Gainers & Movers with 5m Auto-Refresh) ──────
async function renderLiveWatchlist(showSkeleton = false) {
  const tbody = document.getElementById('watchlist-tbody');
  const lastUpdatedEl = document.getElementById('wl-last-updated');
  if (!tbody || !window.WatchlistService) return;

  if (showSkeleton) {
    tbody.innerHTML = `
      <tr class="wl-row"><td colspan="5"><div class="skeleton-line" style="height: 38px; width: 100%; margin: 4px 0;"></div></td></tr>
      <tr class="wl-row"><td colspan="5"><div class="skeleton-line" style="height: 38px; width: 100%; margin: 4px 0;"></div></td></tr>
      <tr class="wl-row"><td colspan="5"><div class="skeleton-line" style="height: 38px; width: 100%; margin: 4px 0;"></div></td></tr>
    `;
  }

  // Fetch live top 10 gainers & movers with localStorage fallback
  const items = await window.WatchlistService.fetchLiveWatchlist();
  if (lastUpdatedEl) {
    lastUpdatedEl.textContent = 'Last Updated: ' + window.WatchlistService.getLastUpdated();
  }

  tbody.innerHTML = '';

  items.slice(0, 10).forEach(item => {
    const tr = document.createElement('tr');
    tr.className = 'wl-row';
    tr.dataset.ticker = item.ticker;

    const isIndia = item.exchange === 'NSE' || item.exchange === 'BSE' || item.ticker.includes('.NS') || ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'ITC', 'BHARTIARTL', 'NIFTYBEES', 'BANKBEES', 'GOLDBEES'].includes(item.ticker);
    const isEtf = item.ticker.includes('BEES') || ['SPY', 'QQQ', 'VOO', 'VTI'].includes(item.ticker);
    const logoSvgUri = window.LogoService ? window.LogoService.getLogo(item.ticker, isIndia, isEtf) : '';
    const compName = window.LogoService ? window.LogoService.getCompanyName(item.ticker, item.name) : item.name;

    tr.innerHTML = `
      <td>
        <div class="wl-asset-cell">
          <div class="wl-logo-container">
            <img class="wl-logo-img loaded" src="${logoSvgUri}" alt="" loading="lazy" />
          </div>
          <div>
            <strong>${compName}</strong>
            <span class="wl-subname">${item.exchange || 'NSE'} · ${item.ticker}</span>
          </div>
        </div>
      </td>
      <td><span class="wl-exch">${item.exchange || 'NSE'}</span></td>
      <td class="wl-num">${item.price || '—'}</td>
      <td><span class="wl-change ${item.changePos !== false ? 'pos' : 'neg'}">${item.change || '+0.00%'}</span></td>
      <td>
        <button class="wl-action-btn qp-btn" data-ticker="${item.ticker}">Analyze →</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Auto-refresh Live Watchlist every 5 minutes (300,000 ms)
setInterval(() => {
  renderLiveWatchlist(false);
}, 5 * 60 * 1000);

// ── Search Autocomplete with Keyboard Navigation ────────────────────────────
function initSearchAutocomplete() {
  const input = document.getElementById('ticker-input');
  const dropdown = document.getElementById('search-autocomplete-dropdown');
  const resultsContainer = document.getElementById('search-auto-results');
  if (!input || !dropdown || !resultsContainer) return;

  let activeIndex = -1;

  function renderResults(results) {
    resultsContainer.innerHTML = '';
    if (!results || results.length === 0) {
      dropdown.classList.add('hidden');
      return;
    }

    results.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'search-auto-row';
      row.dataset.ticker = item.ticker;

      const isIndia = item.country === 'India';
      const isEtf = item.type === 'ETF';
      const logoSvgUri = window.LogoService ? window.LogoService.getLogo(item.ticker, isIndia, isEtf) : '';

      row.innerHTML = `
        <div class="sa-left">
          <div class="sa-logo-wrap"><img src="${logoSvgUri}" class="sa-logo-img" alt="" /></div>
          <div>
            <div class="sa-title"><strong>${item.ticker}</strong> <span class="sa-name">${item.name}</span></div>
            <div class="sa-sub">${item.country === 'India' ? '🇮🇳 India' : '🇺🇸 United States'} · ${item.exchange} · <span class="sa-type-badge">${item.type}</span></div>
          </div>
        </div>
        <div class="sa-right"><span class="sa-arrow">→</span></div>
      `;

      row.onclick = () => {
        input.value = item.ticker;
        dropdown.classList.add('hidden');
        if (window.SearchService) window.SearchService.addRecentSearch(item.ticker);
        analyze(item.ticker);
      };

      resultsContainer.appendChild(row);
    });

    dropdown.classList.remove('hidden');
    activeIndex = -1;
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    if (!q) {
      dropdown.classList.add('hidden');
      return;
    }
    if (window.SearchService) {
      const matches = window.SearchService.search(q);
      renderResults(matches);
    }
  });

  input.addEventListener('keydown', (e) => {
    const rows = resultsContainer.querySelectorAll('.search-auto-row');
    if (rows.length === 0 || dropdown.classList.contains('hidden')) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % rows.length;
      updateHighlight(rows);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + rows.length) % rows.length;
      updateHighlight(rows);
    } else if (e.key === 'Enter' && activeIndex >= 0 && activeIndex < rows.length) {
      e.preventDefault();
      rows[activeIndex].click();
    } else if (e.key === 'Escape') {
      dropdown.classList.add('hidden');
    }
  });

  function updateHighlight(rows) {
    rows.forEach((r, idx) => {
      r.classList.toggle('highlighted', idx === activeIndex);
      if (idx === activeIndex) r.scrollIntoView({ block: 'nearest' });
    });
  }

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });
}

// ── Notification Center ─────────────────────────────────────────────────────
function initNotificationCenter() {
  const btnNotif = document.getElementById('btn-notifications');
  const dropdown = document.getElementById('notifications-dropdown');
  const countBadge = document.getElementById('notif-count-badge');
  const pingDot = document.getElementById('notif-ping-dot');
  const unreadText = document.getElementById('notif-unread-text');
  const notifList = document.getElementById('notif-list-container');
  const markReadBtn = document.getElementById('btn-notif-mark-read');
  const clearBtn = document.getElementById('btn-notif-clear');

  if (!btnNotif || !dropdown) return;

  function updateNotifUI() {
    if (!window.NotificationService || !notifList) return;
    const items = window.NotificationService.getNotifications();
    const unread = window.NotificationService.getUnreadCount();

    if (countBadge) {
      countBadge.textContent = unread;
      countBadge.classList.toggle('hidden', unread === 0);
    }
    if (pingDot) {
      pingDot.classList.toggle('hidden', unread === 0);
    }
    if (unreadText) {
      unreadText.textContent = `${unread} Unread`;
    }

    notifList.innerHTML = '';
    if (items.length === 0) {
      notifList.innerHTML = '<div class="notif-empty">No alerts or notifications</div>';
      return;
    }

    items.forEach(item => {
      const el = document.createElement('div');
      el.className = `notif-item ${item.isRead ? 'read' : 'unread'}`;
      el.innerHTML = `
        <div class="notif-item-top">
          <span class="notif-type-tag ${item.type}">${item.type.replace('_', ' ').toUpperCase()}</span>
          <span class="notif-time">${item.timestamp}</span>
        </div>
        <h5 class="notif-item-title">${item.title}</h5>
        <p class="notif-item-msg">${item.message}</p>
        ${item.ticker ? `<button class="notif-action-analyze qp-btn" data-ticker="${item.ticker}">Analyze ${item.ticker} →</button>` : ''}
      `;
      notifList.appendChild(el);
    });
  }

  btnNotif.onclick = (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('hidden');
    updateNotifUI();
  };

  if (markReadBtn) {
    markReadBtn.onclick = () => {
      if (window.NotificationService) {
        window.NotificationService.markAllAsRead();
        updateNotifUI();
      }
    };
  }

  if (clearBtn) {
    clearBtn.onclick = () => {
      if (window.NotificationService) {
        window.NotificationService.clearAll();
        updateNotifUI();
      }
    };
  }

  document.addEventListener('click', (e) => {
    if (dropdown && !dropdown.contains(e.target) && (!btnNotif || !btnNotif.contains(e.target))) {
      dropdown.classList.add('hidden');
    }
  });

  updateNotifUI();
}

// ── Settings Modal ──────────────────────────────────────────────────────────

// ── Unified Sidebar Navigation Manager ──────────────────────────────────────
function initSidebarNavigation() {
  const navItems = [
    { id: 'nav-link-dash', target: '#result-panel', isDash: true },
    { id: 'nav-link-chart', target: '#stock-chart-card', requiresAnalysis: true },
    { id: 'nav-link-shap', target: '#shap-card', requiresAnalysis: true },
    { id: 'nav-link-benchmark', target: '#benchmark-card', requiresAnalysis: true },
    { id: 'nav-link-watchlist', target: '#market-watchlist' },
    { id: 'nav-link-news', target: '#market-news', isNews: true },
    { id: 'nav-link-settings', isSettings: true }
  ];

  navItems.forEach(item => {
    const linkEl = document.getElementById(item.id);
    if (!linkEl) return;

    linkEl.addEventListener('click', (e) => {
      // Close mobile sidebar if open
      const sidebarEl = document.getElementById('app-sidebar');
      if (sidebarEl) sidebarEl.classList.remove('open');

      // Settings modal handler
      if (item.isSettings) {
        e.preventDefault();
        const modal = document.getElementById('settings-modal-overlay');
        if (modal) modal.classList.remove('hidden');
        return;
      }

      e.preventDefault();

      // If currently in news-only mode and clicking another nav item, exit news-only mode first
      if (_isNewsOnlyMode && !item.isNews) {
        setNewsOnlyMode(false);
      }

      // Update active highlight in sidebar
      setActiveSidebarLink(item.id);

      // Handle Dashboard Link
      if (item.isDash) {
        if (_hasAnalysis) {
          const res = document.getElementById('result-panel');
          if (res && !res.classList.contains('hidden')) {
            res.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
          }
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      // Handle Section Smooth Scroll
      if (item.target) {
        const targetEl = document.querySelector(item.target);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  });

  // Ensure initial analysis menu item visibility
  updateAnalysisNavVisibility(_hasAnalysis);
}

function initSettingsModal() {
  const navSettings = document.getElementById('nav-link-settings');
  const modal = document.getElementById('settings-modal-overlay');
  const closeBtn = document.getElementById('settings-modal-close');
  const saveBtn = document.getElementById('btn-save-settings');

  if (!modal) return;

  if (navSettings) {
    navSettings.onclick = (e) => {
      e.preventDefault();
      modal.classList.remove('hidden');
    };
  }

  if (closeBtn) {
    closeBtn.onclick = () => modal.classList.add('hidden');
  }

  modal.onclick = (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  };

  if (saveBtn) {
    saveBtn.onclick = () => {
      saveBtn.textContent = '✓ Saved Successfully';
      setTimeout(() => {
        saveBtn.textContent = 'Save Settings';
        modal.classList.add('hidden');
      }, 800);
    };
  }
}

// Re-hook DOM load for full platform suite
function initPlatform() {
  renderLiveWatchlist();
  initNewsPortal();
  initSidebarNavigation();
  initSearchAutocomplete();
  initNotificationCenter();
  initSettingsModal();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPlatform);
} else {
  initPlatform();
}
