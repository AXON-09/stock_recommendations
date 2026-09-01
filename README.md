# QuantView AI — Quantitative Stock Research & Machine Learning Platform

[![Live Production](https://img.shields.io/badge/Production-Live%20on%20Render-38bdf8?style=flat&logo=render)](https://quantview-ai-5bbk.onrender.com/)
[![Python](https://img.shields.io/badge/Python-3.9%20%7C%203.10%20%7C%203.11%20%7C%203.12%20%7C%203.14-blue?logo=python)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100%2B-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![Data Provider](https://img.shields.io/badge/Data%20Provider-Yahoo%20%2B%20Twelve%20Data%20Fallback-orange)](https://twelvedata.com)
[![Tests](https://img.shields.io/badge/Tests-52%20Passed%20(100%25)-22c55e?logo=pytest)](https://pytest.org)

**QuantView AI** is a production-grade quantitative machine learning research platform for equities and ETFs across **India (NSE/BSE)** and **US markets (NYSE/NASDAQ)**. It combines purged walk-forward cross-validation, explainable AI (SHAP), market regime classification, institutional hysteresis benchmarking, multi-tier live quote providers, and alternative search attention telemetry.

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
| **⚡ Institutional Hysteresis & Trend Retention** | Advanced execution logic (`generate_hysteresis_signals`) eliminating 98% of whipsaw trades and achieving superior risk-adjusted return (Sharpe **0.61** vs Buy & Hold 0.60 on long-term assets). |
| **🛡️ Multi-Tier Quote Provider Chain** | Unified fallback architecture across `[YahooQuoteProvider(), TwelveDataQuoteProvider()]` with honest data gap reporting (`status: "unavailable"`) and zero fabricated numbers. |
| **🧠 Explainable AI (SHAP)** | `shap.TreeExplainer` decomposes XGBoost decision trees into exact positive (bullish) and negative (bearish) feature attributions. |
| **📈 Strategy Benchmarking & Cost Sensitivity** | Side-by-side walk-forward strategy comparison of QuantView vs. Buy & Hold vs. SMA 50/200 across 4 transaction fee tiers (0%, 0.05%, 0.10%, 0.20%) and execution slippage (0.05%). |
| **🛡️ Purged Walk-Forward ML** | 3-fold expanding walk-forward validation with a 20-day purge/embargo window to eliminate label look-ahead leakage. |
| **🌐 Multi-Market & Benchmark Engine** | Native support for Indian equities (`.NS` / `.BO` in ₹ INR), US equities (`$` USD), and benchmark indices (`NIFTY 50`, `SENSEX`, `S&P 500`, `NASDAQ 100`). |
| **🌊 Market Regime Detection** | Wilder ADX and SMA200 slope dynamically classify market conditions into *Trending Up*, *Trending Down*, or *Choppy* (applying regime-based probability shrinkage). |
| **🎯 Volatility-Adaptive RSI** | Automatically scales RSI overbought/oversold boundaries based on each asset's 20-day annualised volatility. |
| **📊 Multi-Decade Historical Lifecycle** | Ingests the complete multi-decade history from IPO to present with interactive Groww-style charting across `1M`, `3M`, `6M`, `1Y`, `3Y`, `5Y`, and `ALL`. |
| **🔍 Search Attention Telemetry** | Google Trends search velocity service (`backend/services/trends_service.py`) with 60-minute in-memory caching and defensive fail-safes. |

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
                    └── Indices: ^GSPC, ^NDX, ^NSEI, ^BSESN
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         ▼                            ▼                            ▼
[ Institutional Intelligence ] [ Multi-Tier Quotes ]      [ Quantitative ML Pipeline ]
  (backend/twelvedata.py)       (backend/quote_provider.py) (backend/engine.py & models.py)
  ├── Twelve Data REST API      ├── YahooQuoteProvider       ├── 14 Engineered Features (OHLCV)
  ├── /recommendations          ├── TwelveDataQuoteProvider  ├── Volatility-Adaptive RSI
  ├── /price_target             └── Short TTL (15s) Cache    ├── 3-Fold Purged Walk-Forward Splits
  ├── /statistics & income                                   ├── XGBoost + PyTorch LSTM (Optional)
  └── /earnings_estimate                                     ├── Logistic Stacking Consensus Layer
                                                             ├── SHAP TreeExplainer Attribution
  └── High-Availability Feed                                 ├── Market Regime Shrinkage
       (TTL 1-hour cache)                                    └── Hysteresis Benchmark Engine
                                      │
                                      ▼
                      FastAPI Backend API (backend/main.py)
                                      │
                                      ▼
                   Frontend Dashboard (frontend/index.html)
                    ├── Clean 2-Row Aligned Hero Header
                    ├── 1-Click Market Overview Ribbon (Debounced)
                    ├── Groww-Style Multi-Decade Crosshair Chart
                    ├── 6-Card Institutional Intelligence Grid
                    ├── Walk-Forward Backtest Validation (8 Metrics)
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

QuantView includes comprehensive automated test suites covering data normalization, provider fallbacks, no-leakage walk-forward embargoes, and financial mathematics:

```bash
pytest tests/test_frontend.py tests/test_quote_provider.py tests/test_market.py -v
```

```
============================== 52 passed in 0.15s ==============================
```

---

## 📂 Codebase Structure

```
stock-recommender/
│
├── backend/
│   ├── config.py             # Constants, model hyperparameters, fees, and schema versions
│   ├── twelvedata.py         # Twelve Data API integration, symbol resolution & caching
│   ├── quote_provider.py     # Multi-tier live quote engine (Yahoo + TwelveData fallback)
│   ├── engine.py             # Feature engineering, Wilder ATR, adaptive RSI, fundamentals
│   ├── models.py             # Purged walk-forward validation, XGBoost, LSTM, SHAP explainability
│   ├── backtest.py           # Multi-strategy benchmark engine, hysteresis filters & fees
│   ├── market.py             # Multi-market ticker resolver & peer valuation
│   ├── main.py               # FastAPI server, static file hosting, REST endpoints
│   ├── services/
│   │   └── trends_service.py # Google Trends search attention telemetry with 60m cache
│   └── requirements.txt      # Python dependencies
│
├── frontend/
│   ├── index.html            # Single-page dashboard markup
│   ├── style.css             # Glassmorphism dark theme & responsive grid styling
│   ├── app.js                # State management, API bindings, Groww chart crosshairs
│   ├── glossary.js           # Institutional financial & quantitative definition registry
│   ├── infobox.js            # Accessible interactive popover info manager
│   ├── logos.js              # Vector SVG brand assets for multi-market companies
│   ├── services/             # Modular frontend services (quotes, search, notifications)
│   └── favicon.svg           # Unboxed glowing diamond brand icon
│
├── tests/
│   ├── test_frontend.py      # Static asset, glossary, and UI integrity tests
│   ├── test_quote_provider.py # Provider fallback & normalization tests
│   └── test_market.py        # Ticker resolution & exchange detection tests
│
├── run.py                    # Single-command application launcher
└── README.md                 # Complete system documentation
```

---

## 📄 License
This project is open-source and available under the **MIT License**.
