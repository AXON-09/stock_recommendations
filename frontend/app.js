/* =============================================================================
   QuantView AI — app.js v3.0
   Multi-market support: India (NSE/BSE) + US
   All prices, ATR, etc. use currency from the API response.
============================================================================= */

const API_BASE = '';   // same origin (served by FastAPI)

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
  loadingState.classList.remove('hidden');
  errorState.classList.add('hidden');
  resultPanel.classList.add('hidden');
  analyzeBtn.disabled = true;

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
  clearInterval(_timerInterval);
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
  errorState.classList.add('hidden');
  resultPanel.classList.remove('hidden');
  resultPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Render functions ──────────────────────────────────────────────────────────

function renderHero(data) {
  const mkt = data.market;
  const sym = mkt.currency_symbol || '$';

  // Ticker + market badge
  document.getElementById('res-ticker').textContent = data.display_ticker || data.ticker;

  const badge = document.getElementById('market-badge');
  document.getElementById('mb-exchange').textContent = mkt.exchange || '—';
  document.getElementById('mb-country').textContent  = mkt.country  || '—';
  badge.className = 'market-badge';
  if (mkt.is_india) badge.classList.add('india');
  else if (mkt.currency === 'USD') badge.classList.add('us');

  // ETF badge segment — only shown when the ticker is genuinely an ETF/fund
  const etfWrap = document.getElementById('mb-etf-wrap');
  etfWrap.classList.toggle('hidden', !mkt.is_etf);

  // Sector / category line — for ETFs, show a real classification (never
  // a bare "Unknown") when Yahoo Finance supplies enough metadata; only
  // fall back to a generic ETF label when it genuinely doesn't.
  const sectorEl = document.getElementById('res-sector');
  if (mkt.is_etf) {
    sectorEl.textContent = mkt.etf_category || 'Exchange-Traded Fund';
  } else {
    sectorEl.textContent = data.sector || 'Unknown';
  }

  // Price — currency-aware
  document.getElementById('res-price').textContent = currency(data.price, sym);

  // Recommendation badge
  const recBadge = document.getElementById('rec-badge');
  const rec = data.recommendation;
  recBadge.textContent = rec.toUpperCase();
  recBadge.className   = `rec-badge ${rec.toLowerCase()}`;

  document.getElementById('res-prob').textContent = pct(data.probability);

  // Cache note
  const cache = data.cache;
  const cacheEl = document.getElementById('cache-note');
  if (cache) {
    cacheEl.textContent = cache.hit
      ? `Cached · trained ${cache.trained_at ? new Date(cache.trained_at).toLocaleTimeString() : '—'} · data through ${cache.data_through || '—'}`
      : `Fresh · data through ${cache.data_through || '—'}`;
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

  // LSTM note
  const lstmNote = document.getElementById('lstm-note');
  if (!lstm.available) {
    lstmNote.textContent = `LSTM disabled — ${lstm.reason || 'dependency unavailable'}. Ensemble uses XGBoost only.`;
  } else {
    lstmNote.textContent = '';
  }

  // Stacking coefficients note
  const coeffNote = document.getElementById('coeff-note');
  if (bt && bt.xgb_coefficient != null) {
    const lstmPart = bt.lstm_coefficient != null
      ? `, LSTM: ${bt.lstm_coefficient.toFixed(3)}`
      : '';
    coeffNote.textContent =
      `Stack coefs — XGB: ${bt.xgb_coefficient.toFixed(3)}${lstmPart} ` +
      `(logistic regression coefs, not percentage weights)`;
  } else {
    coeffNote.textContent = '';
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
  Object.entries(LABELS).forEach(([key, label]) => {
    const val      = signals[key] || 'unavailable';
    const cssClass = SIG_CLASS[val] || 'sig-unavailable';
    const dispVal  = val === 'not_applicable' ? 'N/A' : (val.charAt(0).toUpperCase() + val.slice(1).replace(/_/g, ' '));
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
    : 'N/A';
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

  if (val.is_etf || val.signal === 'not_applicable') {
    // Do not force stock valuation metrics onto ETFs — show N/A on every
    // row plus an explanation, rather than hiding the card entirely.
    peEl.textContent  = 'Not applicable for ETFs';
    speEl.textContent = 'Not applicable for ETFs';
    relEl.textContent = 'Not applicable for ETFs';
    peEl.style.color = speEl.style.color = relEl.style.color = 'var(--text-3)';
    peerLbl.textContent = val.note || 'Valuation metrics are not meaningful for a fund holding a basket of assets.';
    return;
  }

  peEl.textContent  = val.pe_ratio  != null ? num(val.pe_ratio,  1) : 'N/A';
  speEl.textContent = val.peer_pe   != null ? num(val.peer_pe,   1) : 'N/A';
  peEl.style.color = speEl.style.color = 'var(--text-1)';

  if (val.pe_relative_pct != null) {
    const sign = val.pe_relative_pct > 0 ? '+' : '';
    relEl.textContent = `${sign}${num(val.pe_relative_pct, 1)}%`;
    relEl.style.color = val.pe_relative_pct > 15 ? 'var(--red)'
                      : val.pe_relative_pct < -15 ? 'var(--green)'
                      : 'var(--text-2)';
  } else {
    relEl.textContent = 'N/A';
    relEl.style.color = 'var(--text-2)';
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

// ── Main render ───────────────────────────────────────────────────────────────
function renderAll(data) {
  // Expose the latest response so info-popover "dynamic" content (e.g. the
  // live RSI vs adaptive-threshold readout) can reference current values.
  window._qvLastData = data;

  renderHero(data);
  renderConfidence(data);
  renderModels(data);
  renderSignals(data);
  renderRegime(data);
  renderVolatility(data);
  renderValuation(data);
  renderBacktest(data);
  renderDisclaimer(data);

  // Re-scan the whole result panel for any info-buttons not already bound
  // (the static ones in index.html only need this once, but it's cheap and
  // safe to repeat on every render).
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

// ── Event listeners ───────────────────────────────────────────────────────────
analyzeBtn.addEventListener('click', () => {
  const t = tickerInput.value.trim().toUpperCase();
  if (t) analyze(t);
});

tickerInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const t = tickerInput.value.trim().toUpperCase();
    if (t) analyze(t);
  }
});

document.querySelectorAll('.qp-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const t = btn.dataset.ticker;
    tickerInput.value = t;
    analyze(t);
  });
});

errorRetry.addEventListener('click', () => {
  if (_lastTicker) analyze(_lastTicker);
});
