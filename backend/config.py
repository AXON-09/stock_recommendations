"""
config.py - Central configuration for QuantView AI.

All tuneable parameters live here. Do not scatter magic numbers elsewhere.

Markets supported:
  🇮🇳 NSE (.NS suffix)  /  BSE (.BO suffix)
  🇺🇸 US markets (no suffix)
"""

# ---------------------------------------------------------------------------
# Forecasting
# ---------------------------------------------------------------------------
FORECAST_HORIZON: int = 20
"""
Target horizon in trading days.
Label: 1 if Close[t + FORECAST_HORIZON] > Close[t], else 0.
Recommendations should be read as:
  "Model estimates a higher/lower probability of positive return
   over the next ~20 trading days (~1 calendar month)."
"""

PURGE_PERIOD: int = FORECAST_HORIZON
"""
Walk-forward embargo: number of rows dropped between the end of the
training fold and the start of the test fold.

Because the label for row t uses Close[t+20], training rows near
the fold boundary have labels that depend on prices inside the test
window.  Removing PURGE_PERIOD rows from the tail of the training
set eliminates this look-ahead bias.
"""

# ---------------------------------------------------------------------------
# ML — sequence model
# ---------------------------------------------------------------------------
LSTM_SEQUENCE_LENGTH: int = 30
"""Lookback window (trading days) fed to the LSTM as a sequence."""

# ---------------------------------------------------------------------------
# ML — walk-forward
# ---------------------------------------------------------------------------
WALK_FORWARD_SPLITS: int = 3
"""Number of expanding walk-forward folds used during OOF backtesting."""

XGB_ESTIMATORS_FOLD: int = 40
"""XGBoost trees per fold during walk-forward (fast)."""

XGB_ESTIMATORS_FULL: int = 80
"""XGBoost trees for the final full-dataset model (higher quality)."""

LSTM_EPOCHS_FOLD: int = 4
"""LSTM training epochs per fold (kept low for cloud CPU speed)."""

LSTM_EPOCHS_FULL: int = 8
"""LSTM training epochs for the final full-dataset model."""


# ---------------------------------------------------------------------------
# Decision thresholds
# ---------------------------------------------------------------------------
BUY_THRESHOLD: float = 0.60
"""Ensemble probability >= BUY_THRESHOLD → BUY recommendation."""

SELL_THRESHOLD: float = 0.40
"""Ensemble probability <= SELL_THRESHOLD → SELL recommendation."""

# ---------------------------------------------------------------------------
# Regime detection
# ---------------------------------------------------------------------------
ADX_TREND_THRESHOLD: float = 25.0
"""ADX > this value indicates a trending market."""

CHOPPY_SHRINK_FACTOR: float = 0.55
"""
In a choppy (non-trending) market the raw ensemble probability is
shrunk toward 0.50 by this factor:
  adjusted_p = 0.5 + (raw_p - 0.5) * CHOPPY_SHRINK_FACTOR
Set to 1.0 to disable regime-based shrinkage.
"""

# ---------------------------------------------------------------------------
# Volatility-adjusted RSI thresholds
# ---------------------------------------------------------------------------
RSI_BASE_BUY: float = 30.0
"""RSI buy threshold at baseline (10 % annualised volatility)."""

RSI_BASE_SELL: float = 70.0
"""RSI sell threshold at baseline (10 % annualised volatility)."""

RSI_VOL_BASELINE: float = 0.10
"""Annualised volatility at which no RSI adjustment is applied."""

RSI_VOL_SCALE: float = 0.40
"""Annualised-vol range over which the maximum adjustment is applied."""

RSI_MAX_WIDEN: float = 10.0
"""Maximum points by which the RSI band is widened (high vol)."""

RSI_MAX_NARROW: float = 5.0
"""Maximum points by which the RSI band is narrowed (low vol)."""

# ---------------------------------------------------------------------------
# Confidence scoring weights
# ---------------------------------------------------------------------------
CONF_WEIGHT_BOUNDARY:   float = 0.35
CONF_WEIGHT_VOLATILITY: float = 0.25
CONF_WEIGHT_DATA_QUALITY: float = 0.15
CONF_WEIGHT_REGIME:     float = 0.15
CONF_WEIGHT_AGREEMENT:  float = 0.10
"""
Weights for the 5-component confidence score.  Must sum to 1.0.

When LSTM is unavailable, model_agreement is excluded and the remaining
four weights are renormalised to sum to 1.0 automatically (see models.py).
"""

# Sanity-check at import time.
_total = (CONF_WEIGHT_BOUNDARY + CONF_WEIGHT_VOLATILITY +
          CONF_WEIGHT_DATA_QUALITY + CONF_WEIGHT_REGIME + CONF_WEIGHT_AGREEMENT)
assert abs(_total - 1.0) < 1e-9, f"Confidence weights must sum to 1.0, got {_total}"

# ATR % reference points for volatility penalty (linear interpolation)
CONF_ATR_LOW: float  = 0.015   # ATR/price => penalty = 0 (maximum confidence)
CONF_ATR_HIGH: float = 0.100   # ATR/price => penalty = 1 (minimum confidence)

# ---------------------------------------------------------------------------
# Data fetching
# ---------------------------------------------------------------------------
HISTORY_PERIOD_FEATURES: str = "2y"
"""yfinance period used to extract the current feature snapshot."""

HISTORY_PERIOD_TRAINING: str = "max"
"""yfinance period used to build the ML training matrix and full price history."""

MIN_TRAINING_ROWS: int = 300
"""Minimum number of rows (after indicator warm-up) needed to train."""

# ---------------------------------------------------------------------------
# Caching
# ---------------------------------------------------------------------------
CACHE_TTL_HOURS: float = 4.0
"""Cached models older than this are considered stale."""

# ---------------------------------------------------------------------------
# US sector ETF mapping for peer P/E comparison (US markets only)
# See market.py for the Indian peer universe.
# ---------------------------------------------------------------------------
SECTOR_ETFS: dict = {
    "Technology":             "XLK",
    "Healthcare":             "XLV",
    "Financial Services":     "XLF",
    "Consumer Cyclical":      "XLY",
    "Consumer Defensive":     "XLP",
    "Energy":                 "XLE",
    "Utilities":              "XLU",
    "Real Estate":            "XLRE",
    "Materials":              "XLB",
    "Industrials":            "XLI",
    "Communication Services": "XLC",
}

# ---------------------------------------------------------------------------
# ML feature columns (single source of truth)
# ---------------------------------------------------------------------------
FEATURE_COLS: list = [
    "rsi",
    "adx",
    "adx_pos",
    "adx_neg",
    "macd_diff",
    "bb_pct",
    "momentum_20d",
    "rolling_std_20",
    "volume_ratio",
    "price_vs_sma50",
    "price_vs_sma200",
    "sma200_slope",
    "atr_pct",
    "regime_code",
]
"""
NOTE ON VALUATION (P/E):
  The current data source (yfinance) does not provide point-in-time
  historical P/E ratios.  Using today's P/E for all historical training
  rows would introduce severe look-ahead bias.

  P/E is therefore treated as a RULE-BASED supporting signal only —
  it is shown in the UI and used in _valuation_signal() but it is NOT
  included in FEATURE_COLS and is NOT fed to XGBoost/LSTM.

  If a point-in-time fundamental data source (e.g. Compustat, Tiingo)
  is added in the future, pe_relative should be appended here.
"""

# ---------------------------------------------------------------------------
# Backtesting & Strategy Benchmarking Settings
# ---------------------------------------------------------------------------
TRANSACTION_COST: float = 0.001
"""Default transaction cost per trade (0.10% / 10 bps)."""

SLIPPAGE: float = 0.0005
"""Default market execution slippage (0.05% / 5 bps)."""

STARTING_CAPITAL: float = 100_000.0
"""Default portfolio starting capital for benchmark simulations."""

SMA_FAST_PERIOD: int = 50
"""Fast moving average period for benchmark strategy."""

SMA_SLOW_PERIOD: int = 200
"""Slow moving average period for benchmark strategy."""

COST_SCENARIOS: list = [0.0, 0.0005, 0.001, 0.002]
"""Transaction cost sensitivity scenarios: 0%, 0.05%, 0.10%, 0.20%."""

# ---------------------------------------------------------------------------
# Explainability (SHAP) Settings
# ---------------------------------------------------------------------------
SHAP_TOP_N: int = 5
"""Number of top positive and top negative contributing features to display."""

