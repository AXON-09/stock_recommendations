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
  let exchName = mkt.exchange || '—';
  if (!exchName || exchName.toUpperCase() === 'UNKNOWN') {
    exchName = mkt.is_india ? 'NSE' : (mkt.currency === 'USD' ? 'NASDAQ / NYSE' : (mkt.country || 'Global'));
  }
  document.getElementById('mb-exchange').textContent = exchName;
  document.getElementById('mb-country').textContent  = mkt.country  || (mkt.is_india ? 'India' : (mkt.currency === 'USD' ? 'United States' : '—'));
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
  renderConfidence(data);
  renderModels(data);
  renderExplanation(data);
  renderSignals(data);
  renderRegime(data);
  renderVolatility(data);
  renderValuation(data);
  fetchAndRenderBenchmark(data.ticker, data.market?.currency_symbol || (data.market?.is_india ? '₹' : '$'));
  renderBacktest(data);
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

// Global delegated listener for quick-pick buttons (including watchlist and ticker buttons)
document.addEventListener('click', e => {
  const btn = e.target.closest('.qp-btn');
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

