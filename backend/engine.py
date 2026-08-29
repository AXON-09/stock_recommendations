"""
engine.py - Quantitative Feature Engineering Engine

METHODOLOGY & ASSUMPTIONS
==========================
* Forecast horizon  : ~20 trading days (≈ 1 calendar month).
* Target definition : label_t = 1  if  Close[t+20] > Close[t],  else 0.
* "BUY"  signals that the model estimates a higher probability of a
  positive 20-day return — NOT a guarantee of profit.
* "SELL" signals the opposite.
* "HOLD" means the model cannot distinguish with sufficient confidence.
* Recommendations are probabilistic research signals, NOT financial advice.
* Past model performance does not guarantee future results.

MARKET SUPPORT
==============
* 🇮🇳 India — NSE (.NS) and BSE (.BO)
* 🇺🇸 US — NASDAQ, NYSE, and other US exchanges
* 🌐 Other international tickers with explicit Yahoo Finance suffixes

VALUATION NOTE
==============
yfinance does not supply point-in-time historical P/E ratios.
Using today's P/E for every historical training row would introduce
look-ahead bias.  P/E is therefore used only as a RULE-BASED supporting
signal (shown in the UI) and is intentionally excluded from ML features.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np
import pandas as pd
import requests
import yfinance as yf
import warnings

warnings.filterwarnings("ignore")

_SESSION = requests.Session()
_SESSION.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like"
        " Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
})


def _get_google_pe(ticker: str) -> Optional[float]:
    """Fetch live official P/E ratio from Google Finance (open endpoint, never 401s on cloud IPs)."""
    t = ticker.upper().strip()
    queries = []
    if t.endswith(".NS"):
        queries = [f"{t[:-3]}:NSE", f"{t[:-3]}:BOM"]
    elif t.endswith(".BO"):
        queries = [f"{t[:-3]}:BOM", f"{t[:-3]}:NSE"]
    else:
        queries = [f"{t}:NASDAQ", f"{t}:NYSE"]

    for q in queries:
        try:
            r = _SESSION.get(f"https://www.google.com/finance/quote/{q}", timeout=3)
            if r.status_code == 200:
                m = re.search(r"P/E ratio</div><div[^>]*>([0-9,.]+)", r.text)
                if m:
                    val = float(m.group(1).replace(",", ""))
                    if val > 0:
                        return val
        except Exception:
            pass
    return None


import config as cfg
from market import MarketInfo, get_market_info, get_peer_pe, _get_crumb, lookup_sector_fallback, _SESSION

log = logging.getLogger(__name__)

# Re-export for backward compat / convenience
FORWARD_HORIZON = cfg.FORECAST_HORIZON
SEQUENCE_LEN    = cfg.LSTM_SEQUENCE_LENGTH
FEATURE_COLS    = cfg.FEATURE_COLS
SECTOR_ETFS     = cfg.SECTOR_ETFS
REGIME_CODE     = {"trending_up": 1, "trending_down": -1, "choppy": 0}



# ---------------------------------------------------------------------------
# Data containers
# ---------------------------------------------------------------------------
@dataclass
class AssetFeatures:
    """Complete feature snapshot for a single asset at the most recent date."""
    ticker:       str
    display_ticker: str    # user-friendly name (e.g. "RELIANCE" for "RELIANCE.NS")
    price:        float
    sector:       str
    market:       MarketInfo

    # Volatility
    atr:            float
    atr_pct:        float   # ATR / price
    rolling_std_20: float   # 20-day rolling std of daily returns
    ann_vol:        float   # annualised volatility (rolling_std_20 * sqrt(252))

    # Trend
    sma50:           float
    sma200:          float
    price_vs_sma50:  float  # (price - sma50)  / sma50
    price_vs_sma200: float  # (price - sma200) / sma200
    sma200_slope:    float  # (sma200_t - sma200_{t-20}) / sma200_{t-20}
    macd:            float
    macd_signal:     float
    macd_diff:       float

    # Momentum — volatility-adapted RSI thresholds
    rsi:                     float
    rsi_adj_buy_threshold:   float  # asset-adaptive (wider for high-vol assets)
    rsi_adj_sell_threshold:  float  # asset-adaptive (wider for high-vol assets)
    momentum_20d:            float  # raw 20-day price return
    momentum_20d_normalized: float  # momentum / (rolling_std_20 * sqrt(20)), clipped ±3

    # Regime
    adx:             float
    adx_pos:         float
    adx_neg:         float
    regime:          str    # "trending_up" | "trending_down" | "choppy"
    regime_strength: float  # 0-1 (higher → clearer regime)

    # Fundamentals — rule-based signal only, NOT an ML feature (see module docstring)
    pe_ratio:         Optional[float]
    peer_pe:          Optional[float]   # sector/peer median P/E (market-aware)
    pe_relative:      Optional[float]   # (pe / peer_pe) - 1
    pb_ratio:         Optional[float]

    # Bollinger Bands
    bb_upper: float
    bb_lower: float
    bb_pct:   float  # 0 = at lower band, 1 = at upper band

    # Volume
    volume_ratio: float  # today's volume / 20-day average volume

    # Data quality
    data_completeness: float  # fraction of expected indicators that are non-NaN


# ---------------------------------------------------------------------------
# Data fetching
# ---------------------------------------------------------------------------
def fetch_raw_data(ticker: str, period: str = cfg.HISTORY_PERIOD_FEATURES) -> pd.DataFrame:
    """
    Fetch OHLCV data from Yahoo Finance.

    Raises:
        ValueError: if no data is returned (invalid / delisted ticker).
        RuntimeError: on network / API failures.
    """
    try:
        tk = yf.Ticker(ticker, session=_SESSION)
        df = tk.history(period=period, auto_adjust=True)
    except Exception as exc:
        raise RuntimeError(
            f"Failed to fetch data for '{ticker}' from Yahoo Finance: {exc}"
        ) from exc

    if df is None or df.empty:
        raise ValueError(
            f"No price data returned for '{ticker}'. "
            "The ticker may be invalid, delisted, or temporarily unavailable."
        )

    df.index = pd.to_datetime(df.index, utc=True).tz_localize(None)
    cols = [c for c in ["Open", "High", "Low", "Close", "Volume"] if c in df.columns]
    df = df[cols].copy()
    df.dropna(how="all", inplace=True)

    if len(df) < 50:
        raise ValueError(
            f"Insufficient price history for '{ticker}' "
            f"(got {len(df)} rows, need at least 50)."
        )
    return df


def fetch_info(ticker: str) -> dict:
    """
    Fetch fundamental metadata with multi-tier fallback:
    1. yf.Ticker.info
    2. Yahoo v7 Quote API authenticated with session cookie + crumb
    3. EPS-based P/E calculation fallback
    4. Curated sector mappings for Indian/US stocks
    """
    info: dict = {}

    # Tier 1: Yahoo v7 Quote API with session crumb (most reliable on cloud IPs)
    crumb = _get_crumb()
    for domain in ["https://query2.finance.yahoo.com", "https://query1.finance.yahoo.com"]:
        try:
            url = f"{domain}/v7/finance/quote?symbols={ticker}"
            if crumb:
                url += f"&crumb={crumb}"
            r = _SESSION.get(url, timeout=4)
            if r.status_code == 200:
                results = r.json().get("quoteResponse", {}).get("result", [])
                if results and isinstance(results[0], dict):
                    q = results[0]
                    for k, v in q.items():
                        info[k] = v
                    if "trailingPE" in q:
                        info["trailingPE"] = q["trailingPE"]
                    elif q.get("epsTrailingTwelveMonths") and q.get("regularMarketPrice"):
                        eps = q["epsTrailingTwelveMonths"]
                        price = q["regularMarketPrice"]
                        if eps and eps > 0 and price and price > 0:
                            info["trailingPE"] = price / eps
                    if "forwardPE" in q:
                        info["forwardPE"] = q["forwardPE"]
                    if "priceToBook" in q:
                        info["priceToBook"] = q["priceToBook"]
                    if "sector" in q:
                        info["sector"] = q["sector"]
                    break
        except Exception:
            continue

    # Tier 2: yfinance info fallback
    if not info.get("trailingPE") and not info.get("forwardPE"):
        try:
            raw = yf.Ticker(ticker, session=_SESSION).info
            if isinstance(raw, dict) and len(raw) > 5:
                for k, v in raw.items():
                    if k not in info:
                        info[k] = v
        except Exception:
            pass

    # Tier 3: Google Finance live P/E fallback (100% cloud-reliable)
    if not info.get("trailingPE"):
        g_pe = _get_google_pe(ticker)
        if g_pe:
            info["trailingPE"] = g_pe

    # Tier 4: Sector resolution fallback
    sec = info.get("sector")
    if not sec or sec == "Unknown" or sec is None:
        try:
            fallback_sec = lookup_sector_fallback(ticker)
            if fallback_sec:
                info["sector"] = fallback_sec
        except Exception:
            pass

    return info






def _make_display_ticker(ticker: str) -> str:
    """
    Return a user-friendly display name.
    RELIANCE.NS → RELIANCE
    RELIANCE.BO → RELIANCE
    AAPL        → AAPL
    ^NSEI       → NIFTY 50
    """
    _FRIENDLY: dict = {
        "^NSEI":    "NIFTY 50",
        "^NSEBANK": "NIFTY BANK",
        "^BSESN":   "SENSEX",
    }
    if ticker in _FRIENDLY:
        return _FRIENDLY[ticker]
    if "." in ticker:
        return ticker.rsplit(".", 1)[0]
    return ticker


# ---------------------------------------------------------------------------
# Technical indicators (computed manually to avoid ta-lib version issues)
# ---------------------------------------------------------------------------
def _ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add all technical indicator columns to df (in-place copy returned).
    No look-ahead: every calculation uses only past data at each row.
    """
    df    = df.copy()
    close = df["Close"]
    high  = df["High"]
    low   = df["Low"]

    # ── ATR (14-period Wilder smoothed) ─────────────────────────────────────
    tr = pd.concat(
        [
            high - low,
            (high - close.shift(1)).abs(),
            (low  - close.shift(1)).abs(),
        ],
        axis=1,
    ).max(axis=1)
    df["atr"] = tr.ewm(span=14, adjust=False).mean()

    # ── ADX (Wilder, 14) ────────────────────────────────────────────────────
    plus_dm  = high.diff().clip(lower=0)
    minus_dm = (-low.diff()).clip(lower=0)
    plus_dm  = plus_dm.where(plus_dm  > minus_dm, 0.0)
    minus_dm = minus_dm.where(minus_dm > plus_dm,  0.0)
    atr14    = tr.ewm(span=14, adjust=False).mean()
    plus_di  = 100 * plus_dm.ewm(span=14, adjust=False).mean()  / atr14
    minus_di = 100 * minus_dm.ewm(span=14, adjust=False).mean() / atr14
    dx = (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan) * 100
    df["adx"]     = dx.ewm(span=14, adjust=False).mean()
    df["adx_pos"] = plus_di
    df["adx_neg"] = minus_di

    # ── RSI (14-period EWM) ─────────────────────────────────────────────────
    delta = close.diff()
    gain  = delta.clip(lower=0)
    loss  = (-delta).clip(lower=0)
    avg_g = gain.ewm(span=14, adjust=False).mean()
    avg_l = loss.ewm(span=14, adjust=False).mean()
    rs    = avg_g / avg_l.replace(0, np.nan)
    df["rsi"] = 100 - (100 / (1 + rs))

    # ── Moving averages ──────────────────────────────────────────────────────
    df["sma50"]  = close.rolling(50).mean()
    df["sma200"] = close.rolling(200).mean()

    # ── MACD (12/26/9) ───────────────────────────────────────────────────────
    ema12     = _ema(close, 12)
    ema26     = _ema(close, 26)
    macd_line = ema12 - ema26
    macd_sig  = _ema(macd_line, 9)
    df["macd"]        = macd_line
    df["macd_signal"] = macd_sig
    df["macd_diff"]   = macd_line - macd_sig

    # ── Bollinger Bands (20/2) ───────────────────────────────────────────────
    sma20     = close.rolling(20).mean()
    std20     = close.rolling(20).std()
    df["bb_upper"] = sma20 + 2 * std20
    df["bb_lower"] = sma20 - 2 * std20
    band_w         = df["bb_upper"] - df["bb_lower"]
    df["bb_pct"]   = (close - df["bb_lower"]) / band_w.replace(0, np.nan)

    # ── Rolling statistics ───────────────────────────────────────────────────
    df["returns"]        = close.pct_change()
    df["rolling_std_20"] = df["returns"].rolling(20).std()
    vol_ma20             = df["Volume"].rolling(20).mean()
    df["volume_ratio"]   = df["Volume"] / vol_ma20.replace(0, np.nan)

    # ── Momentum / trend ────────────────────────────────────────────────────
    df["momentum_20d"]    = close.pct_change(20)
    sma200_lag            = df["sma200"].shift(20)
    df["sma200_slope"]    = (df["sma200"] - sma200_lag) / sma200_lag.replace(0, np.nan)
    df["price_vs_sma50"]  = (close - df["sma50"])  / df["sma50"].replace(0, np.nan)
    df["price_vs_sma200"] = (close - df["sma200"]) / df["sma200"].replace(0, np.nan)
    df["atr_pct"]         = df["atr"] / close

    return df


# ---------------------------------------------------------------------------
# Regime detection
# ---------------------------------------------------------------------------
def detect_regime(
    adx: float,
    adx_pos: float,
    adx_neg: float,
    price_vs_sma200: float,
    sma200_slope: float,
) -> Tuple[str, float]:
    """
    Classify the current market regime.

    Rules
    -----
    * ADX > ADX_TREND_THRESHOLD (default 25) → trending market.
      - If +DI > -DI  AND  price > SMA200  AND  SMA200 sloping up  → "trending_up"
      - If -DI > +DI  AND  price < SMA200  AND  SMA200 sloping down → "trending_down"
    * Otherwise → "choppy".

    Regime strength (0–1)
    ----------------------
    * Trending: min(adx / 50, 1.0)   — saturates at ADX = 50.
    * Choppy:   max(0, 1 - adx / 25) — 1 at ADX = 0, 0 at ADX = 25.

    Returns
    -------
    (regime_name, strength)
    """
    thr = cfg.ADX_TREND_THRESHOLD
    if adx > thr:
        if adx_pos > adx_neg and price_vs_sma200 > 0 and sma200_slope > 0:
            return "trending_up",   min(adx / 50.0, 1.0)
        if adx_neg > adx_pos and price_vs_sma200 < 0 and sma200_slope < 0:
            return "trending_down", min(adx / 50.0, 1.0)
    return "choppy", max(0.0, 1.0 - adx / thr)


# ---------------------------------------------------------------------------
# Volatility-adapted RSI thresholds
# ---------------------------------------------------------------------------
def volatility_adjusted_rsi_thresholds(
    rolling_std_20: float,
) -> Tuple[float, float]:
    """
    Compute asset-adaptive RSI buy/sell thresholds.

    Design parameters (all in config.py):
      RSI_BASE_BUY      = 30   (baseline buy threshold)
      RSI_BASE_SELL     = 70   (baseline sell threshold)
      RSI_VOL_BASELINE  = 10%  annualised vol → zero adjustment
      RSI_VOL_SCALE     = 40%  vol range over which max adjustment applies
      RSI_MAX_WIDEN     = +10 points (high-vol widens the band)
      RSI_MAX_NARROW    = -5  points (low-vol narrows the band)

    Formula:
      ann_vol    = rolling_std_20 * sqrt(252)
      raw_adj    = (ann_vol - RSI_VOL_BASELINE) / RSI_VOL_SCALE * RSI_MAX_WIDEN
      adj        = clip(raw_adj, -RSI_MAX_NARROW, RSI_MAX_WIDEN)
      buy_thresh = RSI_BASE_BUY  - adj   (lower  → must be more oversold)
      sell_thresh= RSI_BASE_SELL + adj   (higher → must be more overbought)
    """
    ann_vol = float(rolling_std_20) * np.sqrt(252)
    raw_adj = (ann_vol - cfg.RSI_VOL_BASELINE) / cfg.RSI_VOL_SCALE * cfg.RSI_MAX_WIDEN
    adj = float(np.clip(raw_adj, -cfg.RSI_MAX_NARROW, cfg.RSI_MAX_WIDEN))
    buy_thresh  = round(cfg.RSI_BASE_BUY  - adj, 1)
    sell_thresh = round(cfg.RSI_BASE_SELL + adj, 1)
    # Hard bounds to prevent nonsensical thresholds
    buy_thresh  = float(np.clip(buy_thresh,  15.0, 45.0))
    sell_thresh = float(np.clip(sell_thresh, 55.0, 85.0))
    return buy_thresh, sell_thresh


# ---------------------------------------------------------------------------
# Feature extraction — current snapshot
# ---------------------------------------------------------------------------
def extract_features(ticker: str) -> AssetFeatures:
    """
    Fetch live price data, compute all indicators, and return an AssetFeatures
    snapshot representing the current state of the asset.

    Parameters
    ----------
    ticker : resolved Yahoo Finance ticker (e.g. "RELIANCE.NS" or "AAPL")
             Use market.resolve_ticker_with_fallback() before calling this.

    Raises ValueError / RuntimeError with human-readable messages on failure.
    """
    df   = fetch_raw_data(ticker, period=cfg.HISTORY_PERIOD_FEATURES)
    info = fetch_info(ticker)
    df   = compute_indicators(df)

    # Drop rows that don't have all core indicators
    df.dropna(subset=["sma200", "adx", "rsi", "atr"], inplace=True)
    if df.empty:
        raise ValueError(
            f"Insufficient data for '{ticker}' after computing indicators. "
            "At least 200 trading days of history are required."
        )

    row   = df.iloc[-1]
    price = float(row["Close"])

    # Guard against NaN in price
    if not np.isfinite(price) or price <= 0:
        raise ValueError(f"Invalid price ({price}) for '{ticker}'.")

    # Market metadata
    market         = get_market_info(ticker, info)
    display_ticker = _make_display_ticker(ticker)

    regime, strength = detect_regime(
        adx=float(row["adx"]),
        adx_pos=float(row["adx_pos"]),
        adx_neg=float(row["adx_neg"]),
        price_vs_sma200=float(row["price_vs_sma200"]),
        sma200_slope=float(row["sma200_slope"]),
    )

    rolling_std = float(row["rolling_std_20"]) if np.isfinite(row["rolling_std_20"]) else 0.02
    ann_vol     = rolling_std * np.sqrt(252)
    buy_t, sell_t = volatility_adjusted_rsi_thresholds(rolling_std)

    # Fundamentals (rule-based signal only — see module docstring)
    sector   = str(info.get("sector", "Unknown") or "Unknown")
    # Valuation metrics (P/E, peer P/E, P/B) are intentionally not applicable
    # to ETFs/funds — a fund's reported "P/E" (when present at all) reflects
    # the underlying basket, not a single business, and is not comparable to
    # a sector peer median the way a stock's P/E is. Force these to None for
    # ETFs so the UI/API never has to explain a stray number.
    if market.is_etf:
        pe_ratio = None
        peer_pe  = None
        pe_rel   = None
        pb_ratio = None
    else:
        pe_raw   = info.get("trailingPE") or info.get("forwardPE")
        pe_ratio = float(pe_raw) if (pe_raw and np.isfinite(pe_raw) and pe_raw > 0) else None
        # Market-aware peer P/E (Indian stocks use peer median; US uses sector ETF)
        peer_pe  = get_peer_pe(sector, market)
        pe_rel   = (pe_ratio / peer_pe - 1.0) if (pe_ratio and peer_pe) else None
        pb_raw   = info.get("priceToBook")
        pb_ratio = float(pb_raw) if (pb_raw and np.isfinite(pb_raw) and pb_raw > 0) else None

    # Normalized momentum
    mom       = float(row["momentum_20d"]) if np.isfinite(row["momentum_20d"]) else 0.0
    mom_denom = rolling_std * np.sqrt(20)
    mom_norm  = float(np.clip(mom / mom_denom, -3.0, 3.0)) if mom_denom > 0 else 0.0

    # Data completeness
    _check = ["atr", "adx", "rsi", "sma50", "sma200", "macd", "bb_upper", "bb_pct"]
    completeness = sum(1 for c in _check if np.isfinite(row.get(c, np.nan))) / len(_check)

    def _safe(col: str, default: float = 0.0) -> float:
        v = row.get(col, np.nan)
        return float(v) if np.isfinite(v) else default

    return AssetFeatures(
        ticker=ticker,
        display_ticker=display_ticker,
        price=price,
        sector=sector,
        market=market,
        atr=_safe("atr"),
        atr_pct=_safe("atr_pct"),
        rolling_std_20=rolling_std,
        ann_vol=ann_vol,
        sma50=_safe("sma50"),
        sma200=_safe("sma200"),
        price_vs_sma50=_safe("price_vs_sma50"),
        price_vs_sma200=_safe("price_vs_sma200"),
        sma200_slope=_safe("sma200_slope"),
        macd=_safe("macd"),
        macd_signal=_safe("macd_signal"),
        macd_diff=_safe("macd_diff"),
        rsi=_safe("rsi"),
        rsi_adj_buy_threshold=buy_t,
        rsi_adj_sell_threshold=sell_t,
        momentum_20d=mom,
        momentum_20d_normalized=mom_norm,
        adx=_safe("adx"),
        adx_pos=_safe("adx_pos"),
        adx_neg=_safe("adx_neg"),
        regime=regime,
        regime_strength=strength,
        pe_ratio=pe_ratio,
        peer_pe=peer_pe,
        pe_relative=pe_rel,
        pb_ratio=pb_ratio,
        bb_upper=_safe("bb_upper"),
        bb_lower=_safe("bb_lower"),
        bb_pct=_safe("bb_pct", default=0.5),
        volume_ratio=_safe("volume_ratio", default=1.0),
        data_completeness=completeness,
    )


# ---------------------------------------------------------------------------
# Historical feature matrix for ML training
# ---------------------------------------------------------------------------
def build_feature_matrix(
    ticker: str,
) -> Tuple[pd.DataFrame, pd.Series, pd.DataFrame]:
    """
    Fetch 5 years of OHLCV data, compute all indicators, and build the
    feature matrix (X) and binary label vector (y) used to train models.

    Label definition
    ----------------
      y[t] = 1   if   Close[t + FORECAST_HORIZON] > Close[t]   else 0.

    The last FORECAST_HORIZON rows are dropped because their labels
    depend on prices beyond the end of the dataset.

    Returns
    -------
    X   : pd.DataFrame  shape (N, len(FEATURE_COLS))
    y   : pd.Series     shape (N,)  int {0, 1}
    df  : pd.DataFrame  full DataFrame including all indicator columns
    """
    df = fetch_raw_data(ticker, period=cfg.HISTORY_PERIOD_TRAINING)
    df = compute_indicators(df)
    df.dropna(subset=["sma200", "adx", "rsi", "atr"], inplace=True)

    if len(df) < cfg.MIN_TRAINING_ROWS:
        raise ValueError(
            f"Only {len(df)} rows available for '{ticker}' after warm-up. "
            f"Need at least {cfg.MIN_TRAINING_ROWS}."
        )

    # Forward returns and labels
    df["fwd_return"] = df["Close"].shift(-cfg.FORECAST_HORIZON) / df["Close"] - 1
    df["label"]      = (df["fwd_return"] > 0).astype(int)
    df.dropna(subset=["fwd_return"], inplace=True)

    # Regime code (vectorised — avoids slow iterrows)
    adx_mask_trend = df["adx"] > cfg.ADX_TREND_THRESHOLD
    up_mask   = adx_mask_trend & (df["adx_pos"] > df["adx_neg"]) & (df["price_vs_sma200"] > 0) & (df["sma200_slope"] > 0)
    down_mask = adx_mask_trend & (df["adx_neg"] > df["adx_pos"]) & (df["price_vs_sma200"] < 0) & (df["sma200_slope"] < 0)
    df["regime_code"] = 0
    df.loc[up_mask,   "regime_code"] =  1
    df.loc[down_mask, "regime_code"] = -1

    X = df[cfg.FEATURE_COLS].copy()
    y = df["label"].copy()

    # Replace any remaining NaN/inf with 0 (data quality guard)
    X = X.replace([np.inf, -np.inf], np.nan).fillna(0.0)

    return X, y, df
