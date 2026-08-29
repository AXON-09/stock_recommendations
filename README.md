# QuantView AI — Quantitative Stock Research & Intelligence

[![Live Production](https://img.shields.io/badge/Production-Live%20on%20Render-38bdf8?style=flat&logo=render)](https://quantview-ai-5bbk.onrender.com/)
[![Python](https://img.shields.io/badge/Python-3.9%20%7C%203.10%20%7C%203.11%20%7C%203.12%20%7C%203.14-blue?logo=python)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100%2B-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![Twelve Data](https://img.shields.io/badge/Data%20Provider-Twelve%20Data%20%2B%20Live%20Feed-orange)](https://twelvedata.com)
[![Tests](https://img.shields.io/badge/Tests-123%20Passed-22c55e?logo=pytest)](https://pytest.org)

**QuantView AI** is a production-grade quantitative machine learning research platform for equities and indices across **India (NSE/BSE)** and **US markets (NYSE/NASDAQ)**. It combines walk-forward machine learning validation, explainable AI (SHAP), market regime classification, and real-time institutional and fundamental metrics.

> **Disclaimer**: *QuantView AI is an educational and quantitative research tool, NOT financial advice. Recommendations are probabilistic forward-looking research signals and do not guarantee future profit.*

---

## 🌐 Live Production Application
- **Live URL**: [https://quantview-ai-5bbk.onrender.com/](https://quantview-ai-5bbk.onrender.com/)
- **Local Host**: `http://127.0.0.1:8000`
- **Interactive API Documentation**: `http://127.0.0.1:8000/docs`

---

## ⚡ Key Platform Capabilities

| Feature Area | Description |
| :--- | :--- |
| **🏛️ Institutional & Fundamental Intelligence** | 6-card analytics grid powered by Twelve Data & live feeds: Analyst Consensus, 12M Target Prices, Revenue Growth Estimates, P/S Valuation, Trading Volume in shares, and Gross Profit Margins. |
| **🧠 Explainable AI (SHAP)** | `shap.TreeExplainer` decomposes XGBoost decision trees into exact positive (bullish) and negative (bearish) feature attributions. |
| **📈 Strategy Benchmarking** | Side-by-side walk-forward strategy comparison of QuantView vs. Buy & Hold vs. Golden Cross (SMA50/200) under identical capital and time horizons. |
| **💸 Realistic Backtesting** | Built-in transaction fees (0.10%), execution slippage (0.05%), and cost sensitivity analysis across 4 fee tiers (0%, 0.05%, 0.10%, 0.20%). |
| **🛡️ Purged Walk-Forward ML** | 3-fold expanding walk-forward validation with a 20-day purge/embargo window to eliminate label look-ahead leakage. |
| **🌐 Multi-Market & Benchmark Engine** | Native support for Indian equities (`.NS` / `.BO` in ₹ INR), US equities (`$` USD), and benchmark indices (`NIFTY 50`, `SENSEX`, `S&P 500`, `NASDAQ 100`). |
| **🌊 Market Regime Detection** | Wilder ADX and SMA200 slope dynamically classify market conditions into *Trending Up*, *Trending Down*, or *Choppy* (applying regime-based probability shrinkage). |
| **🎯 Volatility-Adaptive RSI** | Automatically scales RSI overbought/oversold boundaries based on each asset's 20-day annualised volatility. |
| **📊 Interactive Groww-Style Charts** | SVG area curves with live interactive crosshairs, timeframe filtering (1M, 3M, 6M, 1Y, ALL), and moving averages overlay. |

---

## 🏛️ Institutional & Fundamental Intelligence (6 Cards)

The Institutional Intelligence grid provides validated, non-fabricated metrics:

1. **Analyst Consensus**:
   - Direct consensus recommendations: `STRONG BUY`, `BUY`, `HOLD`, `SELL`, `STRONG SELL`, or `Not Covered`.
   - Verified analyst counts (e.g. `27 analysts` for Reliance, `39 analysts` for Apple) and 0–100 weighted consensus gauge.
2. **Target Price**:
   - 12-month forward mean/median price targets with street high and low boundaries.
   - Strict currency localization: `₹ INR` for NSE/BSE (e.g. `₹1,677.89 INR`) and `$ USD` for US equities (e.g. `$324.45 USD`).
3. **Revenue Forecast**:
   - Directional classification: `↑ Growing`, `→ Stable`, `↓ Declining`, or `N/A`.
   - Reporting period context (e.g. `+29.7% (YoY Trailing)` or `Next quarter`).
4. **P/S Valuation**:
   - Trailing 12-month Price-to-Sales valuation and ratio labels (e.g. `1.54x` • `Low P/S`).
5. **Trading Volume**:
   - Absolute session volume displayed in shares (e.g. `12.4M shares`, `396.9K shares`).
   - Relative volume ratio vs. the 20-day rolling moving average (e.g. `1.15x Relative Volume`).
6. **Gross Margin**:
   - Exact gross profit margin percentage calculated from income statements:
     $$\text{Gross Margin} = \left(\frac{\text{Gross Profit}}{\text{Total Revenue}}\right) \times 100$$

---

## 🏗️ System Architecture

```
                       [ User Input / Market Chip Tap ]
                                      │
                                      ▼
                        Ticker & Market Resolution
                   (backend/market.py & backend/twelvedata.py)
                    ├── India: NSE (.NS) / BSE (.BO) [₹ INR]
                    ├── US: NYSE / NASDAQ [$ USD]
                    └── Indices: ^GSPC, ^IXIC, ^NSEI, ^BSESN
                                      │
         ┌────────────────────────────┴────────────────────────────┐
         ▼                                                         ▼
[ Institutional Intelligence ]                              [ Quantitative ML Pipeline ]
  (backend/twelvedata.py)                                    (backend/engine.py & models.py)
  ├── Twelve Data REST API                                    ├── 14 Engineered Features (OHLCV)
  │    ├── /recommendations & /price_target                   ├── Volatility-Adaptive RSI
  │    ├── /statistics & /income_statement                    ├── 3-Fold Purged Walk-Forward Splits
  │    └── /quote & /earnings_estimate                        ├── XGBoost + PyTorch LSTM (Optional)
  └── Graceful Fallback to Live Feed                          ├── Logistic Stacking Consensus Layer
       (TTL 1-hour in-memory caching)                         ├── SHAP TreeExplainer Feature Attribution
                                                              └── Market Regime Probability Shrinkage
                                      │
                                      ▼
                      FastAPI Backend API (backend/main.py)
                                      │
                                      ▼
                   Frontend Dashboard (frontend/index.html)
                    ├── Clean 2-Row Aligned Hero Header
                    ├── 1-Click Market Overview Ribbon
                    ├── Groww-Style Crosshair Canvas Chart
                    ├── 6-Card Institutional Intelligence Grid
                    ├── Strategy Benchmarking Comparison Table
                    └── SHAP Explainability Drivers
```

---

## ⚙️ Installation & Setup

### Prerequisites
- Python 3.9+ (Python 3.10, 3.11, 3.12, or 3.14)
- (Optional) Twelve Data API Key

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/AXON-09/stock_recommendations.git
cd stock_recommendations
pip install -r backend/requirements.txt
```

### 2. Configure Environment (Optional)
To use your Twelve Data API key as the primary fundamental data source, set the environment variable:
```bash
# Windows PowerShell
$env:TWELVE_DATA_API_KEY="your_api_key_here"

# Linux / macOS / Bash
export TWELVE_DATA_API_KEY="your_api_key_here"
```
*(If no API key is provided, the platform automatically utilizes its high-availability live feed fallback with 100% genuine data).*

### 3. Run the Platform
```bash
python run.py
```
Open **[http://127.0.0.1:8000](http://127.0.0.1:8000)** in your web browser.

---

## 🧪 Automated Test Suite

QuantView includes a 123-test validation suite covering data integrity, no-leakage walk-forward embargoes, API endpoints, and financial mathematics:

```bash
pytest
```

```
====================== 123 passed, 48 warnings in 37.15s ======================
```

---

## 📂 Codebase Structure

```
stock-recommender/
│
├── backend/
│   ├── config.py             # Constants, model hyperparameters, fees, and thresholds
│   ├── twelvedata.py         # Twelve Data API integration, symbol resolution & caching
│   ├── engine.py             # Feature engineering, Wilder ATR, adaptive RSI, fundamentals
│   ├── models.py             # Purged walk-forward validation, XGBoost, LSTM, SHAP explainability
│   ├── backtest.py           # Multi-strategy benchmark engine & fee/slippage simulations
│   ├── market.py             # Multi-market ticker resolver & peer valuation
│   ├── main.py               # FastAPI server, static file hosting, REST endpoints
│   └── requirements.txt      # Python dependencies
│
├── frontend/
│   ├── index.html            # Single-page dashboard markup
│   ├── style.css             # Glassmorphism dark theme & responsive grid styling
│   ├── app.js                # State management, API bindings, Groww chart crosshairs
│   └── favicon.svg           # Unboxed glowing diamond brand icon
│
├── tests/
│   ├── test_api.py           # FastAPI response schemas & validation tests
│   ├── test_benchmark.py     # Strategy benchmarking correctness tests
│   ├── test_features.py      # Technical indicator calculation tests
│   ├── test_frontend.py      # Static asset & UI integrity tests
│   ├── test_leakage.py       # Walk-forward purge and embargo leakage tests
│   ├── test_market.py        # Ticker resolution & exchange detection tests
│   ├── test_shap.py          # SHAP TreeExplainer feature contribution tests
│   └── test_transaction_costs.py # Execution slippage & transaction fee tests
│
├── run.py                    # Single-command application launcher
└── README.md                 # Complete system documentation
```

---

## 📄 License
This project is open-source and available under the **MIT License**.
