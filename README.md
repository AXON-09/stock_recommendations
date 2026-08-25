# QuantView — Stock Recommendation System

An ML-powered quantitative research tool for stocks and ETFs. Provides research signals based on technical analysis, market regime detection, and walk-forward ML validation.

> **Disclaimer**: This is a research/educational tool, NOT financial advice. Past model performance does not guarantee future results.

---

## Features

| Feature | Description |
|---|---|
| **Walk-Forward Validation** | Expanding-window backtest with 20-day purge/embargo to prevent label leakage |
| **Volatility-Adaptive RSI** | RSI buy/sell thresholds scale with the asset's own annualised volatility |
| **Market Regime Detection** | ADX + SMA200 slope classifies Trending Up / Trending Down / Choppy |
| **XGBoost Ensemble** | Tabular ML on 14 technical features |
| **LSTM (optional)** | Sequential pattern model (requires PyTorch; auto-disabled if unavailable) |
| **Logistic Stacking** | Trained on OOF predictions; coefficients show relative contributions |
| **Calibrated Confidence** | 5-component composite score (probability, volatility, data quality, regime, model agreement) |
| **Sector Valuation** | Rule-based P/E comparison vs sector ETF (not an ML feature — no historical data available) |
| **Full Backtest Metrics** | Accuracy, Precision, Recall, F1, ROC-AUC, Brier Score |
| **Local Web Dashboard** | Premium dark UI served directly by FastAPI — no Node.js required |

---

## Architecture

```
Yahoo Finance (yfinance)
        │
        ▼
Feature Engineering (engine.py)
  ├── ATR, ADX, RSI, MACD, Bollinger, SMA50/200
  ├── Volatility-adaptive RSI thresholds
  └── Regime code (vectorised)
        │
        ▼
Walk-Forward Training (models.py)
  ├── Purge/embargo: last 20 rows of training dropped per fold
  ├── XGBoost → OOF probabilities
  ├── LSTM    → OOF probabilities when PyTorch is available;
  │             otherwise probability = null, available = false,
  │             and LSTM is dropped from stacking entirely (never
  │             represented as a fabricated 0.5)
  └── Logistic stacking trained on OOF probs
      (XGBoost-only when LSTM is unavailable; model agreement is
      excluded from confidence and the remaining weights renormalise)
        │
        ▼
Prediction
  ├── XGBoost (tabular features)
  ├── LSTM (60-day sequence using training context)
  ├── Logistic ensemble
  └── Regime shrinkage (choppy → closer to 0.5)
        │
        ▼
Confidence Score
  ├── Probability strength (35%)
  ├── Volatility inverse (25%)
  ├── Data completeness (15%)
  ├── Regime clarity (15%)
  └── Model agreement (10%)
        │
        ▼
FastAPI JSON → Frontend Dashboard
```

---

## Installation

```bash
# 1. Clone / navigate to the project folder
cd stock-recommender

# 2. Install Python dependencies
pip install -r backend/requirements.txt
```

**Python version**: 3.9+ recommended. Python 3.14 works but PyTorch wheels don't exist yet for 3.14 — LSTM will be automatically disabled and the system falls back to XGBoost-only.

---

## Run

```bash
python run.py
```

Then open **http://127.0.0.1:8000** in your browser.

The API documentation is at **http://127.0.0.1:8000/docs**.

### First analysis per ticker
The first request downloads 5 years of data and trains the walk-forward model. This takes **30–120 seconds**. Subsequent calls within the 4-hour cache window are near-instant.

### Force refresh
```bash
# Via API
curl -X DELETE http://127.0.0.1:8000/api/cache/AAPL

# Via URL parameter
http://127.0.0.1:8000/api/recommend?ticker=AAPL&refresh=true
```

---

## Testing

```bash
# From the project root
pytest tests/ -v
```

Tests cover:
- Walk-forward purge/embargo (leakage prevention)
- LSTM sequence isolation from test data
- T+20 label correctness
- RSI directional correctness and bounds
- ATR positivity
- SMA warm-up and correctness
- Volatility-adjusted RSI thresholds (bounded, monotonic)
- Regime detection (all 3 regimes + edge cases)
- Trend signal (bullish/bearish/neutral all reachable — see Methodology)
- Confidence score weights sum to 1.0 and components in [0,1]
- Recommendation thresholds (Buy/Sell/Hold)
- Ticker resolution and market/ETF metadata (India, US, other suffixes)
- API response shape, LSTM-unavailable honesty, ETF valuation short-circuit

---

## Project Structure

```
stock-recommender/
│
├── backend/
│   ├── config.py          ← All constants and thresholds (single source of truth)
│   ├── engine.py          ← Data fetching, indicator computation, feature extraction
│   ├── models.py          ← Walk-forward training, XGBoost, LSTM, ensemble, confidence
│   ├── main.py            ← FastAPI app (serves frontend + API)
│   └── requirements.txt
│
├── frontend/
│   ├── index.html         ← Dashboard UI
│   ├── style.css          ← Premium dark/glassmorphism design
│   └── app.js             ← Fetch API, render logic
│
├── tests/
│   ├── conftest.py
│   ├── test_leakage.py    ← Walk-forward and LSTM leakage tests
│   ├── test_features.py   ← Indicator, signal, and confidence tests
│   ├── test_market.py     ← Ticker resolution and market/ETF metadata tests
│   └── test_api.py        ← FastAPI response-shape tests (mocked yfinance)
│
├── run.py                 ← Single-command launcher
└── README.md
```

---

## Methodology

### Forecast Target
```
y[t] = 1  if  Close[t+20] > Close[t]  else 0
```
Predictions represent the model's estimate of whether the price will be higher 20 trading days (~1 calendar month) later.

### Walk-Forward Validation with Purge
```
[── TRAIN ──────────────────][── PURGE (20d) ──][── TEST ──]
```
Because `y[t]` uses `Close[t+20]`, the last 20 rows of each training fold are removed before fitting. This prevents labels from training rows from "seeing" prices inside the test window.

### Volatility-Adaptive RSI
```
ann_vol = rolling_std_20 * sqrt(252)
adj     = clip((ann_vol - 0.10) / 0.40 * 10,  -5, +10)
buy     = clip(30 - adj,  15, 45)
sell    = clip(70 + adj,  55, 85)
```
High-volatility assets (e.g. TSLA ~70% ann vol) get wider bands so normal price swings don't trigger false signals.

### Trend Signal (SMA)
Three binary votes — price > SMA50, price > SMA200, SMA200 sloping up — are combined by unanimity, not majority:
```
3/3 votes bullish → "bullish"
0/3 votes bullish → "bearish"
1 or 2 votes       → "neutral"  (the three conditions disagree)
```
Requiring unanimity keeps "neutral" reachable and reserves a directional call for genuine trend agreement across price/SMA50/SMA200/slope.

### Regime Shrinkage
In choppy markets (ADX < 25):
```
p_adjusted = 0.5 + (p_raw - 0.5) * 0.55
```
Signals are pulled 45% toward neutral to reflect lower predictability.

### Probability Calibration
The Logistic Regression stacking layer is trained on OOF predictions, which provides partial calibration. However, calibration is **not guaranteed**. Brier Score and ROC-AUC are reported for honest assessment.

### Confidence Score
```
confidence = (
    prob_strength     * 0.35  +  # |p - 0.5| * 2
    vol_component     * 0.25  +  # inverse ATR %
    data_quality      * 0.15  +  # fraction of indicators available
    regime_clarity    * 0.15  +  # ADX-based regime strength
    model_agreement   * 0.10     # 1 - |xgb_p - lstm_p|
) * 100
```
Clipped to [5, 95]. This score reflects how much to trust the recommendation, **not** the probability of being correct.

---

## Limitations

| Limitation | Impact |
|---|---|
| `yfinance` data quality | Adjusted prices may differ from other sources; dividends/splits may affect historical returns |
| No point-in-time fundamentals | P/E is a rule-based signal only — using today's P/E for all historical rows would introduce look-ahead bias |
| No intraday data | All analysis uses daily OHLCV |
| LSTM unavailable on Python 3.14 | PyTorch wheels not yet released for Python 3.14; LSTM auto-disabled |
| ~20 day horizon only | Not designed for day-trading or long-term (>1 year) analysis |
| Backtest ≠ live trading | No transaction costs, slippage, or liquidity constraints |
| Model uncertainty | The model can be wrong. High confidence ≠ guaranteed profit |
| Regime changes | A model trained on historical regimes may not adapt to unprecedented market conditions |
