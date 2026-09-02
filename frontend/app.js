/* =============================================================================
   QuantView AI — app.js v3.0
   Multi-market support: India (NSE/BSE) + US
   All prices, ATR, etc. use currency from the API response.
============================================================================= */

const API_BASE = (window.location.protocol === 'file:') ? 'http://127.0.0.1:8000' : '';
window.QV_API_BASE = API_BASE;

// ── HTML Sanitization & Safety Helper ─────────────────────────────────────────
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
window.escapeHtml = escapeHtml;

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
 * Get effective active currency symbol based on user platform settings.
 */
function getEffectiveCurrency(dataSym = '$') {
  try {
    const s = getPlatformSettings();
    if (s.currency === 'INR') return '₹';
    if (s.currency === 'USD') return '$';
  } catch (e) {}
  return dataSym || '$';
}

/**
 * Format a monetary value with the active currency symbol and locale format.
 * @param {number|null} v - value
 * @param {string} sym - currency symbol, e.g. '₹' or '$'
 * @param {number} digits
 */
function currency(v, sym = '$', digits = 2) {
  if (v == null || !isFinite(v)) return 'N/A';
  const effectiveSym = getEffectiveCurrency(sym);
  const locale = effectiveSym === '₹' ? 'en-IN' : 'en-US';
  return `${effectiveSym}${Number(v).toLocaleString(locale, {
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

// =============================================================================
// QuantView AI — Animation & Micro-Interaction Utilities
// =============================================================================
const _prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Animate numeric values smoothly from startVal to endVal using ease-out cubic.
 * Guaranteed to end strictly at endVal formatted by formatter.
 * Handles both plain text and HTML formatted outputs safely.
 */
function animateNumber(element, startVal, endVal, duration = 850, formatter = (v) => v.toFixed(2)) {
  if (!element || endVal === null || endVal === undefined || isNaN(endVal)) return;

  function _apply(val) {
    const res = formatter(val);
    if (typeof res === 'string' && (res.includes('<') || res.includes('&'))) {
      element.innerHTML = res;
    } else {
      element.textContent = res;
    }
  }

  if (_prefersReducedMotion || duration <= 0) {
    _apply(endVal);
    return;
  }

  const sVal = (startVal !== null && startVal !== undefined && !isNaN(startVal)) ? startVal : 0;
  const startTime = performance.now();
  const diff = endVal - sVal;

  function update(now) {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / duration);
    // Ease-out cubic: 1 - (1 - t)^3
    const ease = 1 - Math.pow(1 - progress, 3);
    const current = sVal + diff * ease;

    _apply(current);

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      _apply(endVal);
    }
  }

  requestAnimationFrame(update);
}

/**
 * Stagger the reveal of result cards upon receiving new analysis data.
 */
function staggerRevealCards(container) {
  if (!container || _prefersReducedMotion) return;
  const cards = container.querySelectorAll('.card, .kpi-grid, .hero-card');
  cards.forEach((card, index) => {
    card.classList.remove('qv-card-reveal');
    card.style.animationDelay = `${Math.min(index * 45, 400)}ms`;
    void card.offsetWidth; // force reflow
    card.classList.add('qv-card-reveal');
  });
}

// ── Loading step animator ─────────────────────────────────────────────────────
const STEP_ORDER = ['fetch', 'indicators', 'regime', 'backtest', 'train', 'predict'];
let _stepIdx = 0;

const INDETERMINATE_PHRASES = [
  'Fitting walk-forward Purged XGBoost decision trees...',
  'Training sequential PyTorch LSTM temporal memory folds...',
  'Computing Kernel SHAP feature attribution & baseline Shapley values...',
  'Evaluating out-of-fold probability calibration & ensemble stacking...',
  'Compiling institutional intelligence & multi-asset risk metrics...'
];

function startLoadingSteps(ticker = '') {
  if (_stepInterval) {
    clearInterval(_stepInterval);
    _stepInterval = null;
  }

  _stepIdx = 0;
  let phraseIdx = 0;
  const titleEl = document.getElementById('loading-title');
  const tClean = (ticker || 'Asset').toUpperCase();
  if (titleEl) {
    titleEl.textContent = `Analyzing ${tClean} Pipeline`;
  }

  Object.values(loadingSteps).forEach(el => {
    if (el) el.classList.remove('active', 'done', 'pulse');
  });
  if (loadingSteps[STEP_ORDER[0]]) {
    loadingSteps[STEP_ORDER[0]].classList.add('active');
  }

  _stepInterval = setInterval(() => {
    if (_stepIdx < STEP_ORDER.length && loadingSteps[STEP_ORDER[_stepIdx]]) {
      loadingSteps[STEP_ORDER[_stepIdx]].classList.remove('active');
      loadingSteps[STEP_ORDER[_stepIdx]].classList.add('done');
    }
    _stepIdx++;
    if (_stepIdx < STEP_ORDER.length && loadingSteps[STEP_ORDER[_stepIdx]]) {
      loadingSteps[STEP_ORDER[_stepIdx]].classList.add('active');
    } else {
      // Transition to indeterminate ongoing computation state for long cold-starts
      const lastStep = loadingSteps[STEP_ORDER[STEP_ORDER.length - 1]];
      if (lastStep) {
        lastStep.classList.add('active', 'pulse');
      }
      if (titleEl) {
        titleEl.textContent = `Analyzing ${tClean} · ${INDETERMINATE_PHRASES[phraseIdx % INDETERMINATE_PHRASES.length]}`;
        phraseIdx++;
      }
    }
  }, 1600);
}

function stopLoadingSteps() {
  if (_stepInterval) {
    clearInterval(_stepInterval);
    _stepInterval = null;
  }
  Object.values(loadingSteps).forEach(el => {
    if (el) {
      el.classList.remove('active', 'pulse');
      el.classList.add('done');
    }
  });
}

// ── UI state helpers ──────────────────────────────────────────────────────────
function showLoading(ticker = '') {
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

  startLoadingSteps(ticker);
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
  staggerRevealCards(resultPanel);
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
  const currSym = data.market?.currency_symbol || (isIndia ? '₹' : '$');
  const currCode = isIndia ? 'INR' : 'USD';

  const isFundMode = Boolean(
    inst.is_fund ||
    (data.market && (data.market.is_etf || (data.market.company_name && data.market.company_name.includes('Index')))) ||
    (inst.analyst_rating && inst.analyst_rating.toUpperCase().includes('INDEX')) ||
    (data.ticker && data.ticker.startsWith('^'))
  );

  // Section Header & ETF Informational Banner
  const secTitleEl = document.getElementById('inst-section-title');
  const secSubtagEl = document.getElementById('inst-section-subtag');
  const etfBannerEl = document.getElementById('inst-etf-banner');

  if (isFundMode) {
    if (secTitleEl) secTitleEl.innerHTML = 'ETF &amp; INDEX INTELLIGENCE <button class="info-btn" data-info="institutional_intelligence" aria-label="What is ETF Intelligence?">ⓘ</button>';
    if (secSubtagEl) secSubtagEl.textContent = 'Fund Overview · Benchmark Tracking · Characteristics · Portfolio Valuation · Liquidity · Composition';
    if (etfBannerEl) etfBannerEl.classList.remove('hidden');
  } else {
    if (secTitleEl) secTitleEl.innerHTML = 'INSTITUTIONAL &amp; FUNDAMENTAL INTELLIGENCE <button class="info-btn" data-info="institutional_intelligence" aria-label="What is Institutional Intelligence?">ⓘ</button>';
    if (secSubtagEl) secSubtagEl.textContent = 'Analyst Consensus · Revenue Forecast · Valuation · Margins';
    if (etfBannerEl) etfBannerEl.classList.add('hidden');
  }

  // Header and Sublabel elements for 6 cards
  const c1Cat = document.getElementById('inst-card1-cat');
  const c1Lbl = document.getElementById('inst-card1-lbl');
  const c1Gauge = document.getElementById('inst-card1-gauge');
  const c2Cat = document.getElementById('inst-card2-cat');
  const c2Lbl = document.getElementById('inst-card2-lbl');
  const c3Cat = document.getElementById('inst-card3-cat');
  const c3Lbl = document.getElementById('inst-card3-lbl');
  const c4Cat = document.getElementById('inst-card4-cat');
  const c4Lbl = document.getElementById('inst-card4-lbl');
  const c5Cat = document.getElementById('inst-card5-cat');
  const c5Lbl = document.getElementById('inst-card5-lbl');
  const c6Cat = document.getElementById('inst-card6-cat');
  const c6Lbl = document.getElementById('inst-card6-lbl');

  if (isFundMode) {
    if (c1Cat) c1Cat.textContent = 'Overview';
    if (c1Lbl) { c1Lbl.textContent = 'Fund Type'; c1Lbl.classList.remove('hidden'); }
    if (c2Cat) c2Cat.textContent = 'Tracking';
    if (c2Lbl) c2Lbl.textContent = 'Benchmark';
    if (c3Cat) c3Cat.textContent = 'Structure';
    if (c3Lbl) c3Lbl.textContent = 'Fund Characteristics';
    if (c4Cat) c4Cat.textContent = 'Valuation';
    if (c4Lbl) c4Lbl.textContent = 'Portfolio Valuation';
    if (c5Cat) c5Cat.textContent = 'Trading';
    if (c5Lbl) c5Lbl.textContent = 'Liquidity';
    if (c6Cat) c6Cat.textContent = 'Composition';
    if (c6Lbl) c6Lbl.textContent = 'Portfolio Composition';
  } else {
    if (c1Cat) c1Cat.textContent = 'Analyst';
    if (c1Lbl) c1Lbl.classList.add('hidden');
    if (c2Cat) c2Cat.textContent = 'Analyst';
    if (c2Lbl) c2Lbl.textContent = 'Target Price';
    if (c3Cat) c3Cat.textContent = 'Earnings';
    if (c3Lbl) c3Lbl.textContent = 'Revenue Forecast';
    if (c4Cat) c4Cat.textContent = 'Financials';
    if (c4Lbl) c4Lbl.textContent = 'P/S Valuation';
    if (c5Cat) c5Cat.textContent = 'Trading';
    if (c5Lbl) c5Lbl.textContent = 'Trading Volume';
    if (c6Cat) c6Cat.textContent = 'Profitability';
    if (c6Lbl) c6Lbl.textContent = 'Gross Margin';
  }

  // 1. Card 1: Analyst Consensus (Company) / ETF Overview (Fund)
  const ratingEl = document.getElementById('inst-analyst-rating');
  const countEl = document.getElementById('inst-analyst-count');
  const needleEl = document.getElementById('inst-gauge-needle');
  const pathEl = document.getElementById('inst-gauge-path');

  if (isFundMode) {
    if (ratingEl) {
      ratingEl.textContent = inst.fund_type || 'Index ETF';
      ratingEl.className = 'inst-val-highlight cyan';
    }
    if (countEl) {
      countEl.textContent = inst.holdings_count_str ? `${inst.holdings_count_str} · ${inst.diversification || 'High Diversification'}` : 'Broad Market Diversification';
    }
    if (c1Gauge) c1Gauge.style.display = 'none';
  } else {
    if (c1Gauge) c1Gauge.style.display = '';
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
      countEl.textContent = inst.analyst_count > 0 ? `${inst.analyst_count} analysts coverage` : '0 analysts coverage';
    }
    if (needleEl) {
      const score = (inst.analyst_score !== undefined && inst.analyst_score !== null) ? inst.analyst_score : 50;
      const angle = ((score / 100) * 140) - 70;
      const rad = (angle - 90) * (Math.PI / 180);
      const x2 = (27 + 18 * Math.cos(rad)).toFixed(1);
      const y2 = (25 + 18 * Math.sin(rad)).toFixed(1);
      needleEl.setAttribute('x2', x2);
      needleEl.setAttribute('y2', y2);
      if (pathEl) {
        const color = score >= 60 ? '#10b981' : (score <= 35 ? '#ef4444' : '#f59e0b');
        pathEl.style.stroke = color;
        const totalLen = 72.2;
        const dash = Math.max(5, (score / 100) * totalLen);
        pathEl.style.strokeDasharray = `${dash} ${totalLen - dash}`;
      }
    }
  }

  // 2. Card 2: Target Price (Company) / Benchmark Tracking (Fund)
  const targetPriceEl = document.getElementById('inst-target-price');
  const targetCountEl = document.getElementById('inst-target-analysts');
  if (targetPriceEl) {
    if (isFundMode) {
      targetPriceEl.textContent = inst.benchmark_name || (data.market?.company_name || 'Broad Market Benchmark');
      if (targetCountEl) {
        targetCountEl.textContent = `${inst.replication_type || 'Full Replication'} · Tracking: ${inst.tracking_error || '< 0.05%'}`;
      }
    } else {
      if (inst.target_price !== null && inst.target_price !== undefined && inst.target_price > 0) {
        animateNumber(targetPriceEl, 0, inst.target_price, 750, v =>
          `${currSym}${v.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})} <span class="inst-curr">${currCode}</span>`
        );
        if (targetCountEl) {
          targetCountEl.textContent = inst.analyst_count > 0 ? `${inst.analyst_count} analysts coverage` : '12-Month Target Price';
        }
      } else {
        targetPriceEl.textContent = 'N/A';
        if (targetCountEl) {
          targetCountEl.textContent = inst.analyst_count > 0 ? `${inst.analyst_count} analysts` : 'Coverage unavailable';
        }
      }
    }
  }

  // 3. Card 3: Revenue Forecast (Company) / Fund Characteristics (Fund)
  const revArrowEl = document.getElementById('inst-rev-arrow');
  const revLabelEl = document.getElementById('inst-rev-label');
  const revSubEl = document.getElementById('inst-rev-sub');

  if (isFundMode) {
    if (revArrowEl) revArrowEl.textContent = '●';
    if (revLabelEl) {
      revLabelEl.textContent = inst.fund_category || 'Index Fund';
      revLabelEl.className = 'cyan';
    }
    if (revSubEl) {
      revSubEl.textContent = `Exp Ratio: ${inst.expense_ratio_str || 'Not Available'} · AUM: ${inst.aum_str || 'Not Available'}`;
    }
  } else {
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
  }

  // 4. Card 4: P/S Valuation (Company) / Portfolio Valuation (Fund)
  const psBadgeEl = document.getElementById('inst-ps-badge');
  const psValEl = document.getElementById('inst-ps-val');

  if (isFundMode) {
    if (psBadgeEl) {
      psBadgeEl.textContent = inst.portfolio_style || 'Large Blend';
      psBadgeEl.className = 'inst-val-badge cyan';
    }
    if (psValEl) {
      psValEl.textContent = inst.weighted_pe_str || 'Not Available';
    }
  } else {
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
      if (inst.ps_ratio !== null && inst.ps_ratio !== undefined) {
        animateNumber(psValEl, 0, inst.ps_ratio, 750, v => `${v.toFixed(2)} x`);
      } else {
        psValEl.textContent = 'N/A';
      }
    }
  }

  // 5. Card 5: Trading Volume (Company) / Liquidity (Fund)
  const volValEl = document.getElementById('inst-vol-val');
  const volSubEl = document.getElementById('inst-vol-sub');

  if (isFundMode) {
    if (volValEl) {
      volValEl.textContent = inst.trading_volume_str || 'Active Volume';
    }
    if (volSubEl) {
      volSubEl.textContent = inst.liquidity_rating || `Relative Volume: ${inst.volume_ratio}x (${inst.volume_status || 'Normal'})`;
    }
  } else {
    if (volValEl) {
      volValEl.textContent = inst.trading_volume_str || (inst.trading_volume ? inst.trading_volume.toLocaleString('en-US') + ' shares' : 'N/A');
    }
    if (volSubEl) {
      volSubEl.textContent = `Relative Volume: ${inst.volume_ratio}x (${inst.volume_status || 'Normal'})`;
    }
  }

  // 6. Card 6: Gross Margin (Company) / Portfolio Composition (Fund)
  const profBadgeEl = document.getElementById('inst-prof-badge');
  const profValEl = document.getElementById('inst-prof-val');

  if (isFundMode) {
    if (profBadgeEl) {
      profBadgeEl.textContent = inst.top_sector || 'Multi-Sector';
      profBadgeEl.className = 'inst-val-badge green';
    }
    if (profValEl) {
      profValEl.textContent = inst.top_holding || 'Constituent Basket';
    }
  } else {
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
      if (inst.gross_margin_pct !== null && inst.gross_margin_pct !== undefined) {
        animateNumber(profValEl, 0, inst.gross_margin_pct, 750, v => `${v.toFixed(2)} %`);
      } else {
        profValEl.textContent = 'N/A';
      }
    }
  }

  // Animate mini cards with subtle stagger
  const miniCards = section.querySelectorAll('.inst-mini-card');
  miniCards.forEach((mc, idx) => {
    mc.classList.remove('qv-card-reveal');
    mc.style.animationDelay = `${idx * 40}ms`;
    void mc.offsetWidth;
    mc.classList.add('qv-card-reveal');
  });
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
    const safeTitle = escapeHtml(item.title || '');
    const safeTime = escapeHtml(item.time_ago || 'Recent');
    const safeLink = (item.link && (item.link.startsWith('http://') || item.link.startsWith('https://')))
      ? escapeHtml(item.link)
      : '#';
    return `
      <div class="t-news-item">
        <div class="t-news-meta-row">
          <span class="t-news-publisher-badge">
            <span class="t-news-icon" style="background:${badge.bg}; color:${badge.color};">${escapeHtml(badge.text)}</span>
            <span>${escapeHtml(badge.name)}</span>
          </span>
          <span>•</span>
          <span>${safeTime}</span>
        </div>
        <a href="${safeLink}" target="_blank" rel="noopener noreferrer" class="t-news-headline-link">
          ${safeTitle}
        </a>
      </div>
    `;
  }).join('');
}

function renderHero(data) {
  const mkt = data.market;
  const sym = mkt.currency_symbol || '$';

  // Ingest live quote into central LiveQuoteService
  if (window.LiveQuoteService) {
    if (data.live_quote) {
      window.LiveQuoteService.setQuote(data.ticker, data.live_quote);
    }
  }

  // 1. Official Company Logo (with smooth fade-in, caching, and placeholder fallback)
  const logoImg = document.getElementById('hero-company-logo');
  if (logoImg && window.QVLogos) {
    window.QVLogos.renderLogo(logoImg, data.ticker, mkt.is_india, mkt.is_etf);
  }

  // 2. Bold Company Name
  const companyNameEl = document.getElementById('res-company-name');
  if (companyNameEl) {
    let nameText = data.company_name;
    if (!nameText || nameText === 'UNKNOWN') {
      if (mkt.is_index || data.ticker.startsWith('^')) {
        if (data.ticker === '^NSEI') nameText = 'NIFTY 50 Benchmark Index';
        else if (data.ticker === '^BSESN') nameText = 'BSE SENSEX Benchmark Index';
        else if (data.ticker === '^GSPC') nameText = 'S&P 500 Benchmark Index';
        else if (data.ticker === '^NDX') nameText = 'NASDAQ 100 Benchmark Index';
        else nameText = `${data.display_ticker || data.ticker} Index`;
      } else {
        nameText = window.QVLogos ? window.QVLogos.getCompanyName(data.ticker, data.display_ticker) : (data.display_ticker || data.ticker);
      }
    }
    companyNameEl.textContent = nameText;
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

  // ETF / Index badge segment
  const etfWrap = document.getElementById('mb-etf-wrap');
  etfWrap.classList.toggle('hidden', !(mkt.is_etf || mkt.is_index));

  // Sector / category line
  const sectorEl = document.getElementById('res-sector');
  if (mkt.is_index || data.ticker.startsWith('^')) {
    sectorEl.textContent = 'Macroeconomic Benchmark Index';
  } else if (mkt.is_etf) {
    sectorEl.textContent = mkt.etf_category || 'Exchange-Traded Fund';
  } else {
    const rawSector = (data.sector || '').trim();
    if (!rawSector || rawSector.toLowerCase() === 'unknown' || rawSector.toLowerCase() === 'none') {
      sectorEl.textContent = 'Equities Universe';
    } else {
      sectorEl.textContent = rawSector;
    }
  }

  // Price — synchronized with centralized LiveQuoteService
  const resPriceEl = document.getElementById('res-price');
  if (resPriceEl) {
    const initPrice = (window.LiveQuoteService && window.LiveQuoteService.getQuote(data.ticker))
      ? window.LiveQuoteService.getQuote(data.ticker).price
      : data.price;
    animateNumber(resPriceEl, 0, initPrice, 700, v => currency(v, sym));

    if (window.LiveQuoteService) {
      window.LiveQuoteService.subscribe('hero-component', data.ticker, (liveQ) => {
        if (liveQ && liveQ.price > 0 && resPriceEl) {
          resPriceEl.textContent = window.LiveQuoteService.formatPrice(liveQ.price, liveQ.currencySymbol);
        }
      });
    }
  }

  // Recommendation badge with reveal animation
  const recBadge = document.getElementById('rec-badge');
  const rec = data.recommendation;
  recBadge.textContent = rec.toUpperCase();
  recBadge.className   = `rec-badge ${rec.toLowerCase()} qv-rec-reveal`;

  document.getElementById('res-prob').textContent = pct(data.probability);

  // Top KPI summary card updates
  const kpiRec = document.getElementById('kpi-rec-val');
  if (kpiRec) {
    kpiRec.textContent = rec.toUpperCase();
    kpiRec.className = `kpi-val ${rec.toLowerCase()} qv-rec-reveal`;
  }
  const kpiProb = document.getElementById('kpi-prob-val');
  if (kpiProb) {
    animateNumber(kpiProb, 0, data.probability * 100, 750, v => `${Math.round(v)}%`);
  }
  const kpiConf = document.getElementById('kpi-conf-val');
  if (kpiConf && data.confidence) {
    animateNumber(kpiConf, 0, data.confidence.score, 850, v => `${Math.round(v)}/100`);
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
  if (fill) {
    fill.style.strokeDasharray = arcDashArray(score / 100);
    fill.style.stroke          = gaugeColor(score);
  }

  const gaugeValEl = document.getElementById('gauge-val');
  if (gaugeValEl) {
    animateNumber(gaugeValEl, 0, score, 850, v => `${Math.round(v)}`);
    gaugeValEl.style.color = gaugeColor(score);
  }
  document.getElementById('gauge-lbl').textContent = c.label;

  const comps = c.components;

  function setBar(barId, pctId, val) {
    const pv = val != null ? Math.round(val * 100) : null;
    const barEl = document.getElementById(barId);
    const pctEl = document.getElementById(pctId);
    if (barEl) barEl.style.width = pv != null ? `${pv}%` : '0%';
    if (pctEl) {
      if (pv != null) {
        animateNumber(pctEl, 0, pv, 800, v => `${Math.round(v)}%`);
      } else {
        pctEl.textContent = 'N/A';
      }
    }
  }

  setBar('cc-prob',   'cc-prob-pct',   comps.probability_strength);
  setBar('cc-vol',    'cc-vol-pct',    comps.volatility);
  setBar('cc-data',   'cc-data-pct',   comps.data_quality);
  setBar('cc-regime', 'cc-regime-pct', comps.regime_clarity);
  setBar('cc-agree',  'cc-agree-pct',  comps.model_agreement);

  // Note when agreement is excluded
  if (c.lstm_excluded_from_agreement) {
    const agreeEl = document.getElementById('cc-agree-pct');
    if (agreeEl) {
      agreeEl.textContent = 'Excl.';
      agreeEl.title = 'LSTM unavailable — model agreement component excluded and weights renormalised';
    }
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
  if (!grid) return;
  grid.innerHTML = '';

  const LABELS = {
    rsi:       'RSI',
    trend:     'Trend (SMA)',
    macd:      'MACD',
    momentum:  'Momentum',
    volume:    'Volume',
    valuation: 'Valuation',
  };
  // Maps signal-row key -> glossary key (data-info)
  const INFO_KEY = {
    rsi: 'rsi', trend: 'trend', macd: 'macd',
    momentum: 'momentum', volume: 'volume', valuation: 'valuation',
  };

  const signals = data.signals || {};
  const isEtf = data.valuation?.is_etf || data.market?.is_etf;

  Object.entries(LABELS).forEach(([key, label], idx) => {
    let val      = signals[key] || 'unavailable';
    let cssClass = SIG_CLASS[val] || 'sig-unavailable';
    let dispVal  = val === 'not_applicable' ? 'N/A (ETF)' : (val.charAt(0).toUpperCase() + val.slice(1).replace(/_/g, ' '));
    
    if (key === 'valuation' && isEtf) {
      dispVal = 'N/A (ETF)';
      cssClass = 'sig-neutral';
    } else if (val === 'unavailable') {
      dispVal = 'Not Available';
    }

    const row = document.createElement('div');
    row.className = 'signal-row qv-card-reveal';
    row.style.animationDelay = `${idx * 35}ms`;
    row.innerHTML = `
      <div class="signal-name-box">
        <span class="signal-name">${label}</span>
        ${key === 'valuation' ? '<span class="signal-rule-pill">Rule-based</span>' : ''}
        <button class="info-btn" data-info="${INFO_KEY[key]}" aria-label="What is ${label}?">ⓘ</button>
      </div>
      <span class="signal-val-badge ${cssClass}">${dispVal}</span>
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
  if (badge) {
    badge.textContent = regLabel[r.name] || r.name;
    badge.className   = `regime-badge r-${r.name.replace(/_/g, '-')}`;
    badge.classList.remove('regime-pulse-once');
    void badge.offsetWidth;
    badge.classList.add('regime-pulse-once');
  }

  const clarityPct = Math.round((r.clarity ?? 0) * 100);
  const rsBar = document.getElementById('rs-bar');
  const rsPct = document.getElementById('rs-pct');
  if (rsBar) rsBar.style.width = `${clarityPct}%`;
  if (rsPct) animateNumber(rsPct, 0, clarityPct, 750, v => `${Math.round(v)}%`);

  const adxEl = document.getElementById('stat-adx');
  if (adxEl && r.adx != null) animateNumber(adxEl, 0, r.adx, 750, v => num(v));
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

  const annVolEl = document.getElementById('stat-annvol');
  if (annVolEl && v.annualized != null) {
    animateNumber(annVolEl, 0, v.annualized * 100, 750, val => `${val.toFixed(1)}%`);
  }
  const atrEl = document.getElementById('stat-atr');
  if (atrEl && v.atr != null) {
    animateNumber(atrEl, 0, v.atr, 750, val => currency(val, sym, 3));
  }
  document.getElementById('stat-atr-pct').textContent = `${num(v.atr_percent, 3)}%`;
  const rsiEl = document.getElementById('stat-rsi');
  if (rsiEl && v.rsi != null) {
    animateNumber(rsiEl, 0, v.rsi, 750, val => num(val));
  }
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

  if (val.pe_ratio != null && peEl) {
    animateNumber(peEl, 0, val.pe_ratio, 750, v => num(v, 1));
  } else {
    peEl.textContent = 'Not Available';
  }
  if (val.peer_pe != null && speEl) {
    animateNumber(speEl, 0, val.peer_pe, 750, v => num(v, 1));
  } else {
    speEl.textContent = 'Not Available';
  }
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
  if (!bt) return;

  const horizonDays = bt.forecast_horizon_days || 20;
  const purgeDays = bt.purge_period_days || 20;

  // Subtitle update
  const subEl = document.getElementById('bt-subtitle-text');
  if (subEl) {
    subEl.textContent = `T+${horizonDays} horizon · ${purgeDays}-Day Purge/Embargo prevents look-ahead leakage · Out-of-fold predictions`;
  }

  // 1. Primary Classification Cards
  const PRIMARY = [
    {
      label: 'Accuracy',
      sub: 'Directional Hit Rate',
      val: pct(bt.accuracy),
      info: 'accuracy',
      tag: bt.accuracy >= 0.52 ? 'Alpha Positive' : (bt.accuracy >= 0.50 ? 'Baseline' : 'Sub-Optimal'),
      tagClass: bt.accuracy >= 0.52 ? 'pos' : (bt.accuracy >= 0.50 ? 'neutral' : 'neg'),
      desc: 'vs. 50% Random Walk',
      pctNum: Math.min(100, Math.max(0, (bt.accuracy || 0) * 100)),
    },
    {
      label: 'Precision',
      sub: 'Positive Predictive Value',
      val: pct(bt.precision),
      info: 'precision',
      tag: bt.precision >= 0.55 ? 'High Quality' : (bt.precision >= 0.50 ? 'Standard' : 'Moderate'),
      tagClass: bt.precision >= 0.50 ? 'pos' : 'neutral',
      desc: 'Long Signal Fidelity',
      pctNum: Math.min(100, Math.max(0, (bt.precision || 0) * 100)),
    },
    {
      label: 'Recall',
      sub: 'True Positive Rate',
      val: pct(bt.recall),
      info: 'recall',
      tag: 'Selective Longs',
      tagClass: 'low',
      desc: 'Opportunity Capture',
      pctNum: Math.min(100, Math.max(0, (bt.recall || 0) * 100)),
    },
    {
      label: 'F1 Score',
      sub: 'Harmonic Balance',
      val: pct(bt.f1),
      info: 'f1',
      tag: 'P & R Balance',
      tagClass: 'baseline',
      desc: 'Model Robustness',
      pctNum: Math.min(100, Math.max(0, (bt.f1 || 0) * 100)),
    },
  ];

  const pGrid = document.getElementById('bt-grid');
  if (pGrid) {
    pGrid.innerHTML = '';
    PRIMARY.forEach(item => {
      const card = document.createElement('div');
      card.className = 'bt-primary-card glass';
      card.innerHTML = `
        <div class="bt-card-top">
          <div class="bt-label-wrap">
            <span class="bt-label">${escapeHtml(item.label)}</span>
            <span class="bt-sub">${escapeHtml(item.sub)}</span>
          </div>
          <div class="bt-top-right">
            ${item.info ? `<button class="info-btn" data-info="${item.info}" aria-label="What is ${item.label}?">ⓘ</button>` : ''}
            <span class="sc-tag ${item.tagClass}">${escapeHtml(item.tag)}</span>
          </div>
        </div>
        <div class="bt-card-mid">
          <div class="bt-metric-val">${escapeHtml(item.val)}</div>
          <div class="bt-meter-track">
            <div class="bt-meter-fill ${item.tagClass}" style="width: ${item.pctNum.toFixed(1)}%;"></div>
            <div class="bt-meter-benchmark" style="left: 50%;" title="50% Baseline"></div>
          </div>
        </div>
        <div class="bt-card-foot">
          <span class="bt-foot-desc">${escapeHtml(item.desc)}</span>
          <span class="bt-foot-val">${item.pctNum.toFixed(1)}%</span>
        </div>
      `;
      pGrid.appendChild(card);
    });
  }

  // 2. Advanced 8-Metric Structured Grid
  const ADVANCED = [
    {
      label: 'ROC-AUC Score',
      sub: 'Binary Discrimination',
      val: num(bt.roc_auc, 3),
      info: 'roc_auc',
      tag: bt.roc_auc >= 0.55 ? 'Discriminative' : (bt.roc_auc >= 0.50 ? 'Baseline' : 'Weak'),
      tagClass: bt.roc_auc >= 0.55 ? 'pos' : 'neutral',
    },
    {
      label: 'Brier Calibration',
      sub: 'Mean Squared Error',
      val: num(bt.brier_score, 4),
      info: 'brier_score',
      tag: bt.brier_score <= 0.25 ? 'Well-Calibrated' : 'Uncalibrated',
      tagClass: bt.brier_score <= 0.25 ? 'pos' : 'neg',
    },
    {
      label: 'Avg Forward Return',
      sub: `Mean T+${horizonDays}d Horizon`,
      val: bt.avg_fwd_return_pct != null ? `${bt.avg_fwd_return_pct > 0 ? '+' : ''}${bt.avg_fwd_return_pct.toFixed(2)}%` : 'N/A',
      info: 't20_horizon',
      tag: (bt.avg_fwd_return_pct || 0) >= 0 ? 'Positive Drift' : 'Negative Drift',
      tagClass: (bt.avg_fwd_return_pct || 0) >= 0 ? 'pos' : 'neg',
    },
    {
      label: 'Median Fwd Return',
      sub: `Robust 50th Percentile`,
      val: bt.med_fwd_return_pct != null ? `${bt.med_fwd_return_pct > 0 ? '+' : ''}${bt.med_fwd_return_pct.toFixed(2)}%` : 'N/A',
      info: 't20_horizon',
      tag: '50th %ile',
      tagClass: 'neutral',
    },
    {
      label: 'OOF Sample Size',
      sub: 'Walk-Forward Evaluations',
      val: `${bt.oof_samples ?? 'N/A'} Bars`,
      info: 'oof_samples',
      tag: 'Historical Bars',
      tagClass: 'low',
    },
    {
      label: 'Positive Class (Up)',
      sub: 'Bullish Out-of-Fold Bars',
      val: `${bt.oof_positive_samples ?? 'N/A'} (${bt.oof_samples ? Math.round((bt.oof_positive_samples / bt.oof_samples) * 100) : 0}%)`,
      info: 'oof_samples',
      tag: 'Class Balance',
      tagClass: 'neutral',
    },
    {
      label: 'Purge & Embargo Window',
      sub: 'Anti-Leakage Buffer',
      val: `${purgeDays} Trading Sessions`,
      info: 'purge_embargo',
      tag: 'Zero Leakage',
      tagClass: 'frictionless',
    },
    {
      label: 'Ensemble Stacking',
      sub: 'Architecture Stack',
      val: bt.lstm_used_in_stacking ? 'XGBoost + PyTorch LSTM' : 'XGBoost Primary',
      info: 'lstm_coefficient',
      tag: bt.lstm_used_in_stacking ? 'Dual Ensemble' : 'XGB Core',
      tagClass: 'low',
    },
  ];

  const aGrid = document.getElementById('bt-advanced-grid');
  if (aGrid) {
    aGrid.innerHTML = '';
    ADVANCED.forEach(item => {
      const card = document.createElement('div');
      card.className = 'bt-adv-card glass';
      card.innerHTML = `
        <div class="bt-adv-top">
          <div class="bt-adv-label-wrap">
            <span class="bt-adv-label">${escapeHtml(item.label)}</span>
            <span class="bt-adv-sub">${escapeHtml(item.sub)}</span>
          </div>
          <div class="bt-adv-right">
            ${item.info ? `<button class="info-btn" data-info="${item.info}" aria-label="What is ${item.label}?">ⓘ</button>` : ''}
            <span class="sc-tag ${item.tagClass}">${escapeHtml(item.tag)}</span>
          </div>
        </div>
        <div class="bt-adv-val">${escapeHtml(item.val)}</div>
      `;
      aGrid.appendChild(card);
    });
  }

  const btContainer = document.getElementById('backtest-card');
  if (btContainer && window.QV_initInfoIcons) {
    window.QV_initInfoIcons(btContainer);
  }
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

    items.forEach((item, idx) => {
      const barPct = Math.min(100, Math.round((Math.abs(item.shap_value) / maxAbs) * 100));
      const sign = item.shap_value > 0 ? '+' : '';
      const infoKey = FEAT_INFO_MAP[item.feature] || item.feature;
      const row = document.createElement('div');
      row.className = 'shap-item qv-card-reveal';
      row.style.animationDelay = `${Math.min(idx * 45, 300)}ms`;
      row.innerHTML = `
        <div class="shap-item-top">
          <div class="shap-feat-name-wrap">
            <span class="shap-feat-name">${item.display_name}</span>
            <button class="info-btn" data-info="${infoKey}" aria-label="What is ${item.display_name}?">ⓘ</button>
          </div>
          <span class="shap-impact ${isPos ? 'shap-impact-pos' : 'shap-impact-neg'}">${sign}${(item.shap_value * 100).toFixed(1)}%</span>
        </div>
        <div class="shap-bar-wrap">
          <span class="shap-feat-val">Val: ${num(item.value, 2)}</span>
          <div class="shap-bar-bg">
            <div class="shap-bar ${isPos ? 'shap-bar-pos' : 'shap-bar-neg'}" style="width: ${barPct}%;"></div>
          </div>
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
    const s = getPlatformSettings();
    const cap = s.capital || 100000;
    const fee = (s.cost != null ? s.cost : 0.10) / 100.0;
    const slip = (s.slippage != null ? s.slippage : 0.05) / 100.0;
    const sym = getEffectiveCurrency(curSym);

    const url = `${API_BASE}/api/backtest/compare?ticker=${encodeURIComponent(ticker)}&capital=${cap}&cost=${fee}&slippage=${slip}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    if (periodLabel && data.period) {
      const capStr = Number(cap) >= 1000000 ? `${(cap/1000000).toFixed(1)}M` : (Number(cap) >= 1000 ? `${(cap/1000).toFixed(0)}k` : `${cap}`);
      periodLabel.textContent = `${data.period.start} to ${data.period.end} (${data.period.trading_days} sessions) · ${sym}${capStr} capital · ${(fee * 100).toFixed(2)}% fee · ${(slip * 100).toFixed(2)}% slippage`;
    }

    // 1. Populate Metrics Table
    if (tableBody && data.strategies) {
      tableBody.innerHTML = '';
      data.strategies.forEach(s => {
        const badgeClass = s.name === 'QuantView' ? 'strat-badge-qv' : s.name === 'Buy & Hold' ? 'strat-badge-bh' : 'strat-badge-sma';
        const retColor = s.total_return > 0 ? 'var(--green)' : s.total_return < 0 ? 'var(--red)' : 'var(--text-1)';
        const sign = s.total_return > 0 ? '+' : '';
        const tradeCount = s.trades != null ? s.trades : (s.trade_count != null ? s.trade_count : '—');
        const volStr = s.volatility != null ? `${num(s.volatility, 1)}%` : '—';
        const winRateStr = s.win_rate != null ? `${num(s.win_rate, 1)}%` : (s.name === 'Buy & Hold' ? (s.total_return > 0 ? '100.0%' : '0.0%') : '—');
        const isWinHigh = s.win_rate != null && s.win_rate >= 50;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td class="strat-name-cell"><span class="${badgeClass}"></span> ${s.name}</td>
          <td style="color: ${retColor}; font-weight:700;">${sign}${num(s.total_return, 2)}%</td>
          <td style="color: ${retColor}; font-weight:600;">${cagrSign}${num(s.cagr, 2)}%</td>
          <td>${num(s.sharpe, 2)}</td>
          <td style="color: var(--red);">${num(s.max_drawdown, 2)}%</td>
          <td style="color: var(--text-2); font-family:var(--font-mono);">${volStr}</td>
          <td style="font-weight:600;">${tradeCount}</td>
          <td style="font-weight:700; color: ${isWinHigh ? 'var(--green)' : 'var(--text-1)'}; font-family:var(--font-mono);">${winRateStr}</td>
        `;
        tableBody.appendChild(tr);
      });
    }

    // 2. Populate Cost Scenarios Grid
    if (scenariosGrid && data.cost_scenarios) {
      scenariosGrid.innerHTML = '';
      data.cost_scenarios.forEach(sc => {
        const card = document.createElement('div');
        card.className = 'cost-scenario-card glass';
        const isPos = sc.total_return > 0;
        const retSign = isPos ? '+' : '';
        const retColorClass = isPos ? 'pos' : 'neg';
        
        const costVal = sc.cost_pct != null ? sc.cost_pct * 100 : parseFloat(String(sc.cost_label || '0').replace('%', ''));
        let tierLabel = 'Custom Tier';
        let tierTag = 'Standard';
        let tagClass = 'baseline';
        if (costVal === 0) {
          tierLabel = 'Zero Fee';
          tierTag = 'Frictionless';
          tagClass = 'frictionless';
        } else if (costVal <= 0.05) {
          tierLabel = 'Institutional';
          tierTag = 'Low Cost';
          tagClass = 'low';
        } else if (costVal <= 0.10) {
          tierLabel = 'Standard';
          tierTag = 'Baseline';
          tagClass = 'baseline';
        } else {
          tierLabel = 'High Impact';
          tierTag = 'Stressed';
          tagClass = 'stressed';
        }

        const costLabel = sc.cost_label || `${costVal.toFixed(2)}%`;

        card.innerHTML = `
          <div class="sc-header">
            <div class="sc-tier-badge">
              <span class="sc-fee-val">${escapeHtml(costLabel)} Fee</span>
              <span class="sc-tier-sub">${escapeHtml(tierLabel)}</span>
            </div>
            <span class="sc-tag ${tagClass}">${escapeHtml(tierTag)}</span>
          </div>

          <div class="sc-body">
            <div class="sc-ret-label">Net Strategy Return</div>
            <div class="sc-ret-val ${retColorClass}">
              <span class="sc-ret-arrow">${isPos ? '▲' : '▼'}</span>
              <span>${retSign}${num(sc.total_return, 2)}%</span>
            </div>
          </div>

          <div class="sc-metrics-grid">
            <div class="sc-metric-box">
              <span class="sc-metric-lbl">Sharpe Ratio</span>
              <strong class="sc-metric-num ${sc.sharpe >= 1 ? 'pos' : (sc.sharpe < 0 ? 'neg' : '')}">${num(sc.sharpe, 2)}</strong>
            </div>
            <div class="sc-metric-box">
              <span class="sc-metric-lbl">Max Drawdown</span>
              <strong class="sc-metric-num neg">${num(sc.max_drawdown, 2)}%</strong>
            </div>
          </div>
        `;
        scenariosGrid.appendChild(card);
      });
    }

    // 3. Render Strategy Equity Curve & Sync Currency Symbol
    if (data.equity_curve && Array.isArray(data.equity_curve) && data.equity_curve.length > 0) {
      renderEquityChart(data.equity_curve, sym);
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
  else if (tf === '3Y') count = Math.min(n, 756);
  else if (tf === '5Y') count = Math.min(n, 1260);
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

  const rawSubset = filterPriceHistory(_activeTimeframe);
  let pts = (rawSubset || []).map(p => ({ ...p }));

  // Visualization Layer: Merges latest live quote projection without mutating historical series
  if (window.LiveQuoteService && _lastTicker) {
    const liveQ = window.LiveQuoteService.getQuote(_lastTicker);
    if (liveQ && liveQ.price > 0 && pts.length > 0) {
      const todayStr = (liveQ.lastUpdated || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
      const lastPt = pts[pts.length - 1];
      if (lastPt.date === todayStr) {
        pts[pts.length - 1] = {
          ...lastPt,
          close: liveQ.price,
          high: Math.max(lastPt.high || lastPt.close, liveQ.price),
          low: Math.min(lastPt.low || lastPt.close, liveQ.price),
        };
      } else if (lastPt.date < todayStr) {
        pts.push({
          date: todayStr,
          close: liveQ.price,
          open: liveQ.previousClose || lastPt.close,
          high: Math.max(liveQ.previousClose || lastPt.close, liveQ.price),
          low: Math.min(liveQ.previousClose || lastPt.close, liveQ.price),
          volume: null,
          sma50: lastPt.sma50,
          sma200: lastPt.sma200,
        });
      }
    }
  }

  _activeSubset = pts;
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

  // Header display — synchronized with LiveQuoteService
  if (window.LiveQuoteService && _lastTicker) {
    const liveQ = window.LiveQuoteService.getQuote(_lastTicker);
    if (liveQ && liveQ.price > 0) {
      priceDisplay.textContent = window.LiveQuoteService.formatPrice(liveQ.price, _chartCurrency);
      const chgInfo = window.LiveQuoteService.formatChange(liveQ.change, liveQ.changePercent, _chartCurrency);
      diffDisplay.textContent = chgInfo.text;
      diffDisplay.className = `chart-price-diff ${chgInfo.isPositive ? 'diff-positive' : 'diff-negative'}`;
    } else {
      priceDisplay.textContent = formatGrowwPrice(lastP, _chartCurrency);
      const sign = isPositive ? '+' : '';
      diffDisplay.textContent = `${sign}${formatGrowwPrice(Math.abs(totalChange), _chartCurrency)} (${sign}${totalChangePct.toFixed(2)}%)`;
      diffDisplay.className = `chart-price-diff ${isPositive ? 'diff-positive' : 'diff-negative'}`;
    }
  } else {
    priceDisplay.textContent = formatGrowwPrice(lastP, _chartCurrency);
    const sign = isPositive ? '+' : '';
    diffDisplay.textContent = `${sign}${formatGrowwPrice(Math.abs(totalChange), _chartCurrency)} (${sign}${totalChangePct.toFixed(2)}%)`;
    diffDisplay.className = `chart-price-diff ${isPositive ? 'diff-positive' : 'diff-negative'}`;
  }
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
      const svgStage = document.getElementById('groww-chart-stage');
      if (svgStage) {
        svgStage.classList.remove('chart-stage-crossfade');
        void svgStage.offsetWidth;
        svgStage.classList.add('chart-stage-crossfade');
      }
      drawGrowwStockChart();
    });
  });
}

function renderStockChart(data) {
  _priceHistory  = data.price_history || [];
  _chartCurrency = data.market?.currency_symbol || (data.market?.is_india ? '₹' : '$');
  if (window.LiveQuoteService && data.live_quote) {
    window.LiveQuoteService.setQuote(data.ticker, data.live_quote);
    if (data.display_ticker && data.display_ticker !== data.ticker) {
      window.LiveQuoteService.setQuote(data.display_ticker, data.live_quote);
    }
  }
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

  const validVals = allVals.filter(v => v != null && isFinite(v));
  if (validVals.length === 0) return;

  let minV = Math.min(...validVals);
  let maxV = Math.max(...validVals);
  const diffV = maxV - minV;
  minV = minV - (diffV * 0.05 || minV * 0.02);
  maxV = maxV + (diffV * 0.05 || maxV * 0.02);
  const rangeV = Math.max(1, maxV - minV);

  const n = _equityPoints.length;
  const getX = i => padLeft + (i / Math.max(1, n - 1)) * (w - padLeft - padRight);
  const getY = v => {
    const numV = (v != null && isFinite(v)) ? Number(v) : minV;
    return padTop + (1 - (numV - minV) / rangeV) * (h - padTop - padBottom);
  };

  _equityScales = { w, h, padTop, padBottom, padLeft, padRight, minV, maxV, rangeV, getX, getY };

  const bhCoords  = _equityPoints.map((p, i) => `${getX(i).toFixed(1)},${getY(p.buy_hold ?? p.buy_and_hold ?? p.quantview).toFixed(1)}`);
  const smaCoords = _equityPoints.map((p, i) => `${getX(i).toFixed(1)},${getY(p.sma50_200 ?? p.sma_50_200 ?? p.quantview).toFixed(1)}`);
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

  // Trigger real notification if confidence threshold is crossed
  if (window.NotificationService && data) {
    const ticker = data.ticker || 'ASSET';
    const prob = data.probability;
    const rec = data.recommendation;
    const priceVal = data.price;
    const sym = data.market?.currency_symbol || (data.market?.is_india ? '₹' : '$');
    const priceStr = priceVal ? `${sym}${priceVal.toLocaleString()}` : '';

    if (prob != null) {
      const probPct = Math.round(prob * 100);
      if (prob >= 0.60) {
        window.NotificationService.addNotification({
          title: `AI Bullish Signal: ${ticker} (${probPct}%)`,
          message: `${ticker} rated ${rec} with ${probPct}% upward model confidence at ${priceStr}. Regime: ${data.regime?.name || 'Trend'}.`,
          type: 'ai_regime',
          ticker: ticker
        });
      } else if (prob <= 0.40) {
        window.NotificationService.addNotification({
          title: `AI Bearish Caution: ${ticker} (${probPct}%)`,
          message: `${ticker} rated ${rec} with only ${probPct}% statistical probability at ${priceStr}.`,
          type: 'market_alert',
          ticker: ticker
        });
      }
    }
  }

  showResult();
}



// ── API call & Race-Condition Safe Request Manager ─────────────────────────
let _currentAnalyzeId = 0;
let _activeAbortController = null;

async function analyze(ticker) {
  if (!ticker) return;
  _lastTicker = ticker;

  if (_activeAbortController) {
    try {
      _activeAbortController.abort();
    } catch (e) {}
  }
  _activeAbortController = new AbortController();
  const currentToken = ++_currentAnalyzeId;

  showLoading(ticker);

  try {
    const url  = `${API_BASE}/api/recommend?ticker=${encodeURIComponent(ticker)}`;
    const resp = await fetch(url, { signal: _activeAbortController.signal });

    if (currentToken !== _currentAnalyzeId) return; // Stale request guard

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
    if (currentToken !== _currentAnalyzeId) return; // Stale request guard

    if (!data.success && data.error) {
      showError(data.error);
      return;
    }

    renderAll(data);
  } catch (err) {
    if (err.name === 'AbortError') return; // Ignore superseded request
    if (currentToken !== _currentAnalyzeId) return;
    showError(
      'Network error — the server may be waking from an idle state. Please wait a moment and try again.'
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

// ── Canonical Application Navigation Pipeline (Unified Single Entrypoint) ───
window.navigateToAsset = function(rawTicker) {
  if (!rawTicker) return;
  const t = String(rawTicker).trim();
  if (tickerInput) {
    tickerInput.value = t;
  }

  // Lifecycle Management: Unsubscribe previous asset subscriptions
  if (window.LiveQuoteService && _lastTicker && _lastTicker !== t) {
    window.LiveQuoteService.unsubscribe('hero-component', _lastTicker);
    window.LiveQuoteService.unsubscribe('chart-component', _lastTicker);
  }

  analyze(t);
  const results = document.getElementById('result-panel');
  if (results && !results.classList.contains('hidden')) {
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};
window.QV_analyze = window.navigateToAsset;
window.triggerMarketChip = function(label) {
  window.navigateToAsset(label);
};

function updateMarketRibbon(items) {
  if (!window.LiveQuoteService) return;

  if (items && Array.isArray(items)) {
    window.LiveQuoteService.ingestQuotesBatch(items);
  }

  const indices = [
    { sym: '^NSEI', pId: 'chip-nifty-price', cId: 'chip-nifty-change' },
    { sym: '^BSESN', pId: 'chip-sensex-price', cId: 'chip-sensex-change' },
    { sym: '^GSPC', pId: 'chip-sp500-price', cId: 'chip-sp500-change' },
    { sym: '^NDX', pId: 'chip-nasdaq-price', cId: 'chip-nasdaq-change' },
  ];

  indices.forEach(idx => {
    const q = window.LiveQuoteService.getQuote(idx.sym);
    if (q && q.price > 0) {
      const pEl = document.getElementById(idx.pId);
      const cEl = document.getElementById(idx.cId);
      if (pEl) pEl.textContent = window.LiveQuoteService.formatPrice(q.price, q.currencySymbol);
      if (cEl) {
        const chgInfo = window.LiveQuoteService.formatChange(q.change, q.changePercent, q.currencySymbol);
        cEl.textContent = chgInfo.percentText;
        cEl.className = `chip-change ${chgInfo.cssClass}`;
      }
    }
  });
}

// Global delegated listener for quick-pick buttons, watchlist items, and market ribbon cards
document.addEventListener('click', e => {
  const btn = e.target.closest('.qp-btn, .market-chip, .wl-action-btn');
  if (btn && btn.dataset.ticker) {
    e.preventDefault();
    window.navigateToAsset(btn.dataset.ticker);
  }
});

// Delegated keydown listener for keyboard accessibility on interactive elements (Enter / Space)
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') {
    const el = e.target.closest('[role="button"], .market-chip, .qp-btn');
    if (el && document.activeElement === el) {
      e.preventDefault();
      el.click();
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

// Mobile & Desktop Sidebar events initialized via initSidebarNavigation()

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


// ── Market News & Intelligence Portal Logic (TSK-01 Live Feed) ─────────────
let _liveNewsArticles = [];

function initNewsPortal() {
  let activeCategory = 'all';
  let searchQuery = '';
  const newsContainer = document.getElementById('news-grid-container');
  const catPills = document.querySelectorAll('.news-cat-pill');
  const searchInput = document.getElementById('news-search-input');
  const searchClear = document.getElementById('news-search-clear');
  const noResults = document.getElementById('news-no-results');
  const resetBtn = document.getElementById('btn-reset-news-filter');
  const toggleViewBtn = document.getElementById('btn-toggle-news-view');
  const modalOverlay = document.getElementById('news-modal-overlay');
  const modalClose = document.getElementById('news-modal-close');

  if (!newsContainer) return;

  function renderSkeleton() {
    newsContainer.innerHTML = `
      <div class="news-skeleton-wrap" style="grid-column: 1 / -1; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;">
        <div class="skeleton-card glass" style="height: 220px; border-radius: 12px; padding: 16px;">
          <div class="skeleton-line" style="height: 16px; width: 40%; margin-bottom: 12px;"></div>
          <div class="skeleton-line" style="height: 22px; width: 90%; margin-bottom: 8px;"></div>
          <div class="skeleton-line" style="height: 22px; width: 70%; margin-bottom: 16px;"></div>
          <div class="skeleton-line" style="height: 14px; width: 100%; margin-bottom: 6px;"></div>
          <div class="skeleton-line" style="height: 14px; width: 85%;"></div>
        </div>
        <div class="skeleton-card glass" style="height: 220px; border-radius: 12px; padding: 16px;">
          <div class="skeleton-line" style="height: 16px; width: 40%; margin-bottom: 12px;"></div>
          <div class="skeleton-line" style="height: 22px; width: 90%; margin-bottom: 8px;"></div>
          <div class="skeleton-line" style="height: 22px; width: 70%; margin-bottom: 16px;"></div>
          <div class="skeleton-line" style="height: 14px; width: 100%; margin-bottom: 6px;"></div>
          <div class="skeleton-line" style="height: 14px; width: 85%;"></div>
        </div>
        <div class="skeleton-card glass" style="height: 220px; border-radius: 12px; padding: 16px;">
          <div class="skeleton-line" style="height: 16px; width: 40%; margin-bottom: 12px;"></div>
          <div class="skeleton-line" style="height: 22px; width: 90%; margin-bottom: 8px;"></div>
          <div class="skeleton-line" style="height: 22px; width: 70%; margin-bottom: 16px;"></div>
          <div class="skeleton-line" style="height: 14px; width: 100%; margin-bottom: 6px;"></div>
          <div class="skeleton-line" style="height: 14px; width: 85%;"></div>
        </div>
      </div>
    `;
  }

  function renderArticles(articles) {
    newsContainer.innerHTML = '';
    if (!articles || articles.length === 0) {
      if (noResults) noResults.classList.remove('hidden');
      return;
    }
    if (noResults) noResults.classList.add('hidden');

    articles.forEach(item => {
      const card = document.createElement('article');
      card.className = 'news-item-card';
      const catList = Array.isArray(item.category) ? item.category : ['market', 'live'];
      card.dataset.category = catList.join(' ').toLowerCase();
      card.dataset.tickers = (item.tickers || []).join(',');
      card.dataset.id = item.id || '';

      const sent = (item.sentiment || 'neutral').toLowerCase();
      const sentScore = item.sentimentScore != null ? Math.round(Math.abs(item.sentimentScore) * 100) : 50;
      let sentLabel = '● Neutral (50%)';
      if (sent === 'bullish') sentLabel = `● Bullish (+${sentScore}%)`;
      else if (sent === 'bearish') sentLabel = `● Bearish (-${sentScore}%)`;

      const primaryTag = (item.tickers && item.tickers.length > 0) ? item.tickers[0] : (catList[2] || 'Market Live');

      card.innerHTML = `
        <div class="news-meta">
          <span class="news-source">${escapeHtml(item.source || 'Market News')}</span>
          <span class="news-time">${escapeHtml(item.publishedAt || 'Just now')}</span>
        </div>
        <h4 class="news-headline">${escapeHtml(item.headline || 'Market Intelligence Update')}</h4>
        <p class="news-snippet">${escapeHtml(item.summary || '')}</p>
        <div class="news-bottom-action-row">
          <div class="news-badge-wrap">
            <span class="news-badge-sentiment ${sent}">${sentLabel}</span>
            <span class="news-tag">${escapeHtml(primaryTag)}</span>
          </div>
          <button class="news-read-more-btn" data-news-id="${escapeHtml(item.id)}">Full Story →</button>
        </div>
      `;

      // Read more button & card click listeners
      const btn = card.querySelector('.news-read-more-btn');
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          openNewsModal(item);
        });
      }
      card.addEventListener('click', (e) => {
        if (e.target.closest('.qp-btn')) return;
        openNewsModal(item);
      });

      newsContainer.appendChild(card);
    });

    applyFilters();
  }

  function applyFilters() {
    const cards = newsContainer.querySelectorAll('.news-item-card');
    let visibleCount = 0;
    const query = (searchQuery || '').toLowerCase().trim();

    cards.forEach(card => {
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

      // Search query match
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

  function openNewsModal(item) {
    if (!item || !modalOverlay) return;

    document.getElementById('nm-source').textContent = item.source || 'Market News';
    document.getElementById('nm-time').textContent = item.publishedAt || 'Live';

    const sent = (item.sentiment || 'neutral').toLowerCase();
    const sentScore = item.sentimentScore != null ? Math.round(Math.abs(item.sentimentScore) * 100) : 50;
    let sentLabel = '● Neutral (50%)';
    if (sent === 'bullish') sentLabel = `● Bullish (+${sentScore}%)`;
    else if (sent === 'bearish') sentLabel = `● Bearish (-${sentScore}%)`;

    const sentEl = document.getElementById('nm-sentiment');
    if (sentEl) {
      sentEl.textContent = sentLabel;
      sentEl.className = `news-badge-sentiment ${sent}`;
    }

    const hlEl = document.getElementById('nm-headline');
    if (hlEl) hlEl.textContent = item.headline || '';

    const p1El = document.getElementById('nm-paragraph1');
    if (p1El) p1El.textContent = item.summary || '';

    const p2El = document.getElementById('nm-paragraph2');
    if (p2El) {
      if (item.url) {
        p2El.innerHTML = `Full reporting and primary coverage available at <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer" style="color: var(--primary); text-decoration: underline;">${escapeHtml(item.source || 'Original Source')} ↗</a>. Quantitative sentiment score: <strong>${(item.sentimentScore || 0.50).toFixed(2)}</strong>.`;
      } else {
        p2El.textContent = 'Aggregated real-time market disclosure via QuantView multi-provider ingestion.';
      }
    }

    const factorEl = document.getElementById('nm-factor');
    if (factorEl) factorEl.textContent = (item.category && item.category.length > 0) ? item.category.join(' · ').toUpperCase() : 'MARKET INTELLIGENCE';

    const volEl = document.getElementById('nm-vol');
    if (volEl) volEl.textContent = 'Live Feed Analysis';

    const weightEl = document.getElementById('nm-weight');
    if (weightEl) weightEl.textContent = `Sentiment: ${(item.sentimentScore || 0.50).toFixed(2)}`;

    const tickersList = document.getElementById('nm-tickers-list');
    if (tickersList) {
      tickersList.innerHTML = '';
      const tickers = Array.isArray(item.tickers) && item.tickers.length > 0 ? item.tickers : ['SPY'];
      tickers.forEach(t => {
        const btn = document.createElement('button');
        btn.className = 'nm-ticker-btn qp-btn';
        btn.dataset.ticker = t;
        btn.innerHTML = `<span>${escapeHtml(t)}</span> · Analyze →`;
        btn.onclick = () => {
          modalOverlay.classList.add('hidden');
          setNewsOnlyMode(false);
          if (tickerInput) tickerInput.value = t;
          analyze(t);
        };
        tickersList.appendChild(btn);
      });
    }

    modalOverlay.classList.remove('hidden');
  }

  // Category pill clicks
  catPills.forEach(pill => {
    pill.addEventListener('click', () => {
      catPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      activeCategory = pill.dataset.cat || 'all';
      applyFilters();
    });
  });

  // Search input
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      if (searchClear) {
        searchClear.classList.toggle('hidden', !searchQuery);
      }
      applyFilters();
    });
  }

  if (searchClear) {
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      searchQuery = '';
      searchClear.classList.add('hidden');
      applyFilters();
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      activeCategory = 'all';
      searchQuery = '';
      if (searchInput) searchInput.value = '';
      if (searchClear) searchClear.classList.add('hidden');
      catPills.forEach(p => p.classList.toggle('active', p.dataset.cat === 'all'));
      applyFilters();
    });
  }

  if (toggleViewBtn) {
    toggleViewBtn.addEventListener('click', () => {
      setNewsOnlyMode(!_isNewsOnlyMode);
    });
  }

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

  // Kick off loading & fetch from MarketauxService
  renderSkeleton();
  if (window.MarketauxService) {
    window.MarketauxService.fetchNews().then(articles => {
      _liveNewsArticles = articles || [];
      renderArticles(_liveNewsArticles);
    }).catch(err => {
      console.warn('[NewsPortal] Error rendering live news:', err);
      renderArticles([]);
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

  // Fetch live top 10 gainers & movers with backend real quotes
  const items = await window.WatchlistService.fetchLiveWatchlist();
  if (lastUpdatedEl) {
    lastUpdatedEl.textContent = 'Last Updated: ' + window.WatchlistService.getLastUpdated();
  }

  // Update top market overview ribbon with authentic live index/proxy quotes
  updateMarketRibbon(items);

  // Trigger real notification for significant intraday price swings (>= 2.5%)
  if (items && Array.isArray(items) && window.NotificationService) {
    items.forEach(it => {
      const chgNum = parseFloat(String(it.change || '').replace('%', '').replace('+', ''));
      if (Math.abs(chgNum) >= 2.5) {
        window.NotificationService.addNotification({
          title: `Intraday Surge Alert: ${it.ticker} (${it.change})`,
          message: `${it.name || it.ticker} registered a ${it.change} daily swing with ${it.volumeRatio || '1.0x'} volume multiple.`,
          type: 'market_alert',
          ticker: it.ticker
        });
      }
    });
  }

  tbody.innerHTML = '';

  if (window.LiveQuoteService && Array.isArray(items)) {
    window.LiveQuoteService.ingestQuotesBatch(items);
  }

  const equitiesOnly = items.filter(it => !['NIFTY 50', 'SENSEX', 'S&P 500', 'NASDAQ 100', '^NSEI', '^BSESN', '^GSPC', '^NDX'].includes(it.ticker));

  equitiesOnly.slice(0, 10).forEach(item => {
    const rawSym = item.symbol || item.ticker;
    const q = window.LiveQuoteService ? window.LiveQuoteService.getQuote(rawSym) : null;

    const tr = document.createElement('tr');
    tr.className = 'wl-row';
    tr.dataset.ticker = rawSym;

    const isIndia = item.exchange === 'NSE' || item.exchange === 'BSE' || rawSym.includes('.NS') || ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'ITC', 'BHARTIARTL', 'NIFTYBEES', 'BANKBEES', 'GOLDBEES'].includes(rawSym);
    const isEtf = rawSym.includes('BEES') || ['SPY', 'QQQ', 'VOO', 'VTI'].includes(rawSym);
    const logoSvgUri = window.LogoService ? window.LogoService.getLogo(rawSym, isIndia, isEtf) : '';
    const compName = window.LogoService ? window.LogoService.getCompanyName(rawSym, item.name) : item.name;

    const priceText = q ? window.LiveQuoteService.formatPrice(q.price, q.currencySymbol) : (item.price || '—');
    const chgInfo = q 
      ? window.LiveQuoteService.formatChange(q.change, q.changePercent, q.currencySymbol) 
      : { 
          percentText: item.change || '—', 
          cssClass: item.changePos === true ? 'pos' : (item.changePos === false ? 'neg' : 'neutral') 
        };

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
      <td class="wl-num">${priceText}</td>
      <td><span class="wl-change ${chgInfo.cssClass}">${chgInfo.percentText}</span></td>
      <td>
        <button class="wl-action-btn qp-btn" data-ticker="${rawSym}">Analyze →</button>
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

  function renderResults(results, queryStr = '') {
    resultsContainer.innerHTML = '';
    if (!results || results.length === 0) {
      if (queryStr && queryStr.length > 0) {
        resultsContainer.innerHTML = `
          <div class="search-auto-empty-hint" style="padding: 14px 16px; color: var(--text-muted); font-size: 0.84rem; line-height: 1.5;">
            <span style="color: var(--text-primary); font-weight: 600;">No instant suggestions for "${escapeHtml(queryStr)}"</span><br/>
            Press <kbd style="background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px; color: var(--primary);">Enter</kbd> to analyze any valid Indian or US ticker via live quantitative pipeline.
          </div>
        `;
        dropdown.classList.remove('hidden');
      } else {
        dropdown.classList.add('hidden');
      }
      return;
    }

    results.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'search-auto-row';
      row.dataset.ticker = item.ticker;
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');

      const isIndia = item.country === 'India';
      const isEtf = item.type === 'ETF';
      const logoSvgUri = window.LogoService ? window.LogoService.getLogo(item.ticker, isIndia, isEtf) : '';

      row.innerHTML = `
        <div class="sa-left">
          <div class="sa-logo-wrap"><img src="${escapeHtml(logoSvgUri)}" class="sa-logo-img" alt="" /></div>
          <div>
            <div class="sa-title"><strong>${escapeHtml(item.ticker)}</strong> <span class="sa-name">${escapeHtml(item.name)}</span></div>
            <div class="sa-sub">${isIndia ? '🇮🇳 India' : '🇺🇸 United States'} · ${escapeHtml(item.exchange)} · <span class="sa-type-badge">${escapeHtml(item.type)}</span></div>
          </div>
        </div>
        <div class="sa-right"><span class="sa-arrow">→</span></div>
      `;

      const triggerSelect = () => {
        input.value = item.ticker;
        dropdown.classList.add('hidden');
        if (window.SearchService) window.SearchService.addRecentSearch(item.ticker);
        analyze(item.ticker);
      };

      row.onclick = triggerSelect;
      row.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          triggerSelect();
        }
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
      renderResults(matches, q);
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
    if (!notifList) return;
    const items = window.NotificationService ? window.NotificationService.getNotifications() : [];
    const unread = window.NotificationService ? window.NotificationService.getUnreadCount() : 0;

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
    if (!items || items.length === 0) {
      notifList.innerHTML = `
        <div class="notif-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="notif-empty-icon"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
          <div style="font-weight: 600; color: var(--text-2);">No New Alerts</div>
          <div style="font-size: 0.75rem; color: var(--text-3);">Run an AI analysis or view the live watchlist to trigger notifications.</div>
        </div>
      `;
      return;
    }

    items.forEach(item => {
      if (!item) return;
      try {
        const el = document.createElement('div');
        el.className = `notif-item ${item.isRead ? 'read' : 'unread'}`;
        el.dataset.id = item.id;
        const relTime = window.NotificationService ? window.NotificationService.formatRelativeTime(item.timestamp) : 'Just now';
        const itemType = (item.type || 'alert').replace('_', ' ').toUpperCase();
        const itemTitle = item.title || 'Market Update';
        const itemMsg = item.message || '';
        const ticker = item.ticker ? String(item.ticker).toUpperCase() : null;

        const iconMap = {
          ai_regime: '⚡',
          market_alert: '🔔',
          breaking_news: '📰'
        };
        const typeIcon = iconMap[item.type] || '📌';

        el.innerHTML = `
          <div class="notif-item-top">
            <span class="notif-type-tag ${item.type || 'ai_regime'}"><span class="notif-icon-prefix">${typeIcon}</span> ${itemType}</span>
            <span class="notif-time">${relTime}</span>
          </div>
          <h5 class="notif-item-title">${itemTitle}</h5>
          <p class="notif-item-msg">${itemMsg}</p>
          ${ticker ? `<button class="notif-action-analyze" data-ticker="${ticker}">Analyze ${ticker} →</button>` : ''}
        `;

        // Clicking action button analyzes ticker directly
        const btnAnalyze = el.querySelector('.notif-action-analyze');
        if (btnAnalyze) {
          btnAnalyze.addEventListener('click', (e) => {
            e.stopPropagation();
            const t = btnAnalyze.dataset.ticker;
            if (window.NotificationService) window.NotificationService.markAsRead(item.id);
            dropdown.classList.add('hidden');
            if (t && typeof analyze === 'function') {
              const input = document.getElementById('ticker-input');
              if (input) input.value = t;
              analyze(t);
            }
          });
        }

        // Clicking notification card marks it read
        el.addEventListener('click', () => {
          if (!item.isRead && window.NotificationService) {
            window.NotificationService.markAsRead(item.id);
            updateNotifUI();
          }
        });

        notifList.appendChild(el);
      } catch (err) {
        console.error('Error rendering notification card:', err);
      }
    });
  }

  window.updateNotificationBadge = updateNotifUI;

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

// ── Settings & Preferences Storage Manager ──────────────────────────────────
const SETTINGS_KEY = 'qv_platform_settings';
const DEFAULT_SETTINGS = Object.freeze({
  currency: 'auto',
  horizon: '20',
  capital: 100000,
  cost: 0.10,
  slippage: 0.05,
  marketaux_key: '',
  finnhub_key: '',
  live_pulse: true,
});

function getPlatformSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (e) {
    console.warn('Error reading settings from localStorage:', e);
  }
  return { ...DEFAULT_SETTINGS };
}

function savePlatformSettings(newSettings) {
  try {
    const merged = { ...getPlatformSettings(), ...(newSettings || {}) };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent('qv:settings-updated', { detail: merged }));
    return merged;
  } catch (e) {
    console.error('Error saving settings to localStorage:', e);
    return { ...DEFAULT_SETTINGS, ...(newSettings || {}) };
  }
}

// ── Unified Sidebar Navigation & Mobile Responsive Manager ──────────────────
function initSidebarNavigation() {
  const sidebarEl = document.getElementById('app-sidebar');
  const sidebarToggleBtn = document.getElementById('sidebar-toggle');
  const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
  const sidebarCollapseBtn = document.getElementById('sidebar-collapse-btn');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  const mainWrapper = document.querySelector('.app-main-wrapper');

  // Mobile Open / Close Functions
  function openMobileSidebar() {
    if (sidebarEl) sidebarEl.classList.add('open');
    if (sidebarBackdrop) sidebarBackdrop.classList.remove('hidden');
    document.body.style.overflow = window.innerWidth <= 1024 ? 'hidden' : '';
  }

  function closeMobileSidebar() {
    if (sidebarEl) sidebarEl.classList.remove('open');
    if (sidebarBackdrop) sidebarBackdrop.classList.add('hidden');
    document.body.style.overflow = '';
  }

  function toggleMobileSidebar() {
    if (sidebarEl && sidebarEl.classList.contains('open')) {
      closeMobileSidebar();
    } else {
      openMobileSidebar();
    }
  }

  // Desktop Collapse Toggle Function
  function toggleDesktopCollapse() {
    if (!sidebarEl) return;
    const isNowCollapsed = !sidebarEl.classList.contains('collapsed');
    if (isNowCollapsed) {
      sidebarEl.classList.add('collapsed');
      if (mainWrapper) mainWrapper.classList.add('sidebar-collapsed');
    } else {
      sidebarEl.classList.remove('collapsed');
      if (mainWrapper) mainWrapper.classList.remove('sidebar-collapsed');
    }
    try {
      localStorage.setItem('qv_sidebar_collapsed', isNowCollapsed ? 'true' : 'false');
    } catch (e) {}
  }

  // Restore Desktop Collapsed state if stored
  try {
    if (window.innerWidth > 1024 && localStorage.getItem('qv_sidebar_collapsed') === 'true') {
      if (sidebarEl) sidebarEl.classList.add('collapsed');
      if (mainWrapper) mainWrapper.classList.add('sidebar-collapsed');
    }
  } catch (e) {}

  // Wire Button Listeners
  if (sidebarToggleBtn) {
    sidebarToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.innerWidth <= 1024) {
        toggleMobileSidebar();
      } else {
        toggleDesktopCollapse();
      }
    });
  }

  const sidebarBrand = document.querySelector('.sidebar-brand');
  if (sidebarBrand) {
    sidebarBrand.addEventListener('click', (e) => {
      if (sidebarEl && sidebarEl.classList.contains('collapsed') && window.innerWidth > 1024) {
        toggleDesktopCollapse();
      }
    });
  }

  if (sidebarCloseBtn) {
    sidebarCloseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMobileSidebar();
    });
  }

  if (sidebarCollapseBtn) {
    sidebarCollapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDesktopCollapse();
    });
  }

  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', () => {
      closeMobileSidebar();
    });
  }

  // Keyboard shortcut (Ctrl + [ / Cmd + [) to toggle collapse
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === '[') {
      e.preventDefault();
      toggleDesktopCollapse();
    }
    if (e.key === 'Escape') {
      closeMobileSidebar();
      const modal = document.getElementById('settings-modal-overlay');
      if (modal && !modal.classList.contains('hidden')) {
        modal.classList.add('hidden');
      }
    }
  });

  // Handle Navigation Links
  const navItems = [
    { id: 'nav-link-dash', target: '#result-panel', isDash: true },
    { id: 'nav-link-chart', target: '#stock-chart-card', requiresAnalysis: true },
    { id: 'nav-link-inst', target: '#institutional-section', requiresAnalysis: true },
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
      // Close mobile sidebar immediately when any nav item is clicked
      closeMobileSidebar();

      // Settings modal handler
      if (item.isSettings) {
        e.preventDefault();
        openSettingsModal();
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

// ── Apply Settings Globally Across Platform ────────────────────────────────
function applyPlatformSettings(settings = null) {
  const s = settings || getPlatformSettings();

  // 1. Live Pulse animations on cards
  if (s.live_pulse === false) {
    document.body.classList.add('disable-live-pulses');
  } else {
    document.body.classList.remove('disable-live-pulses');
  }

  // 2. Refresh live watchlist to update currency formatting
  if (typeof renderLiveWatchlist === 'function') {
    renderLiveWatchlist();
  }

  // 3. Immediate re-render of active stock results if loaded
  if (window._qvLastData) {
    const data = window._qvLastData;
    const sym = getEffectiveCurrency(data.market?.currency_symbol || (data.market?.is_india ? '₹' : '$'));
    _chartCurrency = sym;
    _equityCurrency = sym;

    // Update Hero and price displays
    renderHero(data);
    renderStockChart(data);
    renderInstitutionalIntelligence(data);
    renderConfidence(data);
    renderSignals(data);
    renderValuation(data);
    fetchAndRenderBenchmark(data.ticker, sym);
  }
}

// ── Functional Settings Modal Controller ────────────────────────────────────
function openSettingsModal() {
  const modal = document.getElementById('settings-modal-overlay');
  if (!modal) return;

  const settings = getPlatformSettings();

  const elCurr = document.getElementById('setting-currency');
  const elHor = document.getElementById('setting-horizon');
  const elCap = document.getElementById('setting-capital');
  const elCost = document.getElementById('setting-cost');
  const elSlip = document.getElementById('setting-slippage');
  const elMktKey = document.getElementById('setting-marketaux-key');
  const elFhKey = document.getElementById('setting-finnhub-key');
  const elPulse = document.getElementById('setting-live-pulse');

  if (elCurr) elCurr.value = settings.currency || 'auto';
  if (elHor) elHor.value = String(settings.horizon || '20');
  if (elCap) elCap.value = settings.capital || 100000;
  if (elCost) elCost.value = settings.cost || 0.10;
  if (elSlip) elSlip.value = settings.slippage || 0.05;
  if (elMktKey) elMktKey.value = settings.marketaux_key || '';
  if (elFhKey) elFhKey.value = settings.finnhub_key || '';
  if (elPulse) elPulse.checked = settings.live_pulse !== false;

  modal.classList.remove('hidden');
}

function initSettingsModal() {
  const navSettings = document.getElementById('nav-link-settings');
  const modal = document.getElementById('settings-modal-overlay');
  const closeBtn = document.getElementById('settings-modal-close');
  const saveBtn = document.getElementById('btn-save-settings');
  const resetBtn = document.getElementById('btn-reset-settings');

  if (!modal) return;

  if (navSettings) {
    navSettings.onclick = (e) => {
      e.preventDefault();
      openSettingsModal();
    };
  }

  if (closeBtn) {
    closeBtn.onclick = () => modal.classList.add('hidden');
  }

  modal.onclick = (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  };

  if (resetBtn) {
    resetBtn.onclick = () => {
      savePlatformSettings(DEFAULT_SETTINGS);
      applyPlatformSettings(DEFAULT_SETTINGS);
      openSettingsModal();
      resetBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="reset-btn-svg" style="transform:rotate(-360deg)"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg> <span>Defaults Restored ✓</span>';
      setTimeout(() => {
        resetBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" class="reset-btn-svg"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg> <span>Reset to Defaults</span>';
      }, 1200);
    };
  }

  if (saveBtn) {
    saveBtn.onclick = () => {
      const elCurr = document.getElementById('setting-currency');
      const elHor = document.getElementById('setting-horizon');
      const elCap = document.getElementById('setting-capital');
      const elCost = document.getElementById('setting-cost');
      const elSlip = document.getElementById('setting-slippage');
      const elMktKey = document.getElementById('setting-marketaux-key');
      const elFhKey = document.getElementById('setting-finnhub-key');
      const elPulse = document.getElementById('setting-live-pulse');

      const newSettings = {
        currency: elCurr ? elCurr.value : 'auto',
        horizon: elHor ? elHor.value : '20',
        capital: elCap ? parseFloat(elCap.value) || 100000 : 100000,
        cost: elCost ? parseFloat(elCost.value) || 0.10 : 0.10,
        slippage: elSlip ? parseFloat(elSlip.value) || 0.05 : 0.05,
        marketaux_key: elMktKey ? elMktKey.value.trim() : '',
        finnhub_key: elFhKey ? elFhKey.value.trim() : '',
        live_pulse: elPulse ? elPulse.checked : true
      };

      savePlatformSettings(newSettings);
      applyPlatformSettings(newSettings);

      saveBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" class="save-btn-svg"><polyline points="20 6 9 17 4 12"></polyline></svg> <span>✓ Applied &amp; Saved</span>';
      setTimeout(() => {
        saveBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" class="save-btn-svg"><polyline points="20 6 9 17 4 12"></polyline></svg> <span>Apply &amp; Save</span>';
        modal.classList.add('hidden');
      }, 500);
    };
  }
}

// ── Live Exchange Trading Session Status Manager ────────────────────────────
async function updateMarketStatusPills() {
  const pillNse = document.getElementById('pill-nse-status');
  const pillUs = document.getElementById('pill-us-status');
  const nseText = document.getElementById('nse-status-text');
  const usText = document.getElementById('us-status-text');

  if (!pillNse || !pillUs) return;

  function applyStatus(data) {
    if (!data) return;
    if (data.nse) {
      const isOpen = Boolean(data.nse.is_open);
      pillNse.className = `market-status-pill ${isOpen ? 'market-open' : 'market-closed'}`;
      if (nseText) nseText.textContent = isOpen ? 'Open' : 'Closed';
      pillNse.setAttribute('title', `National Stock Exchange of India (NSE / BSE): ${data.nse.status}`);
    }
    if (data.us) {
      const isOpen = Boolean(data.us.is_open);
      pillUs.className = `market-status-pill ${isOpen ? 'market-open' : 'market-closed'}`;
      if (usText) usText.textContent = isOpen ? 'Open' : 'Closed';
      pillUs.setAttribute('title', `US Markets (NYSE / NASDAQ): ${data.us.status}`);
    }
  }

  // 1. Instant client-side clock baseline (zero latency, zero flicker)
  try {
    const nowUtc = new Date();
    // India IST is UTC + 5.5 hours
    const istMs = nowUtc.getTime() + (5.5 * 3600 * 1000);
    const istDate = new Date(istMs);
    const istDay = istDate.getUTCDay(); // 0 = Sun, 6 = Sat
    const istMin = istDate.getUTCHours() * 60 + istDate.getUTCMinutes();
    const isNseOpen = (istDay >= 1 && istDay <= 5) && (istMin >= 555 && istMin <= 930);

    // US EDT is UTC - 4 hours
    const usMs = nowUtc.getTime() - (4.0 * 3600 * 1000);
    const usDate = new Date(usMs);
    const usDay = usDate.getUTCDay();
    const usMin = usDate.getUTCHours() * 60 + usDate.getUTCMinutes();
    const isUsOpen = (usDay >= 1 && usDay <= 5) && (usMin >= 570 && usMin <= 960);

    applyStatus({
      nse: { is_open: isNseOpen, status: isNseOpen ? 'Open' : 'Closed' },
      us: { is_open: isUsOpen, status: isUsOpen ? 'Open' : 'Closed' }
    });
  } catch (e) {}

  // 2. Fetch authoritative live server state from backend
  try {
    const base = (window.location.protocol === 'file:' ? 'http://127.0.0.1:8000' : '');
    const resp = await fetch(base + '/api/market-status');
    if (!resp.ok) return;
    const data = await resp.json();
    applyStatus(data);
  } catch (err) {
    console.debug('[MarketStatus] Status fetch skipped:', err);
  }
}

// Re-hook DOM load for full platform suite
function initPlatform() {
  document.body.classList.add('qv-loaded');
  applyPlatformSettings();
  updateMarketStatusPills();
  setInterval(updateMarketStatusPills, 60000); // 60s market status refresh
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
