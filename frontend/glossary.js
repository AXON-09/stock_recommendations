/* =============================================================================
   QuantView AI — glossary.js
   Single source of truth for every metric explanation shown via the ⓘ
   info popovers. Do NOT hardcode explanations elsewhere — read from here.

   Each entry:
     title                 — shown in the popover header
     what_it_is             — plain definition
     how_to_interpret       — what higher/lower values mean
     how_quantview_uses_it  — how THIS app specifically uses the metric
     range_or_units         — e.g. "0–100", "% of price"
     caution                — what NOT to conclude from it
     dynamic(data)          — OPTIONAL function(data) => HTML string of
                               live values for the currently loaded ticker.
                               `data` is the last /api/recommend response.
                               Must be defensive — data or fields may be
                               missing/null.
============================================================================= */

function _fmtPct(v, digits = 1) {
  return v != null && isFinite(v) ? `${(v * 100).toFixed(digits)}%` : 'N/A';
}
function _fmtNum(v, digits = 2) {
  return v != null && isFinite(v) ? Number(v).toFixed(digits) : 'N/A';
}

const QV_GLOSSARY = {

  // ── Signal breakdown ───────────────────────────────────────────────────
  rsi: {
    title: 'RSI — Relative Strength Index',
    what_it_is:
      'Measures recent price momentum on a 0–100 scale, based on the size ' +
      'of recent gains versus recent losses.',
    how_to_interpret:
      'Traditionally, RSI below 30 is considered "oversold" and above 70 ' +
      '"overbought". Lower values indicate weaker recent momentum; higher ' +
      'values indicate stronger recent momentum.',
    how_quantview_uses_it:
      'QuantView does not blindly use the fixed 30/70 levels. It compares ' +
      'RSI against volatility-adaptive thresholds that widen for high-volatility ' +
      'assets and narrow for low-volatility ones, so normal price swings in a ' +
      'volatile stock don\u2019t trigger false signals.',
    range_or_units: '0–100',
    caution:
      'RSI is not a guarantee that price will reverse. It describes recent ' +
      'momentum, not a prediction.',
    dynamic(data) {
      const v = data && data.volatility;
      if (!v) return '';
      const rsi = v.rsi, buy = v.rsi_buy_threshold, sell = v.rsi_sell_threshold;
      let interp = 'Current RSI is between the adaptive buy and sell thresholds.';
      if (rsi != null && buy != null && sell != null) {
        if (rsi < buy) interp = 'Current RSI is below the adaptive buy threshold.';
        else if (rsi > sell) interp = 'Current RSI is above the adaptive sell threshold.';
      }
      return `
        <div class="info-dynamic">
          <div class="info-dyn-row"><span>Current RSI</span><b>${_fmtNum(rsi, 1)}</b></div>
          <div class="info-dyn-row"><span>Adaptive Buy</span><b>${_fmtNum(buy, 1)}</b></div>
          <div class="info-dyn-row"><span>Adaptive Sell</span><b>${_fmtNum(sell, 1)}</b></div>
          <p class="info-dyn-note">${interp}</p>
        </div>`;
    },
  },

  trend: {
    title: 'Trend (SMA)',
    what_it_is:
      'A three-vote check of whether price is above its 50-day moving average, ' +
      'above its 200-day moving average, and whether the 200-day average itself ' +
      'is sloping upward.',
    how_to_interpret:
      'All three conditions agreeing (unanimous) gives a clear bullish or bearish ' +
      'read. When the three conditions disagree with each other, that\u2019s reported ' +
      'as neutral — there isn\u2019t a single clean trend to point to.',
    how_quantview_uses_it:
      'QuantView requires unanimous agreement across all three votes before ' +
      'calling a trend bullish or bearish, specifically so that "neutral" reflects ' +
      'genuinely mixed conditions rather than being an unreachable label.',
    range_or_units: 'Bullish / Bearish / Neutral',
    caution:
      'A trend label describes recent price structure, not a forecast of what ' +
      'happens next.',
  },

  macd: {
    title: 'MACD — Moving Average Convergence/Divergence',
    what_it_is:
      'A momentum/trend-following indicator: the difference between a fast ' +
      '(12-day) and slow (26-day) exponential moving average, compared against ' +
      'a 9-day signal line of that difference.',
    how_to_interpret:
      'A positive MACD histogram (MACD above its signal line) is generally read ' +
      'as bullish momentum; negative is generally read as bearish momentum.',
    how_quantview_uses_it:
      'QuantView uses the sign of the MACD-minus-signal difference as one input ' +
      'to the signal breakdown, and the raw value as an ML feature for the ' +
      'XGBoost/LSTM models.',
    range_or_units: 'Native price units (can be positive or negative)',
    caution:
      'MACD can lag fast-moving markets since it\u2019s built from moving averages.',
  },

  momentum: {
    title: 'Momentum (20-Day Return)',
    what_it_is:
      'The asset\u2019s raw percentage price change over the last 20 trading days, ' +
      'normalised by recent volatility.',
    how_to_interpret:
      'Positive normalised momentum means the asset has moved up more than its ' +
      'typical volatility would suggest by chance; negative means the opposite.',
    how_quantview_uses_it:
      'QuantView normalises the raw 20-day return by the asset\u2019s own volatility ' +
      'before classifying it as bullish/bearish/neutral, so a "big" move in a ' +
      'volatile asset isn\u2019t treated the same as a big move in a quiet one.',
    range_or_units: 'Normalised, clipped to ±3',
    caution:
      'Momentum measures what already happened, not what will happen next.',
  },

  volume: {
    title: 'Volume',
    what_it_is:
      'Today\u2019s trading volume compared to the asset\u2019s 20-day average volume.',
    how_to_interpret:
      'A ratio above 1.5× average is labelled "elevated" (unusually high ' +
      'activity); below 0.7× is labelled "low"; in between is "normal".',
    how_quantview_uses_it:
      'QuantView includes the volume ratio as an ML feature and as a standalone ' +
      'signal-breakdown row, since unusual volume can indicate the market is ' +
      'reacting to new information.',
    range_or_units: 'Ratio (1.0 = exactly average)',
    caution:
      'Elevated volume shows something notable is happening — it does not by ' +
      'itself say whether that\u2019s bullish or bearish.',
  },

  valuation: {
    title: 'Valuation (P/E-based)',
    what_it_is:
      'A comparison of the asset\u2019s price-to-earnings (P/E) ratio against a ' +
      'peer/sector median P/E.',
    how_to_interpret:
      'A P/E meaningfully below the peer median is labelled "undervalued"; ' +
      'meaningfully above is "overvalued"; close to the median is "fair".',
    how_quantview_uses_it:
      'This is a LIVE, rule-based signal only. It is intentionally NOT fed to ' +
      'the ML models, because point-in-time historical P/E data isn\u2019t available ' +
      '— using today\u2019s P/E for historical training rows would leak future ' +
      'information into the model.',
    range_or_units: 'undervalued / fair / overvalued / unavailable / not applicable',
    caution:
      'Valuation says nothing about timing. A stock can stay "overvalued" or ' +
      '"undervalued" by this measure for a long time.',
  },

  // ── Market regime ──────────────────────────────────────────────────────
  adx: {
    title: 'ADX — Average Directional Index',
    what_it_is:
      'Measures the STRENGTH of a trend, on a 0–100 scale. It does not, by ' +
      'itself, say whether the trend is up or down.',
    how_to_interpret:
      'Higher ADX generally means a stronger (more decisive) trend, regardless ' +
      'of direction. Low ADX suggests a directionless, choppy market.',
    how_quantview_uses_it:
      'QuantView combines ADX with price-vs-SMA200 and the SMA200 slope to ' +
      'classify the market regime as trending up, trending down, or choppy. ' +
      'ADX above 25 combined with the other two conditions agreeing is required ' +
      'for a "trending" classification.',
    range_or_units: '0–100',
    caution:
      'ADX does not tell you whether the trend is bullish or bearish by itself ' +
      '— pair it with +DI/-DI or price direction for that.',
  },

  di: {
    title: '+DI / -DI — Directional Indicators',
    what_it_is:
      'Two companion lines to ADX that measure upward (+DI) and downward (-DI) ' +
      'directional price pressure.',
    how_to_interpret:
      '+DI above -DI suggests upward pressure is currently dominant; -DI above ' +
      '+DI suggests downward pressure is dominant.',
    how_quantview_uses_it:
      'QuantView requires +DI > -DI (with price above a rising SMA200) for a ' +
      '"trending up" regime, and the mirror image for "trending down".',
    range_or_units: '0–100 each',
    caution:
      '+DI/-DI show directional pressure, not trend strength — that\u2019s what ADX is for.',
  },

  sma200_slope: {
    title: 'SMA200 Slope',
    what_it_is:
      'The percentage change in the 200-day simple moving average (SMA200) ' +
      'over the last 20 trading days — i.e. whether the long-term average ' +
      'itself is rising or falling.',
    how_to_interpret:
      'A positive slope means the long-term trend is rising; negative means ' +
      'it\u2019s falling; near-zero means the long-term average is roughly flat.',
    how_quantview_uses_it:
      'Used both in regime detection (alongside ADX and price-vs-SMA200) and ' +
      'in the SMA trend-vote signal.',
    range_or_units: '% over 20 trading days',
    caution:
      'Because SMA200 is a 200-day average, its slope reacts slowly — it will ' +
      'lag a sharp recent reversal.',
  },

  regime_clarity: {
    title: 'Regime Clarity',
    what_it_is:
      'A 0–1 score for how clearly the current market fits its assigned regime ' +
      '(trending up / trending down / choppy).',
    how_to_interpret:
      'Higher values mean the regime classification is more clear-cut; lower ' +
      'values mean it\u2019s a borderline case.',
    how_quantview_uses_it:
      'For trending regimes, clarity scales with ADX (saturating at ADX=50). ' +
      'For choppy regimes, clarity is highest when ADX is very low (a clearly ' +
      'directionless market) and falls as ADX approaches the trending threshold.',
    range_or_units: '0–1',
    caution:
      'This measures confidence in the regime LABEL, not confidence in the ' +
      'trading recommendation itself.',
  },

  choppy_shrink: {
    title: 'Choppy Shrink',
    what_it_is:
      'A deliberate adjustment that pulls the model\u2019s probability output ' +
      'toward 50% (neutral) when the market regime is "choppy".',
    how_to_interpret:
      'The raw model probability is blended toward 0.5 by a fixed factor — ' +
      'currently 55%, meaning the final probability moves 45% of the way back ' +
      'toward neutral from its raw value.',
    how_quantview_uses_it:
      'QuantView shrinks probabilities in choppy markets because choppy/' +
      'directionless conditions generally provide weaker directional evidence, ' +
      'and the models\u2019 historical accuracy is lower in these conditions.',
    range_or_units: 'Shrink factor (0–1); lower = more shrinkage',
    caution:
      'Shrinkage makes the recommendation more conservative in choppy markets ' +
      '— it does not mean the underlying trend has actually reversed.',
    dynamic(data) {
      const r = data && data.regime;
      const m = data && data.models;
      if (!r || !m) return '';
      if (r.name !== 'choppy') {
        return `<div class="info-dynamic"><p class="info-dyn-note">Regime is currently "${r.name.replace('_', ' ')}" — shrinkage does not apply.</p></div>`;
      }
      const raw = m.ensemble_probability; // Note: ensemble_probability here is already post-shrink in the API
      return `
        <div class="info-dynamic">
          <p class="info-dyn-note">Regime is currently Choppy — the ensemble probability shown elsewhere on this page already includes the shrinkage adjustment.</p>
        </div>`;
    },
  },

  // ── Volatility ──────────────────────────────────────────────────────────
  ann_vol: {
    title: 'Annualised Volatility',
    what_it_is:
      'An annualised estimate of how much the asset\u2019s daily returns typically ' +
      'vary, based on the standard deviation of the last 20 daily returns.',
    how_to_interpret:
      'Higher annualised volatility means bigger typical day-to-day price ' +
      'swings; lower means calmer, steadier price action.',
    how_quantview_uses_it:
      'This is the basis for the volatility-adaptive RSI thresholds and one ' +
      'component of the confidence score (higher volatility → lower confidence, ' +
      'all else equal).',
    range_or_units: '% per year',
    caution:
      'High volatility does not automatically mean bullish or bearish — it ' +
      'measures the SIZE of price swings, not their direction.',
  },

  atr: {
    title: 'ATR — Average True Range',
    what_it_is:
      'ATR estimates the typical absolute daily trading range in the asset\u2019s ' +
      'native currency, smoothed over 14 days.',
    how_to_interpret:
      'A higher ATR means the asset typically moves a larger absolute amount ' +
      'per day.',
    how_quantview_uses_it:
      'ATR (as ATR%) feeds both the confidence score\u2019s volatility component ' +
      'and the ML feature set.',
    range_or_units: 'Native currency units per day',
    caution:
      'ATR is an absolute measure — comparing raw ATR across assets with very ' +
      'different prices is misleading; use ATR% for that instead.',
  },

  atr_pct: {
    title: 'ATR %',
    what_it_is: 'ATR divided by the current price, expressed as a percentage.',
    how_to_interpret:
      'Higher ATR% means the asset typically moves a larger share of its own ' +
      'price each day — i.e. it\u2019s relatively more volatile.',
    how_quantview_uses_it:
      'ATR% is the basis for the confidence score\u2019s volatility component: ' +
      'lower ATR% increases confidence, higher ATR% reduces it.',
    range_or_units: '% of price',
    caution:
      'High volatility does not automatically mean bullish or bearish.',
  },

  adaptive_buy: {
    title: 'Adaptive Buy Threshold',
    what_it_is:
      'The asset-specific RSI level below which RSI is read as "bullish" by ' +
      'QuantView, adjusted for the asset\u2019s own volatility.',
    how_to_interpret:
      'A lower adaptive buy threshold (further from the 30 baseline) means the ' +
      'asset needs to look more oversold, in raw RSI terms, before QuantView ' +
      'calls it bullish.',
    how_quantview_uses_it:
      'High-volatility assets get a WIDER band (lower buy threshold, higher ' +
      'sell threshold) so normal swings aren\u2019t misread as reversal signals.',
    range_or_units: 'RSI points, bounded to [15, 45]',
    caution: 'This threshold adapts per-asset — it is not the traditional fixed value of 30.',
  },

  adaptive_sell: {
    title: 'Adaptive Sell Threshold',
    what_it_is:
      'The asset-specific RSI level above which RSI is read as "bearish" by ' +
      'QuantView, adjusted for the asset\u2019s own volatility.',
    how_to_interpret:
      'A higher adaptive sell threshold (further from the 70 baseline) means ' +
      'the asset needs to look more overbought before QuantView calls it bearish.',
    how_quantview_uses_it:
      'High-volatility assets get a WIDER band (lower buy threshold, higher ' +
      'sell threshold) so normal swings aren\u2019t misread as reversal signals.',
    range_or_units: 'RSI points, bounded to [55, 85]',
    caution: 'This threshold adapts per-asset — it is not the traditional fixed value of 70.',
  },

  // ── Valuation detail ─────────────────────────────────────────────────────
  pe_ratio: {
    title: 'P/E Ratio',
    what_it_is: 'Price relative to trailing (or forward, if trailing is unavailable) earnings per share.',
    how_to_interpret:
      'A higher P/E means investors are paying more per unit of current earnings ' +
      '— often reflecting higher growth expectations (or overvaluation).',
    how_quantview_uses_it:
      'Shown as a live, rule-based signal and compared to a peer/sector median. ' +
      'It is NOT used as a historical ML training feature, because point-in-time ' +
      'historical fundamentals are unavailable from the data source.',
    range_or_units: 'Ratio (dimensionless)',
    caution: 'P/E is not meaningful for ETFs, unprofitable companies, or across very different sectors.',
  },

  peer_pe: {
    title: 'Peer Median P/E',
    what_it_is: 'The median trailing P/E among a curated set of peers in the same sector/market.',
    how_to_interpret:
      'This is the benchmark QuantView compares the asset\u2019s own P/E against.',
    how_quantview_uses_it:
      'For India, this is the median P/E of a curated list of Indian sector ' +
      'peers. For the US, it uses the relevant sector ETF\u2019s reported P/E as a ' +
      'proxy.',
    range_or_units: 'Ratio (dimensionless)',
    caution: 'This is a live snapshot, not a historical or point-in-time value — it changes as peer earnings/prices change.',
  },

  relative_pe: {
    title: 'Relative P/E',
    what_it_is: 'How far the asset\u2019s P/E sits above or below the peer median P/E, as a percentage.',
    how_to_interpret:
      'A large positive value means the asset trades at a meaningful premium ' +
      'to its peers; a large negative value means a meaningful discount.',
    how_quantview_uses_it:
      'QuantView labels the valuation signal "overvalued" / "undervalued" / ' +
      '"fair" based on this relative gap (±15% thresholds).',
    range_or_units: '%',
    caution: 'A valuation gap can persist for a long time and is not a timing signal on its own.',
  },

  // ── ML models ─────────────────────────────────────────────────────────
  xgboost: {
    title: 'XGBoost',
    what_it_is:
      'A gradient-boosted decision-tree model trained on the current tabular ' +
      'feature snapshot (RSI, ADX, MACD, volume ratio, price-vs-SMA, etc).',
    how_to_interpret:
      'Its output is a probability (0–1) that the asset\u2019s price will be higher ' +
      'in ~20 trading sessions.',
    how_quantview_uses_it:
      'Trained with walk-forward validation and a purge/embargo period to avoid ' +
      'look-ahead bias. Its output feeds into the logistic stacking layer ' +
      'alongside LSTM (when available).',
    range_or_units: 'Probability, 0–100%',
    caution: 'A single model\u2019s probability is not, by itself, the final recommendation — see Ensemble.',
  },

  lstm: {
    title: 'LSTM — Long Short-Term Memory',
    what_it_is:
      'A sequence model that looks at the last 60 trading days of features as ' +
      'an ordered sequence, rather than a single snapshot, to recognise ' +
      'historical patterns.',
    how_to_interpret:
      'Its output is a probability (0–1) that the asset\u2019s price will be higher ' +
      'in ~20 trading sessions, informed by the recent sequence of conditions.',
    how_quantview_uses_it:
      'LSTM requires PyTorch. When PyTorch is unavailable, LSTM probability is ' +
      'reported as unavailable (never as a fabricated 0.5), and the ensemble ' +
      'automatically falls back to XGBoost-only mode.',
    range_or_units: 'Probability, 0–100%, or "Unavailable"',
    caution: 'When unavailable, no LSTM number is shown or implied anywhere in this app.',
  },

  ensemble: {
    title: 'Ensemble',
    what_it_is:
      'The final combined probability, produced by feeding the individual ' +
      'model outputs (XGBoost, and LSTM when available) into a logistic ' +
      'regression stacking layer.',
    how_to_interpret:
      'This is the probability actually used for the Buy/Sell/Hold decision, ' +
      'after any choppy-regime shrinkage is applied.',
    how_quantview_uses_it:
      'The stacking layer is trained on out-of-fold predictions from walk-' +
      'forward validation, which provides partial (not guaranteed) calibration.',
    range_or_units: 'Probability, 0–100%',
    caution: 'A probability near 50% reflects genuine model uncertainty, not a data error.',
  },

  xgb_coefficient: {
    title: 'XGB Coefficient',
    what_it_is:
      'The logistic regression stacking layer\u2019s coefficient applied to the ' +
      'XGBoost probability input.',
    how_to_interpret:
      'A larger positive coefficient means the stacking layer relies more on ' +
      'XGBoost\u2019s output when forming the final ensemble probability.',
    how_quantview_uses_it:
      'These are coefficients learned by the logistic stacking layer. They are ' +
      'NOT percentage contributions or weights that sum to 100% — they are raw ' +
      'logistic regression coefficients.',
    range_or_units: 'Unitless (can be positive or negative)',
    caution: 'Do not read this as "XGBoost is responsible for X% of the decision".',
  },

  lstm_coefficient: {
    title: 'LSTM Coefficient',
    what_it_is:
      'The logistic regression stacking layer\u2019s coefficient applied to the ' +
      'LSTM probability input, when LSTM is available.',
    how_to_interpret:
      'A larger positive coefficient means the stacking layer relies more on ' +
      'LSTM\u2019s output. This is None/absent when LSTM is unavailable.',
    how_quantview_uses_it:
      'These are coefficients learned by the logistic stacking layer. They are ' +
      'NOT percentage contributions or weights.',
    range_or_units: 'Unitless (can be positive or negative), or "N/A" when LSTM is unavailable',
    caution: 'Do not read this as "LSTM is responsible for X% of the decision".',
  },

  // ── Confidence ────────────────────────────────────────────────────────
  confidence: {
    title: 'Confidence',
    what_it_is:
      'A composite 0–100 score built from five components: probability ' +
      'strength, volatility, data quality, regime clarity, and model agreement.',
    how_to_interpret:
      'Confidence is NOT the probability that the recommendation will be ' +
      'correct. It reflects how clear and well-supported the current signal is ' +
      '— not the odds of a profitable outcome.',
    how_quantview_uses_it:
      'When LSTM is unavailable, the model-agreement component is excluded ' +
      'entirely (never fabricated) and the remaining four weights are ' +
      'automatically renormalised to sum to 1.0.',
    range_or_units: '0–100 (clipped to [5, 95]); High ≥65, Medium ≥40, else Low',
    caution:
      'Confidence is NOT the probability that the recommendation will be correct. ' +
      'A high-confidence Buy can still lose money.',
  },

  probability_strength: {
    title: 'Probability Strength',
    what_it_is: 'How far the ensemble probability sits from the neutral 50% point.',
    how_to_interpret: 'A probability of 80% or 20% scores higher here than a probability of 55%.',
    how_quantview_uses_it: 'Weighted 35% in the composite confidence score — the largest single component.',
    range_or_units: '0–1 (0 = exactly 50%, 1 = 0% or 100%)',
    caution: 'A confident-looking probability can still be wrong.',
  },

  data_quality: {
    title: 'Data Quality',
    what_it_is: 'The fraction of expected technical indicators that were successfully computed (not NaN) for this asset.',
    how_to_interpret: 'A score of 1.0 means every expected indicator was available; lower scores mean some data was missing.',
    how_quantview_uses_it: 'Weighted 15% in the composite confidence score.',
    range_or_units: '0–1',
    caution: 'Low data quality usually means a short price history, not a computation error.',
  },

  model_agreement: {
    title: 'Model Agreement',
    what_it_is: 'How closely the XGBoost and LSTM probabilities agree with each other.',
    how_to_interpret: 'Higher agreement (closer probabilities) is treated as a mild positive signal for confidence.',
    how_quantview_uses_it:
      'Only computed when LSTM is genuinely available. When LSTM is unavailable, ' +
      'this component is excluded from confidence — never fabricated — and the ' +
      'remaining weights are renormalised to sum to 1.0.',
    range_or_units: '0–1, or excluded (null) when LSTM is unavailable',
    caution: 'Two models agreeing does not guarantee they are both right.',
  },

  // ── Backtest ──────────────────────────────────────────────────────────
  accuracy: {
    title: 'Accuracy',
    what_it_is: 'The share of out-of-fold predictions where the Buy/Sell classification matched the actual T+20 outcome.',
    how_to_interpret: 'Higher is better, but must be read alongside precision/recall — accuracy alone can be misleading on imbalanced data.',
    how_quantview_uses_it: 'Computed on out-of-fold (never-seen-during-training) predictions from walk-forward validation.',
    range_or_units: '0–100%',
    caution: 'Backtest classification performance is not a guarantee of future trading returns.',
  },
  precision: {
    title: 'Precision',
    what_it_is: 'Of all the times the model predicted a positive (Buy-worthy) outcome, the share that were actually positive.',
    how_to_interpret: 'Higher precision means fewer false "Buy" signals historically.',
    how_quantview_uses_it: 'Reported alongside recall/F1 for a fuller picture than accuracy alone.',
    range_or_units: '0–100%',
    caution: 'High precision can come at the cost of missing many true positives (low recall).',
  },
  recall: {
    title: 'Recall',
    what_it_is: 'Of all the times the actual T+20 outcome was positive, the share the model correctly flagged.',
    how_to_interpret: 'Higher recall means the model misses fewer genuine upside moves historically.',
    how_quantview_uses_it: 'Reported alongside precision/F1 for a fuller picture than accuracy alone.',
    range_or_units: '0–100%',
    caution: 'High recall can come at the cost of more false positives (lower precision).',
  },
  f1: {
    title: 'F1 Score',
    what_it_is: 'The harmonic mean of precision and recall — a single number balancing both.',
    how_to_interpret: 'Higher is better; it penalises models that sacrifice one of precision/recall too much for the other.',
    how_quantview_uses_it: 'Reported as one of the four primary backtest metrics.',
    range_or_units: '0–100%',
    caution: 'F1 treats false positives and false negatives as equally costly, which may not match real trading costs.',
  },
  roc_auc: {
    title: 'ROC-AUC',
    what_it_is: 'The probability that the model ranks a randomly chosen positive case higher than a randomly chosen negative case.',
    how_to_interpret: '0.5 = no better than random guessing; 1.0 = perfect ranking.',
    how_quantview_uses_it: 'Computed on out-of-fold predictions as an overall discrimination-quality check.',
    range_or_units: '0–1',
    caution: 'ROC-AUC measures ranking/discrimination quality — it does NOT represent profitability or trading returns.',
  },
  brier_score: {
    title: 'Brier Score',
    what_it_is: 'A probability-quality (calibration) metric — the mean squared error between predicted probabilities and actual outcomes.',
    how_to_interpret: 'Lower is generally better. 0 is a perfect probabilistic forecast; 0.25 is what a constant 50% forecast would score on balanced data.',
    how_quantview_uses_it: 'Reported to give an honest sense of how well-calibrated the ensemble\u2019s probabilities are, not just whether they rank correctly.',
    range_or_units: '0–1 (lower is better)',
    caution: 'A good Brier score reflects calibration quality, not trading profitability.',
  },
  oof_samples: {
    title: 'OOF Samples',
    what_it_is: 'The total number of out-of-fold (held-out, never trained-on) predictions used to compute the backtest metrics.',
    how_to_interpret: 'More samples generally means more statistically reliable backtest metrics.',
    how_quantview_uses_it: 'Accumulated across all walk-forward folds after the purge/embargo period removes leaking rows.',
    range_or_units: 'Count',
    caution: 'A small sample size means the backtest metrics carry more statistical noise.',
  },
  t20_horizon: {
    title: '~20 Trading Sessions',
    what_it_is: 'The forecast horizon QuantView targets — approximately 20 trading days, or about 1 calendar month.',
    how_to_interpret:
      'Recommendations estimate whether conditions historically associated with ' +
      'positive returns may persist over approximately 20 trading sessions.',
    how_quantview_uses_it: 'Every label used to train the models is defined as Close[t+20] > Close[t].',
    range_or_units: '~20 trading days ≈ 1 calendar month',
    caution: 'This is not a guaranteed prediction of price on any specific future date.',
  },
  purge_embargo: {
    title: 'Purge / Embargo',
    what_it_is:
      'A walk-forward validation technique: rows near the boundary between a ' +
      'training fold and its test fold are dropped from training, because their ' +
      'labels depend on prices inside the test window.',
    how_to_interpret:
      'This exists purely to prevent look-ahead bias in the backtest — it is a ' +
      'methodology safeguard, not a trading signal.',
    how_quantview_uses_it:
      'QuantView removes the last 20 rows (equal to the forecast horizon) of ' +
      'each training fold before fitting, guaranteeing no training label "sees" ' +
      'a price from inside its corresponding test window.',
    range_or_units: 'Days (equal to the forecast horizon, 20)',
    caution: 'Purge/embargo prevents leakage in the backtest, but backtest performance still doesn\u2019t guarantee future results.',
  },

  // ── Misc headings ─────────────────────────────────────────────────────
  ensemble_probability: {
    title: 'Ensemble Probability',
    what_it_is: 'The final probability (after model stacking and any choppy-regime shrinkage) that the price will be higher in ~20 trading sessions.',
    how_to_interpret: 'Above the Buy threshold (60%) → Buy; below the Sell threshold (40%) → Sell; in between → Hold.',
    how_quantview_uses_it: 'This is the number the Buy/Sell/Hold recommendation is directly based on.',
    range_or_units: '0–100%',
    caution: 'A probabilistic estimate, not a guarantee — and not financial advice.',
  },

  // ── SHAP Explainability & Technical Features ───────────────────────────
  shap_explainability: {
    title: 'SHAP Explainability',
    what_it_is: 'A transparent breakdown showing exactly which market indicators influenced the AI decision and by how much.',
    how_to_interpret: 'Green positive percentages increased the chance of a price increase. Red negative percentages reduced it.',
    how_quantview_uses_it: 'QuantView uses SHAP (Shapley Additive Explanations) so the recommendation is completely transparent and never a black box.',
    range_or_units: 'Percentage points (% impact on model probability)',
    caution: 'Shows how historical indicators influenced the model, not a certainty of future price action.',
  },

  shap_positive: {
    title: 'Top Positive Contributors',
    what_it_is: 'The technical indicators and market conditions that pushed the AI model most strongly toward a Bullish (Buy) outcome.',
    how_to_interpret: 'Higher green percentages indicate stronger positive support for an upward price trend.',
    how_quantview_uses_it: 'QuantView ranks these indicators by their positive contribution to the final XGBoost decision.',
    range_or_units: '+% impact on probability',
    caution: 'Strong positive factors can still be affected by unexpected news or broader market downturns.',
  },

  shap_negative: {
    title: 'Top Negative Contributors',
    what_it_is: 'The technical indicators and market conditions that pulled the AI model downward toward a Bearish (Sell/Caution) stance.',
    how_to_interpret: 'Larger red negative percentages highlight the main risks, resistance levels, or weaknesses holding the stock back.',
    how_quantview_uses_it: 'QuantView ranks these indicators to warn you about potential headwinds and downside risks.',
    range_or_units: '-% impact on probability',
    caution: 'Negative factors indicate statistical headwinds, but momentum can still carry a stock higher.',
  },

  price_vs_sma200: {
    title: 'Price vs SMA 200',
    what_it_is: 'How far the current stock price is trading above or below its 200-day simple moving average (long-term trend).',
    how_to_interpret: 'A positive percentage means the stock is trading above its long-term baseline (bullish); negative means below (bearish).',
    how_quantview_uses_it: 'Fed into XGBoost and regime detection as a core measure of long-term structural trend strength.',
    range_or_units: '% difference from SMA 200',
    caution: 'Prices too far above the SMA 200 can indicate an extended or overbought rally.',
  },

  price_vs_sma50: {
    title: 'Price vs SMA 50',
    what_it_is: 'How far the current stock price is trading above or below its 50-day simple moving average (medium-term trend).',
    how_to_interpret: 'Positive values indicate strong medium-term upward momentum; negative values indicate medium-term weakness.',
    how_quantview_uses_it: 'Used by the ML models and trend vote to identify medium-term trend direction and support levels.',
    range_or_units: '% difference from SMA 50',
    caution: 'A stock crossing below its SMA 50 often signals slowing short-term momentum.',
  },

  momentum_20d: {
    title: '20-Day Return Momentum',
    what_it_is: 'The raw percentage change in the stock price over the past 20 trading sessions (~1 calendar month).',
    how_to_interpret: 'Positive values show recent upward price velocity; negative values show recent downward drift.',
    how_quantview_uses_it: 'Normalized against volatility to feed into the XGBoost model and momentum signal breakdown.',
    range_or_units: '% price change over 20 sessions',
    caution: 'Past 20-day returns do not guarantee the same trend will continue for the next 20 days.',
  },

  rolling_std_20: {
    title: '20-Day Rolling Volatility',
    what_it_is: 'The standard deviation of daily percentage price returns over the last 20 trading days.',
    how_to_interpret: 'Higher values mean the stock is experiencing larger daily price swings and wider risk.',
    how_quantview_uses_it: 'Used to normalize momentum and adjust risk thresholds dynamically across all market regimes.',
    range_or_units: 'Daily return standard deviation',
    caution: 'High volatility increases both potential reward and potential downside risk.',
  },

  volume_ratio: {
    title: 'Volume Ratio',
    what_it_is: 'Today\u2019s trading volume divided by the 20-day average daily trading volume.',
    how_to_interpret: 'Values above 1.0 mean higher-than-average investor participation; values below 1.0 mean quiet trading.',
    how_quantview_uses_it: 'Confirms trend conviction — price breakouts on high volume are given higher weight by the AI model.',
    range_or_units: 'Ratio (1.0 = average volume)',
    caution: 'High volume on down days can indicate institutional selling or panic dumping.',
  },

  adx_pos: {
    title: '+DI Directional Index',
    what_it_is: 'Measures the presence and strength of upward buying pressure in the stock price.',
    how_to_interpret: 'When +DI is higher than -DI, buyers are in control of the trend direction.',
    how_quantview_uses_it: 'Used alongside ADX to confirm whether a strong trend is moving upward (bullish).',
    range_or_units: '0–100',
    caution: '+DI shows upward pressure only and should always be compared against -DI.',
  },

  adx_neg: {
    title: '-DI Directional Index',
    what_it_is: 'Measures the presence and strength of downward selling pressure in the stock price.',
    how_to_interpret: 'When -DI is higher than +DI, sellers are dominating the price action.',
    how_quantview_uses_it: 'Used alongside ADX to detect downward trending regimes and downside risk.',
    range_or_units: '0–100',
    caution: 'High -DI indicates aggressive selling pressure in recent sessions.',
  },

  bb_pct: {
    title: 'Bollinger %B Position',
    what_it_is: 'Where the current price sits between its upper and lower Bollinger volatility bands.',
    how_to_interpret: '0.0 = at lower band (oversold); 0.5 = at the middle 20-day average; 1.0 = at upper band (overbought).',
    how_quantview_uses_it: 'Helps the AI determine if recent price movement is stretched relative to normal statistical bands.',
    range_or_units: '0.0 to 1.0 (can exceed 1.0 in extreme breakouts)',
    caution: 'Prices can stay pinned to the upper band during very strong bullish trends.',
  },

  regime_code: {
    title: 'Market Regime Code',
    what_it_is: 'A numeric code representing the market state: Trending Up (+1), Choppy / Sideways (0), or Trending Down (-1).',
    how_to_interpret: '+1 means trending upward; -1 means trending downward; 0 means no clear directional trend.',
    how_quantview_uses_it: 'Directly informs the ML models whether the stock is in a trending or range-bound environment.',
    range_or_units: '-1, 0, or +1',
    caution: 'Regimes can shift abruptly during earnings announcements or macroeconomic events.',
  },

  // ── Strategy Benchmark & Cost Sensitivity ──────────────────────────────
  benchmark_section: {
    title: 'Strategy Benchmark Comparison',
    what_it_is: 'Compares the QuantView AI strategy directly against standard industry benchmarks under identical financial conditions.',
    how_to_interpret: 'Shows whether the AI model outperforms passive investing (Buy & Hold) or standard technical rules (SMA 50/200 crossover).',
    how_quantview_uses_it: 'Evaluated with realistic brokerage fees and execution slippage across thousands of historical trading bars.',
    range_or_units: 'Comparative performance table',
    caution: 'Past benchmark simulation performance does not guarantee future investment returns.',
  },

  strat_comparison: {
    title: 'Strategy Comparison',
    what_it_is: 'Tests three strategies: QuantView AI (machine-learning driven), Buy & Hold (passive), and SMA 50/200 (classic golden/death cross).',
    how_to_interpret: 'Green indicates higher profit, lower risk, and superior risk-adjusted returns.',
    how_quantview_uses_it: 'All three strategies start with identical starting capital and execute on the exact same price history.',
    range_or_units: 'QuantView / Buy & Hold / SMA 50/200',
    caution: 'Different market environments favor different strategies — trend-followers struggle in sideways markets.',
  },

  strategy_name: {
    title: 'Trading Strategy',
    what_it_is: 'The specific investment approach being simulated: AI-driven ensemble, passive buy-and-hold, or moving-average crossover.',
    how_to_interpret: 'Identifies which rule set generated the simulated trades and portfolio performance.',
    how_quantview_uses_it: 'Simulated day-by-day with strict Next-Day Open execution to avoid look-ahead bias.',
    range_or_units: 'Strategy Name',
    caution: 'Each strategy has different risk and drawdown characteristics.',
  },

  total_return: {
    title: 'Total Return',
    what_it_is: 'The overall percentage profit or loss generated by the portfolio over the entire backtest time period.',
    how_to_interpret: 'Positive green numbers mean the portfolio grew in value; negative red numbers mean a net loss.',
    how_quantview_uses_it: 'Calculated after deducting all brokerage transaction costs and market slippage.',
    range_or_units: '% overall return',
    caution: 'Total return does not show the risk or volatility experienced along the way.',
  },

  cagr: {
    title: 'CAGR — Compound Annual Growth Rate',
    what_it_is: 'The annualized rate of return, showing how much the investment grew on average each year.',
    how_to_interpret: 'Allows you to compare strategies over different lengths of time on an equal annual footing.',
    how_quantview_uses_it: 'Computed using 252 standard trading sessions per calendar year.',
    range_or_units: '% per year',
    caution: 'CAGR smooths out annual fluctuations and assumes steady reinvestment.',
  },

  sharpe_ratio: {
    title: 'Sharpe Ratio',
    what_it_is: 'Measures how much return a strategy generated per unit of risk taken (risk-adjusted return).',
    how_to_interpret: 'Above 1.0 is considered good; above 2.0 is excellent; negative means returns were negative or below cash.',
    how_quantview_uses_it: 'Helps ensure an AI strategy is not generating returns by taking reckless or erratic gambles.',
    range_or_units: 'Ratio (higher is better)',
    caution: 'Sharpe ratio assumes returns are normally distributed, which can miss rare tail events.',
  },

  max_drawdown: {
    title: 'Maximum Drawdown',
    what_it_is: 'The largest percentage drop from a portfolio peak to its deepest trough before recovering.',
    how_to_interpret: 'Shows the worst-case loss an investor would have endured if they bought at the absolute top.',
    how_quantview_uses_it: 'Used to measure capital preservation and downside risk tolerance.',
    range_or_units: '% drop from peak (e.g. -15.2%)',
    caution: 'Deeper drawdowns require larger gains to break even (e.g. a -50% loss requires a +100% gain).',
  },

  strategy_volatility: {
    title: 'Strategy Volatility',
    what_it_is: 'The annualized standard deviation of daily portfolio returns, measuring the bumpiness of the ride.',
    how_to_interpret: 'Lower volatility means a smoother, more predictable portfolio equity curve.',
    how_quantview_uses_it: 'Calculated on daily strategy returns scaled to an annualized percentage.',
    range_or_units: '% annualized volatility',
    caution: 'Low volatility does not prevent gradual losses if a strategy is unprofitable.',
  },

  trades_count: {
    title: 'Total Trades',
    what_it_is: 'The total number of buy and sell trade executions made over the evaluation period.',
    how_to_interpret: 'Fewer trades mean lower turnover and less brokerage friction; higher trades mean active switching.',
    how_quantview_uses_it: 'Tracks execution activity and applies transaction fees on every trade.',
    range_or_units: 'Trade count',
    caution: 'High-frequency trading strategies suffer severe drag from commissions and bid-ask spreads.',
  },

  win_rate: {
    title: 'Win Rate',
    what_it_is: 'The percentage of trades that resulted in a positive gain or profit.',
    how_to_interpret: 'A 60% win rate means 6 out of 10 trades were profitable.',
    how_quantview_uses_it: 'Evaluates completed round-trip trades and mark-to-market positions.',
    range_or_units: '0–100%',
    caution: 'A high win rate can still lose money if average losses on bad trades exceed gains on winning trades.',
  },

  equity_curves: {
    title: 'Synchronized Equity Curves',
    what_it_is: 'A visual chart showing how a starting portfolio of 100,000 grew or shrank over time across all three strategies.',
    how_to_interpret: 'Hover or drag along the timeline to compare exact portfolio values at any historical date.',
    how_quantview_uses_it: 'Green line = QuantView AI; Blue = Buy & Hold; Yellow = SMA 50/200 crossover.',
    range_or_units: 'Portfolio Value (₹ / $)',
    caution: 'Simulation assumes full order execution without market liquidity constraints.',
  },

  cost_sensitivity: {
    title: 'Transaction Cost Sensitivity',
    what_it_is: 'Demonstrates how realistic brokerage commissions and fees impact the final strategy returns.',
    how_to_interpret: 'Tests 0% (theoretical), 0.05% (discount broker), 0.10% (standard broker), and 0.20% (high impact).',
    how_quantview_uses_it: 'Proves the AI strategy remains genuinely profitable even after paying real-world broker fees.',
    range_or_units: '0.00% to 0.20% fee levels',
    caution: 'Frequent trading under high commission rates can quickly destroy trading profits.',
  },

  backtest_section: {
    title: 'Walk-Forward Backtest',
    what_it_is: 'A rigorous simulation that tests the AI model on out-of-fold historical data it was never allowed to train on.',
    how_to_interpret: 'Higher accuracy, precision, and F1 scores show consistent predictive reliability.',
    how_quantview_uses_it: 'Uses a 20-day purge and embargo window between folds to completely prevent look-ahead bias and data leakage.',
    range_or_units: 'Model Validation Metrics',
    caution: 'Backtests evaluate historical patterns and cannot predict unprecedented black-swan events.',
  },

  signal_breakdown: {
    title: 'Signal Breakdown',
    what_it_is: 'A quick health-check of key technical indicators: momentum, trend, RSI, MACD, and volume.',
    how_to_interpret: 'Green indicates bullish momentum, red indicates bearish pressure, and neutral indicates sideways consolidation.',
    how_quantview_uses_it: 'Summarizes individual market indicators before feeding them into the ensemble AI.',
    range_or_units: 'Bullish / Bearish / Neutral',
    caution: 'Single indicators can give false signals in isolation — always review the combined AI ensemble.',
  },

  market_regime: {
    title: 'Market Regime',
    what_it_is: 'Identifies the overall market environment: Trending Up, Trending Down, or Choppy / Sideways.',
    how_to_interpret: 'Trending markets provide high-conviction trades; choppy markets trigger protective risk shrinkage.',
    how_quantview_uses_it: 'Uses ADX trend strength, +DI/-DI directional balance, and the slope of the 200-day moving average.',
    range_or_units: 'Trending Up / Choppy / Trending Down',
    caution: 'Regimes can change quickly when high-impact earnings or news breaks.',
  },

  stock_chart: {
    title: 'Stock Price History',
    what_it_is: 'Interactive Groww-style price chart displaying closing prices, SMA 50, and SMA 200 moving averages.',
    how_to_interpret: 'Hover on desktop or touch & drag on mobile to inspect precise closing prices on any date.',
    how_quantview_uses_it: 'Visualizes historical price trajectory and long-term trend support lines.',
    range_or_units: 'Historical Prices (₹ / $)',
    caution: 'Past price movements do not guarantee future performance.',
  },

  volatility_card: {
    title: 'Volatility',
    what_it_is: 'Measures how violently or smoothly a stock price moves over time.',
    how_to_interpret: 'Higher volatility means wider price swings and higher risk; lower volatility means calmer movement.',
    how_quantview_uses_it: 'Uses Annualized Volatility, ATR (Average True Range), and Adaptive RSI thresholds.',
    range_or_units: 'Percentage and Price Units',
    caution: 'Volatile stocks require wider stop-losses and careful position sizing.',
  },
};

if (typeof window !== 'undefined') {
  window.QV_GLOSSARY = QV_GLOSSARY;
}


