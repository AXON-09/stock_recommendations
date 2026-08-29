# QuantView — Stock Recommendation System

An ML-powered quantitative research tool for stocks and ETFs. Provides research signals based on technical analysis, market regime detection, and walk-forward ML validation.

> **Disclaimer**: This is a research/educational tool, NOT financial advice. Past model performance does not guarantee future results.

---

## Features

| Feature | Description |
|---|---|
| **Explainable Predictions (SHAP)** | TreeExplainer maps exact feature contributions (positive and negative) to XGBoost predictions |
| **Strategy Benchmarking** | Fair historical comparison of QuantView vs. Buy & Hold vs. SMA50/200 over identical time periods and capital |
| **Realistic Backtesting** | Incorporates configurable transaction costs (0.10%) and market slippage (0.05%) with cost sensitivity analysis |
| **Walk-Forward Validation** | Expanding-window backtest with 20-day purge/embargo to prevent label leakage |
| **Volatility-Adaptive RSI** | RSI buy/sell thresholds scale with the asset's own annualised volatility |
| **Market Regime Detection** | ADX + SMA200 slope classifies Trending Up / Trending Down / Choppy |
| **XGBoost Ensemble** | Tabular ML on 14 technical features |
| **LSTM (optional)** | Sequential pattern model (requires PyTorch; auto-disabled if unavailable) |
| **Logistic Stacking** | Trained on OOF predictions; coefficients show relative contributions |
| **Calibrated Confidence** | 5-component composite score (probability, volatility, data quality, regime, model agreement) |
| **Sector Valuation** | Rule-based P/E comparison vs sector ETF (not an ML feature — no historical data available) |
| **Full Backtest Metrics** | Total Return, CAGR, Sharpe Ratio, Max Drawdown, Volatility, Number of Trades, Win Rate |
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
│   ├── config.py          ← All constants, thresholds, fees, and feature columns (single source of truth)
│   ├── engine.py          ← Data fetching, indicator computation, feature extraction
│   ├── models.py          ← Walk-forward training, XGBoost, LSTM, ensemble, SHAP explainability
│   ├── backtest.py        ← Realistic backtesting engine & strategy benchmarking comparison
│   ├── main.py            ← FastAPI app (serves frontend + REST API)
│   └── requirements.txt
│
├── frontend/
│   ├── index.html         ← Dashboard UI with SHAP contributions & Benchmark charts
│   ├── style.css          ← Premium dark/glassmorphism design
│   └── app.js             ← Fetch API, SVG equity chart rendering, interactive components
│
├── tests/
│   ├── conftest.py
│   ├── test_leakage.py           ← Walk-forward and LSTM leakage tests
│   ├── test_features.py          ← Indicator, signal, and confidence tests
│   ├── test_market.py            ← Ticker resolution and market/ETF metadata tests
│   ├── test_api.py               ← FastAPI response-shape tests (mocked yfinance)
│   ├── test_shap.py              ← SHAP TreeExplainer & feature attribution tests
│   ├── test_benchmark.py         ← Strategy benchmarking suite tests
│   └── test_transaction_costs.py ← Realistic fee & slippage execution tests
│
├── run.py                 ← Single-command launcher
└── README.md
```

---

## Methodology

### 1. Forecast Target
```
y[t] = 1  if  Close[t+20] > Close[t]  else 0
```
Predictions represent the model's estimate of whether the price will be higher 20 trading days (~1 calendar month) later.

### 2. Walk-Forward Validation with Purge & Embargo
```
[── TRAIN ──────────────────][── PURGE (20d) ──][── TEST ──]
```
Because `y[t]` uses `Close[t+20]`, the last 20 rows of each training fold are removed before fitting. This eliminates target look-ahead bias across validation folds.

### 3. Explainable Predictions (SHAP)
QuantView uses `shap.TreeExplainer` on the fitted XGBoost model to provide feature-level attribution:
* Computes Shapley values on the scaled feature input vector.
* Isolates top positive contributors (features pulling the recommendation toward BUY) and top negative contributors (features pulling toward SELL/HOLD).
* Maps contributions to human-readable names and unscaled indicator readings.

### 4. Strategy Benchmarking
QuantView evaluates historical strategy performance against simple baseline strategies under configurable transaction-cost and slippage assumptions:
* **QuantView**: Long when walk-forward probability $P \ge 0.50$, Cash otherwise.
* **Buy & Hold**: Enters Day 1, holds through end of period.
* **SMA50/200**: Golden Cross / Trend Filter (Long when $\text{Close} > \text{SMA200}$, Cash otherwise).

All strategies evaluate over the exact same time period, starting capital ($100,000), calendar sessions, and cost parameters.

### 5. Realistic Backtesting with Transaction Costs & Slippage
* **Transaction Costs**: Configurable (default `0.10%` / 10 bps per trade). Fees apply strictly upon position transitions ($0 \to 1$ and $1 \to 0$).
* **Execution Slippage**: Configurable (default `0.05%` / 5 bps). Buys execute at $\text{Close} \times (1 + \text{slippage})$, Sells execute at $\text{Close} \times (1 - \text{slippage})$.
* **No Look-Ahead Bias**: Signals formed at bar $t$ execute without using future prices.
* **Cost Sensitivity Analysis**: QuantView returns are automatically evaluated across `0%`, `0.05%`, `0.10%`, and `0.20%` transaction cost tiers.

### 6. Volatility-Adaptive RSI
```
ann_vol = rolling_std_20 * sqrt(252)
adj     = clip((ann_vol - 0.10) / 0.40 * 10,  -5, +10)
buy     = clip(30 - adj,  15, 45)
sell    = clip(70 + adj,  55, 85)
```
High-volatility assets get wider dynamic bands so normal price swings don't trigger premature false signals.

### 7. Trend Signal (SMA)
Three binary votes — price > SMA50, price > SMA200, SMA200 sloping up — are combined by unanimity:
```
3/3 votes bullish → "bullish"
0/3 votes bullish → "bearish"
1 or 2 votes       → "neutral"  (conditions disagree)
```

### 8. Regime Shrinkage
In choppy markets (ADX < 25):
```
p_adjusted = 0.5 + (p_raw - 0.5) * 0.55
```
Signals are pulled 45% toward neutral to reflect lower predictability in sideways regimes.

### 9. Confidence Score
```
confidence = (
    prob_strength     * 0.35  +  # |p - 0.5| * 2
    vol_component     * 0.25  +  # inverse ATR %
    data_quality      * 0.15  +  # fraction of indicators available
    regime_clarity    * 0.15  +  # ADX-based regime strength
    model_agreement   * 0.10     # 1 - |xgb_p - lstm_p|
) * 100
```
Clipped to [5, 95]. Reflects signal clarity and data quality, **not** guaranteed future profitability.

---

## Limitations

| Limitation | Impact |
|---|---|
| `yfinance` data quality | Adjusted prices may differ from institutional sources; dividends/splits may affect historical returns |
| No point-in-time fundamentals | P/E is a rule-based signal only — using today's P/E for all historical rows would introduce look-ahead bias |
| No intraday data | All analysis uses daily OHLCV bars |
| LSTM unavailable on Python 3.14 | PyTorch wheels not yet released for Python 3.14; system gracefully falls back to XGBoost-only |
| ~20 day horizon only | Not designed for day-trading or long-term (>1 year) macro holding |
| Model uncertainty | The model can be wrong. High confidence indicates signal alignment, not guaranteed profit |
| Regime changes | Historical patterns may not predict unprecedented market shifts or black-swan macro events |

