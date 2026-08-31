"""
main.py - FastAPI backend for QuantView AI

Supports:
  🇮🇳 Indian NSE/BSE stocks and ETFs
  🇺🇸 US stocks and ETFs

* Serves the frontend via StaticFiles — no separate HTTP server needed.
* All API endpoints are under /api/.
* The frontend is served at /.

Run via run.py at project root:
    python run.py
Or directly:
    uvicorn backend.main:app --port 8000
"""

from __future__ import annotations

import logging
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
import yfinance as yf
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field


# Allow imports from backend/ when run from project root
sys.path.insert(0, str(Path(__file__).parent))

import config as cfg
from engine import (
    build_institutional_intelligence,
    fetch_ticker_news,
    fetch_press_releases,
    fetch_info,
    AssetFeatures,
    FEATURE_COLS,
    REGIME_CODE,
    SEQUENCE_LEN,
    build_feature_matrix,
    extract_features,
)
from market import resolve_ticker_with_fallback, get_market_info, MarketInfo
from models import StockRecommender
from backtest import run_benchmark_comparison, BenchmarkComparisonResult



logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
log = logging.getLogger(__name__)

import os
import asyncio
from collections import defaultdict

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
app = FastAPI(
    title="QuantView AI — Multi-Market Stock Recommendation System",
    description=(
        "ML-powered quantitative research signals for Indian and US stocks & ETFs. "
        "Supports NSE, BSE, NASDAQ, NYSE. "
        "Recommendations target a ~20 trading-day forward horizon. "
        "NOT financial advice."
    ),
    version="3.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# Configurable CORS: read from environment, default to * for dev
_cors_origins_env = os.environ.get("CORS_ORIGINS", "*")
_allowed_origins = [o.strip() for o in _cors_origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins if _allowed_origins else ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Operational Metrics & Rate Limiting (In-Memory)
# Note: In-memory counters are local to this process instance. For multi-instance
# production deployments, use a centralized store such as Redis.
# ---------------------------------------------------------------------------
_METRICS = {
    "start_time": time.time(),
    "total_requests": 0,
    "recommend_requests": 0,
    "cache_hits": 0,
    "cache_misses": 0,
    "training_failures": 0,
}

_RATE_LIMIT_STORE: Dict[str, List[float]] = defaultdict(list)
_RATE_LIMIT_WINDOW = 60.0  # 1 minute window
_RATE_LIMIT_MAX_PER_MIN = 20  # Max 20 heavy requests/min per IP

def _check_rate_limit(client_ip: str) -> bool:
    """Check in-memory sliding window rate limit. Returns True if allowed, False if exceeded."""
    if os.environ.get("PYTEST_CURRENT_TEST") or client_ip in ("testclient", "test_runner"):
        return True
    now = time.time()
    cutoff = now - _RATE_LIMIT_WINDOW
    history = _RATE_LIMIT_STORE[client_ip]
    # Prune old entries
    _RATE_LIMIT_STORE[client_ip] = [t for t in history if t > cutoff]
    if len(_RATE_LIMIT_STORE[client_ip]) >= _RATE_LIMIT_MAX_PER_MIN:
        return False
    _RATE_LIMIT_STORE[client_ip].append(now)
    return True

# ---------------------------------------------------------------------------
# In-memory cache  {resolved_ticker → CacheEntry}
# ---------------------------------------------------------------------------
class CacheEntry:
    def __init__(self, model: StockRecommender, X: pd.DataFrame, df: pd.DataFrame, info: Optional[dict] = None):
        self.model    = model
        self.X        = X       # feature matrix (for LSTM sequence)
        self.df       = df      # full DataFrame (for forward-return stats)
        self.info     = info or {}
        self.created  = datetime.now(timezone.utc)

    @property
    def age_hours(self) -> float:
        return (datetime.now(timezone.utc) - self.created).total_seconds() / 3600

    @property
    def is_stale(self) -> bool:
        return self.age_hours > cfg.CACHE_TTL_HOURS

    def to_meta(self) -> dict:
        return {
            "trained_at":   self.model.trained_at.isoformat() if self.model.trained_at else None,
            "data_through": self.df.index[-1].strftime("%Y-%m-%d") if hasattr(self.df.index[-1], "strftime") else str(self.df.index[-1]),
            "age_hours":    round(self.age_hours, 2),
            "is_stale":     self.is_stale,
        }


_cache: Dict[str, CacheEntry] = {}


# ---------------------------------------------------------------------------
# Pydantic response models
# ---------------------------------------------------------------------------
class MarketInfoModel(BaseModel):
    country:         str
    exchange:        str
    currency:        str
    currency_symbol: str
    is_india:        bool
    is_etf:          bool
    etf_category:    Optional[str] = Field(None, description="e.g. 'Gold ETF'. None for non-ETFs or when Yahoo doesn't supply enough metadata to classify.")
    company_name:    Optional[str] = Field(None, description="Official company or ETF full name.")


class RegimeInfo(BaseModel):
    name:          str   = Field(..., description="trending_up | trending_down | choppy")
    adx:           float = Field(..., description="ADX value (0-100)")
    adx_pos:       float = Field(..., description="+DI value")
    adx_neg:       float = Field(..., description="-DI value")
    sma200_slope:  float = Field(..., description="Fractional slope of SMA200 over 20 days")
    clarity:       float = Field(..., description="Regime clarity / strength (0-1)")


class VolatilityInfo(BaseModel):
    rsi:                 float  = Field(..., description="Current RSI value")
    annualized:          float  = Field(..., description="Annualised volatility (decimal, e.g. 0.18)")
    atr:                 float  = Field(..., description="Average True Range in native currency units")
    atr_percent:         float  = Field(..., description="ATR as % of price")
    rsi_buy_threshold:   float  = Field(..., description="Asset-adaptive RSI buy threshold")
    rsi_sell_threshold:  float  = Field(..., description="Asset-adaptive RSI sell threshold")


class ValuationInfo(BaseModel):
    pe_ratio:        Optional[float] = Field(None)
    peer_pe:         Optional[float] = Field(None, description="Sector/peer median P/E (market-aware)")
    pe_relative_pct: Optional[float] = Field(None, description="(pe/peer_pe - 1) * 100")
    pb_ratio:        Optional[float] = Field(None)
    signal:          str             = Field(..., description="undervalued | fair | overvalued | unavailable | not_applicable")
    is_etf:          bool            = Field(False)
    note:            str             = Field(..., description="Clarifies rule-based vs ML signal")


class SignalsInfo(BaseModel):
    rsi:       str
    trend:     str
    macd:      str
    momentum:  str
    volume:    str
    valuation: str


class LSTMInfo(BaseModel):
    available:   bool
    probability: Optional[float]  = Field(None, description="None when LSTM is unavailable")
    reason:      Optional[str]    = Field(None, description="Why LSTM is unavailable, if applicable")


class ModelsInfo(BaseModel):
    xgb_probability:      float
    lstm:                 LSTMInfo
    ensemble_probability: float


class ConfidenceInfo(BaseModel):
    score:                          float              = Field(..., description="0-100")
    label:                          str                = Field(..., description="High | Medium | Low")
    lstm_excluded_from_agreement:   bool               = Field(..., description="True when LSTM unavailable and agreement component excluded")
    components: Dict[str, Optional[float]]             = Field(..., description="Individual normalised components (0-1 each, null when excluded)")


class BacktestInfo(BaseModel):
    # Classification metrics
    accuracy:              Optional[float]
    precision:             Optional[float]
    recall:                Optional[float]
    f1:                    Optional[float]
    roc_auc:               Optional[float]
    brier_score:           Optional[float]
    # Stacking layer
    xgb_coefficient:       Optional[float] = Field(None, description="Logistic stacking coefficient for XGBoost probability. Not a percentage weight.")
    lstm_coefficient:      Optional[float] = Field(None, description="Logistic stacking coefficient for LSTM probability. None when LSTM unavailable.")
    # OOF metadata
    oof_samples:           Optional[int]
    oof_positive_samples:  Optional[int]
    forecast_horizon_days: int
    purge_period_days:     int
    # Forward return stats
    avg_fwd_return_pct:    Optional[float] = Field(None, description="Average T+20 forward return of training set (%)")
    med_fwd_return_pct:    Optional[float] = Field(None, description="Median T+20 forward return of training set (%)")
    lstm_available:        bool
    lstm_used_in_stacking: bool


class CacheInfo(BaseModel):
    hit:          bool
    trained_at:   Optional[str]
    data_through: Optional[str]
    age_hours:    Optional[float]


class FeatureExplanationItem(BaseModel):
    feature:      str
    display_name: str
    value:        float
    shap_value:   float


class ExplanationInfo(BaseModel):
    available:             bool
    base_value:            Optional[float] = None
    model_output:          Optional[float] = None
    top_positive_features: List[FeatureExplanationItem] = Field(default_factory=list)
    top_negative_features: List[FeatureExplanationItem] = Field(default_factory=list)
    reason:                Optional[str] = None


class StrategyMetricsModel(BaseModel):
    name:         str
    total_return: float
    cagr:         float
    sharpe:       float
    max_drawdown: float
    volatility:   float
    trades:       int
    win_rate:     Optional[float] = None


class CostScenarioModel(BaseModel):
    cost_pct:     float
    cost_label:   str
    total_return: float
    cagr:         float
    sharpe:       float
    max_drawdown: float


class BenchmarkPeriodModel(BaseModel):
    start:        str
    end:          str
    trading_days: int


class PriceHistoryPoint(BaseModel):
    date:   str
    close:  float
    open:   Optional[float] = None
    high:   Optional[float] = None
    low:    Optional[float] = None
    volume: Optional[float] = None
    sma50:  Optional[float] = None
    sma200: Optional[float] = None


class BenchmarkResponse(BaseModel):
    success:          bool = True
    ticker:           str
    display_ticker:   str
    currency_symbol:  str  = "$"
    period:           BenchmarkPeriodModel
    starting_capital: float
    transaction_cost: float
    slippage:         float
    strategies:       List[StrategyMetricsModel]
    equity_curve:     List[Dict[str, Any]]
    cost_scenarios:   List[CostScenarioModel]
    disclaimer:       str



class InstitutionalIntelligenceModel(BaseModel):
    analyst_rating: str = Field("BUY", description="Consensus analyst rating")
    analyst_score: float = Field(75.0, description="0-100 gauge score for speedometer")
    analyst_count: int = Field(0, description="Number of analysts covering the stock")
    target_price: Optional[float] = Field(None, description="Consensus 12M price target")
    target_high: Optional[float] = Field(None, description="High price target or 52W High")
    target_low: Optional[float] = Field(None, description="Low price target or 52W Low")
    target_currency: str = Field("INR", description="Currency code (INR or USD)")
    currency_symbol: str = Field("₹", description="Currency symbol (₹ or $)")
    revenue_forecast: str = Field("→ Stable", description="↑ Growing | → Stable | ↓ Declining | N/A")
    revenue_period: str = Field("Next quarter", description="Forecast period e.g. Next quarter / YoY Trailing")
    revenue_growth_pct: Optional[float] = Field(None, description="YoY or QoQ revenue growth %")
    valuation_label: str = Field("Fair P/S", description="Low P/S | Fair P/S | High P/S | N/A")
    ps_ratio: Optional[float] = Field(None, description="Price to Sales ratio")
    trading_volume: Optional[int] = Field(None, description="Latest trading volume in shares")
    trading_volume_str: str = Field("N/A", description="Formatted volume e.g. 12.4M shares")
    volume_status: str = Field("Normal", description="High | Normal | Low")
    volume_ratio: float = Field(1.0, description="Volume vs 20-day average")
    profitability_label: str = Field("Moderate Gross Margin", description="High Gross Margin | Moderate Gross Margin | Low Gross Margin | N/A")
    gross_margin_pct: Optional[float] = Field(None, description="Gross Margin %")
    operating_margin_pct: Optional[float] = Field(None, description="Operating Margin %")
    provider: str = Field("Twelve Data", description="Data provider")
    # Context-aware ETF / Index intelligence fields:
    is_fund: bool = Field(False, description="True if instrument is an ETF / Index / Index Fund")
    fund_type: Optional[str] = Field(None, description="ETF/Index classification")
    benchmark_name: Optional[str] = Field(None, description="Benchmark index name")
    holdings_count_str: Optional[str] = Field(None, description="Number of holdings / constituents")
    diversification: Optional[str] = Field(None, description="Diversification rating e.g. High")
    replication_type: Optional[str] = Field(None, description="Replication type e.g. Full Replication")
    tracking_error: Optional[str] = Field(None, description="Tracking error e.g. < 0.05%")
    aum_str: Optional[str] = Field(None, description="AUM string")
    expense_ratio_str: Optional[str] = Field(None, description="Expense ratio string")
    fund_category: Optional[str] = Field(None, description="Fund category")
    weighted_pe_str: Optional[str] = Field(None, description="Weighted average P/E")
    weighted_pb_str: Optional[str] = Field(None, description="Weighted average P/B")
    portfolio_style: Optional[str] = Field(None, description="Portfolio style e.g. Large Blend")
    liquidity_rating: Optional[str] = Field(None, description="Liquidity rating")
    top_sector: Optional[str] = Field(None, description="Top sector")
    top_holding: Optional[str] = Field(None, description="Top holding")


class TickerNewsStoryModel(BaseModel):
    title: str
    publisher: str
    time_ago: str
    link: str
    uuid: str

class RecommendationResponse(BaseModel):
    success:          bool = True
    ticker:           str
    display_ticker:   str
    market:           MarketInfoModel
    price:            float
    sector:           str
    company_name:     Optional[str] = Field(None, description="Official company or fund name")
    logo_url:         Optional[str] = Field(None, description="Direct logo image URL if available")
    recommendation:   str  = Field(..., description="Buy | Sell | Hold")
    probability:      float = Field(..., description="Ensemble probability (0-1)")
    forecast_horizon: str  = Field("~20 trading sessions", description="Forecast horizon")
    regime:           RegimeInfo
    volatility:       VolatilityInfo
    valuation:        ValuationInfo
    signals:          SignalsInfo
    models:           ModelsInfo
    confidence:       ConfidenceInfo
    backtest:         BacktestInfo
    cache:            CacheInfo
    explanation:      Optional[ExplanationInfo] = None
    price_history:    List[PriceHistoryPoint] = Field(default_factory=list, description="Historical price points for Groww-style interactive chart")
    institutional_intelligence: Optional[InstitutionalIntelligenceModel] = Field(None, description="6-card institutional & fundamental intelligence")
    ticker_news:      List[TickerNewsStoryModel] = Field(default_factory=list, description="Live ticker-specific news stories")
    press_releases:   List[TickerNewsStoryModel] = Field(default_factory=list, description="Official corporate press releases and disclosures")
    disclaimer:       str



class ErrorResponse(BaseModel):
    success:       bool = False
    error:         str
    ticker:        Optional[str] = None
    display_ticker: Optional[str] = None



_DISCLAIMER = (
    "This system provides quantitative research signals, not financial advice. "
    "Recommendations represent an estimated risk/reward outlook over approximately "
    "20 trading sessions and should not be interpreted as guaranteed future returns. "
    "Past backtest performance does not guarantee future results. "
    "Yahoo Finance data is used; point-in-time historical fundamentals are not available."
)

_VALUATION_NOTE_LIVE = (
    "Live rule-based signal — not used in historical ML training. "
    "yfinance does not provide point-in-time historical P/E data; "
    "using today's P/E for historical training rows would introduce look-ahead bias."
)

_VALUATION_NOTE_ETF = (
    "Valuation metrics are unavailable for ETFs and index funds. "
    "These metrics (P/E Ratio, Peer Median P/E, and Relative P/E Premium/Discount) "
    "measure the valuation of a single operating company. Since ETFs and index funds "
    "represent a diversified basket of holdings rather than one company, these metrics "
    "are not meaningful and are therefore not displayed."
)


# ---------------------------------------------------------------------------
# Helper: build prediction inputs
# ---------------------------------------------------------------------------
def _build_x_point(features: AssetFeatures) -> pd.DataFrame:
    """Build the point-in-time feature row for XGBoost."""
    row = {
        "rsi":             features.rsi,
        "adx":             features.adx,
        "adx_pos":         features.adx_pos,
        "adx_neg":         features.adx_neg,
        "macd_diff":       features.macd_diff,
        "bb_pct":          features.bb_pct,
        "momentum_20d":    features.momentum_20d,
        "rolling_std_20":  features.rolling_std_20,
        "volume_ratio":    features.volume_ratio,
        "price_vs_sma50":  features.price_vs_sma50,
        "price_vs_sma200": features.price_vs_sma200,
        "sma200_slope":    features.sma200_slope,
        "atr_pct":         features.atr_pct,
        "regime_code":     REGIME_CODE[features.regime],
    }
    return pd.DataFrame([row], columns=FEATURE_COLS)


def _build_lstm_sequence(
    entry: CacheEntry,
) -> Optional[np.ndarray]:
    """
    Build the LSTM input sequence using the tail of the training data.
    Returns (SEQUENCE_LEN, n_features) float32 array or None.
    """
    try:
        hist_scaled = entry.model.lstm_scaler.transform(entry.X.values)
        if len(hist_scaled) >= SEQUENCE_LEN:
            return hist_scaled[-SEQUENCE_LEN:].astype(np.float32)
        return None
    except Exception as exc:
        log.warning("Could not build LSTM sequence: %s", exc)
        return None


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------
@app.get(
    "/api/recommend",
    response_model=RecommendationResponse,
    responses={
        404: {"model": ErrorResponse, "description": "Ticker not found or insufficient data"},
        500: {"model": ErrorResponse, "description": "Internal server error"},
    },
    summary="Get stock/ETF recommendation",
    tags=["Recommendation"],
)
def get_recommendation(
    request: Request,
    ticker: str = Query(..., description="Stock or ETF ticker (e.g. AAPL, RELIANCE, RELIANCE.NS, SPY)"),
    refresh: bool = Query(False, description="Force-retrain model ignoring the cache"),
) -> RecommendationResponse:
    """
    Fetch live market data for an Indian or US stock/ETF, compute technical
    indicators, run the ML ensemble, and return a structured recommendation.

    **Ticker formats supported**:
    - Indian NSE: `RELIANCE`, `RELIANCE.NS`, `TCS`, `NIFTYBEES.NS`
    - Indian BSE: `RELIANCE.BO`
    - US: `AAPL`, `TSLA`, `SPY`, `QQQ`

    **First call per ticker takes 30–120 s** (data fetch + model training).
    Subsequent calls within the cache TTL (default 4 h) are near-instant.

    **Recommendation interpretation**:
    * **Buy**  — model estimates higher probability of positive 20-session return.
    * **Sell** — model estimates lower probability.
    * **Hold** — model cannot distinguish with sufficient confidence.

    This is a research signal, NOT financial advice.
    """
    client_ip = request.client.host if (request and request.client) else "127.0.0.1"
    if not _check_rate_limit(client_ip):
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded (maximum 20 requests per minute). Please wait before submitting more queries."
        )

    _METRICS["total_requests"] += 1
    _METRICS["recommend_requests"] += 1

    raw_ticker = ticker.strip()
    if not raw_ticker:
        raise HTTPException(status_code=404, detail="Ticker symbol cannot be empty.")

    log.info("[%s] Request received (refresh=%s, ip=%s)", raw_ticker, refresh, client_ip)
    t0 = time.perf_counter()

    # ── Ticker resolution ─────────────────────────────────────────────────
    try:
        resolved = resolve_ticker_with_fallback(raw_ticker)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        log.exception("[%s] Ticker resolution failed", raw_ticker)
        raise HTTPException(status_code=500, detail=f"Ticker resolution error: {exc}")

    log.info("[%s] Resolved ticker: %s", raw_ticker, resolved)

    # ── Feature extraction ────────────────────────────────────────────────
    try:
        features = extract_features(resolved)
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        log.exception("[%s] Unexpected error in extract_features", resolved)
        raise HTTPException(status_code=500, detail=f"Data extraction error: {exc}")

    # ── Model training / cache ────────────────────────────────────────────
    cache_hit = resolved in _cache and not _cache[resolved].is_stale and not refresh

    if cache_hit:
        _METRICS["cache_hits"] += 1
    else:
        _METRICS["cache_misses"] += 1
        log.info("[%s] Training models (refresh=%s)…", resolved, refresh)
        try:
            X, y, df = build_feature_matrix(resolved)
            rec = StockRecommender()
            rec.fit(X, y)

            # Forward return stats for the training set
            if "fwd_return" in df.columns:
                fwd = df["fwd_return"].dropna()
                rec.backtest_metrics["avg_fwd_return_pct"] = round(float(fwd.mean() * 100), 3)
                rec.backtest_metrics["med_fwd_return_pct"] = round(float(fwd.median() * 100), 3)

            rec.data_through = (
                df.index[-1].strftime("%Y-%m-%d")
                if hasattr(df.index[-1], "strftime")
                else str(df.index[-1])
            )
            _cache[resolved] = CacheEntry(rec, X, df, info=fetch_info(resolved))
            log.info("[%s] Training complete in %.1fs", resolved, time.perf_counter() - t0)
        except (ValueError, RuntimeError) as exc:
            _METRICS["training_failures"] += 1
            raise HTTPException(status_code=404, detail=str(exc))
        except Exception as exc:
            _METRICS["training_failures"] += 1
            log.exception("[%s] Model training failed", resolved)
            raise HTTPException(status_code=500, detail=f"Model training error: {exc}")

    entry = _cache[resolved]
    rec   = entry.model

    # ── Prediction ────────────────────────────────────────────────────────
    try:
        x_point      = _build_x_point(features)
        x_seq_scaled = _build_lstm_sequence(entry)
        result       = rec.predict(x_point, x_seq_scaled, features)
    except Exception as exc:
        log.exception("[%s] Prediction failed", resolved)
        raise HTTPException(status_code=500, detail=f"Prediction error: {exc}")

    # Build historical price points for interactive Groww-style charting
    price_history: List[PriceHistoryPoint] = []
    if "Close" in entry.df.columns:
        df_chart = entry.df.tail(500)
        for idx, row in df_chart.iterrows():
            d_str = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]
            price_history.append(
                PriceHistoryPoint(
                    date=d_str,
                    close=round(float(row["Close"]), 2),
                    open=round(float(row["Open"]), 2) if "Open" in row and pd.notna(row["Open"]) else None,
                    high=round(float(row["High"]), 2) if "High" in row and pd.notna(row["High"]) else None,
                    low=round(float(row["Low"]), 2) if "Low" in row and pd.notna(row["Low"]) else None,
                    volume=float(row["Volume"]) if "Volume" in row and pd.notna(row["Volume"]) else None,
                    sma50=round(float(row["sma50"]), 2) if "sma50" in row and pd.notna(row["sma50"]) else None,
                    sma200=round(float(row["sma200"]), 2) if "sma200" in row and pd.notna(row["sma200"]) else None,
                )
            )

    # ── Assemble response ─────────────────────────────────────────────────
    bm = result.backtest_metrics
    cc = result.confidence_components
    lr = result.lstm_result
    mkt = features.market
    lstm_excluded = lr.probability is None

    # ── Institutional & Fundamental Intelligence (6 Cards) ───────────────
    try:
        raw_info = entry.info if hasattr(entry, "info") and entry.info else fetch_info(resolved)
        inst_intel = build_institutional_intelligence(
            info=raw_info,
            price=features.price,
            volume_ratio=features.volume_ratio,
            market=features.market,
            ticker=resolved,
        )
        inst_model = InstitutionalIntelligenceModel(
            analyst_rating=inst_intel.analyst_rating,
            analyst_score=inst_intel.analyst_score,
            analyst_count=inst_intel.analyst_count,
            target_price=inst_intel.target_price,
            target_high=inst_intel.target_high,
            target_low=inst_intel.target_low,
            target_currency=inst_intel.target_currency,
            currency_symbol=inst_intel.currency_symbol,
            revenue_forecast=inst_intel.revenue_forecast,
            revenue_period=inst_intel.revenue_period,
            revenue_growth_pct=inst_intel.revenue_growth_pct,
            valuation_label=inst_intel.valuation_label,
            ps_ratio=inst_intel.ps_ratio,
            trading_volume=inst_intel.trading_volume,
            trading_volume_str=inst_intel.trading_volume_str,
            volume_status=inst_intel.volume_status,
            volume_ratio=inst_intel.volume_ratio,
            profitability_label=inst_intel.profitability_label,
            gross_margin_pct=inst_intel.gross_margin_pct,
            operating_margin_pct=inst_intel.operating_margin_pct,
            provider=inst_intel.provider,
            is_fund=inst_intel.is_fund,
            fund_type=inst_intel.fund_type,
            benchmark_name=inst_intel.benchmark_name,
            holdings_count_str=inst_intel.holdings_count_str,
            diversification=inst_intel.diversification,
            replication_type=inst_intel.replication_type,
            tracking_error=inst_intel.tracking_error,
            aum_str=inst_intel.aum_str,
            expense_ratio_str=inst_intel.expense_ratio_str,
            fund_category=inst_intel.fund_category,
            weighted_pe_str=inst_intel.weighted_pe_str,
            weighted_pb_str=inst_intel.weighted_pb_str,
            portfolio_style=inst_intel.portfolio_style,
            liquidity_rating=inst_intel.liquidity_rating,
            top_sector=inst_intel.top_sector,
            top_holding=inst_intel.top_holding,
        )
    except Exception as exc:
        log.warning("[%s] Failed to build institutional intelligence: %s", resolved, exc)
        inst_model = None

    # ── Live Press Releases & Corporate News (Concurrent Fetch) ───────────
    press_releases_list: List[TickerNewsStoryModel] = []
    ticker_news_list: List[TickerNewsStoryModel] = []
    try:
        from concurrent.futures import ThreadPoolExecutor

        with ThreadPoolExecutor(max_workers=2) as executor:
            fut_pr = executor.submit(fetch_press_releases, resolved, 25)
            fut_news = executor.submit(fetch_ticker_news, resolved, 30)
            raw_pr = fut_pr.result()
            raw_t_news = fut_news.result()

        press_releases_list = [
            TickerNewsStoryModel(
                title=n["title"],
                publisher=n["publisher"],
                time_ago=n["time_ago"],
                link=n["link"],
                uuid=n["uuid"],
            )
            for n in (raw_pr or [])
        ]
        ticker_news_list = [
            TickerNewsStoryModel(
                title=n["title"],
                publisher=n["publisher"],
                time_ago=n["time_ago"],
                link=n["link"],
                uuid=n["uuid"],
            )
            for n in (raw_t_news or [])
        ]
    except Exception as exc:
        log.warning("[%s] Failed to fetch concurrent news/releases: %s", resolved, exc)

    return RecommendationResponse(
        ticker=resolved,
        display_ticker=features.display_ticker,
        market=MarketInfoModel(
            country=mkt.country,
            exchange=mkt.exchange,
            currency=mkt.currency,
            currency_symbol=mkt.currency_symbol,
            is_india=mkt.is_india,
            is_etf=mkt.is_etf,
            etf_category=mkt.etf_category,
            company_name=mkt.company_name,
        ),
        price=round(features.price, 2),
        sector=features.sector,
        company_name=mkt.company_name,
        logo_url=None,
        recommendation=result.recommendation,
        probability=result.ensemble_prob,
        forecast_horizon="~20 trading sessions",
        regime=RegimeInfo(
            name=features.regime,
            adx=round(features.adx, 2),
            adx_pos=round(features.adx_pos, 2),
            adx_neg=round(features.adx_neg, 2),
            sma200_slope=round(features.sma200_slope, 5),
            clarity=round(features.regime_strength, 3),
        ),
        volatility=VolatilityInfo(
            rsi=round(features.rsi, 2),
            annualized=round(features.ann_vol, 4),
            atr=round(features.atr, 4),
            atr_percent=round(features.atr_pct * 100, 3),
            rsi_buy_threshold=features.rsi_adj_buy_threshold,
            rsi_sell_threshold=features.rsi_adj_sell_threshold,
        ),
        valuation=ValuationInfo(
            pe_ratio=features.pe_ratio,
            peer_pe=features.peer_pe,
            pe_relative_pct=round(features.pe_relative * 100, 2) if features.pe_relative is not None else None,
            pb_ratio=features.pb_ratio,
            signal=result.signal_breakdown.get("valuation", "unavailable"),
            is_etf=mkt.is_etf,
            note=_VALUATION_NOTE_ETF if mkt.is_etf else _VALUATION_NOTE_LIVE,
        ),
        signals=SignalsInfo(
            rsi=result.signal_breakdown["rsi"],
            trend=result.signal_breakdown["trend"],
            macd=result.signal_breakdown["macd"],
            momentum=result.signal_breakdown["momentum"],
            volume=result.signal_breakdown["volume"],
            valuation=result.signal_breakdown["valuation"],
        ),
        models=ModelsInfo(
            xgb_probability=result.xgb_prob,
            lstm=LSTMInfo(
                available=lr.available,
                probability=lr.probability,
                reason=lr.reason,
            ),
            ensemble_probability=result.ensemble_prob,
        ),
        confidence=ConfidenceInfo(
            score=result.confidence,
            label=result.confidence_label,
            lstm_excluded_from_agreement=lstm_excluded,
            components={
                "probability_strength": cc.probability_strength,
                "volatility":           cc.volatility,
                "data_quality":         cc.data_quality,
                "regime_clarity":       cc.regime_clarity,
                "model_agreement":      cc.model_agreement,   # null when LSTM unavailable
            },
        ),
        backtest=BacktestInfo(
            accuracy=bm.get("accuracy"),
            precision=bm.get("precision"),
            recall=bm.get("recall"),
            f1=bm.get("f1"),
            roc_auc=bm.get("roc_auc"),
            brier_score=bm.get("brier_score"),
            xgb_coefficient=bm.get("xgb_coefficient"),
            lstm_coefficient=bm.get("lstm_coefficient"),
            oof_samples=bm.get("oof_samples"),
            oof_positive_samples=bm.get("oof_positive_samples"),
            forecast_horizon_days=bm.get("forecast_horizon_days", cfg.FORECAST_HORIZON),
            purge_period_days=bm.get("purge_period_days", cfg.PURGE_PERIOD),
            avg_fwd_return_pct=bm.get("avg_fwd_return_pct"),
            med_fwd_return_pct=bm.get("med_fwd_return_pct"),
            lstm_available=bm.get("lstm_available", False),
            lstm_used_in_stacking=bm.get("lstm_used_in_stacking", False),
        ),
        cache=CacheInfo(
            hit=cache_hit,
            **{k: v for k, v in entry.to_meta().items() if k in ("trained_at", "data_through", "age_hours")},
        ),
        explanation=(
            ExplanationInfo(
                available=result.explanation.available,
                base_value=result.explanation.base_value,
                model_output=result.explanation.model_output,
                top_positive_features=[
                    FeatureExplanationItem(**item) for item in result.explanation.top_positive_features
                ],
                top_negative_features=[
                    FeatureExplanationItem(**item) for item in result.explanation.top_negative_features
                ],
                reason=result.explanation.reason,
            )
            if result.explanation is not None else None
        ),
        price_history=price_history,
        institutional_intelligence=inst_model,
        ticker_news=ticker_news_list,
        press_releases=press_releases_list,
        disclaimer=_DISCLAIMER,
    )


@app.get("/api/backtest/compare", response_model=BenchmarkResponse, tags=["Backtesting"])
def compare_strategies(
    ticker:   str   = Query(..., description="Stock ticker (e.g. AAPL, RELIANCE, TCS.NS)"),
    capital:  float = Query(cfg.STARTING_CAPITAL, description="Starting capital in base currency"),
    cost:     float = Query(cfg.TRANSACTION_COST, description="Transaction fee per trade (e.g. 0.001)"),
    slippage: float = Query(cfg.SLIPPAGE, description="Execution slippage (e.g. 0.0005)"),
    refresh:  bool  = Query(False, description="Force retrain / bypass memory cache"),
):
    """
    Run realistic strategy benchmarking across QuantView, Buy & Hold, and SMA50/200.
    Evaluates identical time period, identical starting capital, transaction costs, and slippage.
    QuantView strategy uses genuine Out-Of-Fold (OOF) walk-forward predictions.
    """
    # ── Parameter validation ───────────────────────────────────────────────
    if capital <= 0:
        raise HTTPException(status_code=422, detail="Starting capital must be greater than zero.")
    if not (0.0 <= cost <= 0.10):
        raise HTTPException(status_code=422, detail="Transaction cost must be between 0.0 (0%) and 0.10 (10%).")
    if not (0.0 <= slippage <= 0.05):
        raise HTTPException(status_code=422, detail="Slippage must be between 0.0 (0%) and 0.05 (5%).")

    ticker_clean = ticker.strip()
    try:
        resolved = resolve_ticker_with_fallback(ticker_clean)
        disp_ticker = resolved.removesuffix(".NS").removesuffix(".BO") if resolved.endswith((".NS", ".BO")) else resolved
        mkt = get_market_info(resolved, {})
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


    cache_hit = (resolved in _cache) and (not refresh) and (not _cache[resolved].is_stale)

    if not cache_hit:
        log.info("[%s] Building feature matrix for benchmark...", resolved)
        try:
            X, y, df = build_feature_matrix(resolved)
            rec = StockRecommender()
            rec.fit(X, y)
            _cache[resolved] = CacheEntry(model=rec, X=X, df=df)
        except (ValueError, RuntimeError) as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        except Exception as exc:
            log.exception("[%s] Benchmark model fit failed", resolved)
            raise HTTPException(status_code=500, detail=f"Model training error: {exc}")

    entry = _cache[resolved]
    rec = entry.model
    df = entry.df

    # QuantView must use authentic Walk-Forward Out-Of-Fold (OOF) predictions
    if (
        hasattr(rec, "oof_probabilities")
        and rec.oof_probabilities is not None
        and hasattr(rec, "oof_indices")
        and rec.oof_indices is not None
        and len(rec.oof_indices) > 0
    ):
        df_eval = df.iloc[rec.oof_indices].copy()
        qv_probs = rec.oof_probabilities
    else:
        raise HTTPException(
            status_code=500,
            detail="QuantView walk-forward OOF predictions are unavailable for this ticker.",
        )

    try:
        res = run_benchmark_comparison(
            df=df_eval,
            qv_probabilities=qv_probs,
            ticker=resolved,
            initial_capital=capital,
            transaction_cost=cost,
            slippage=slippage,
        )
    except Exception as exc:
        log.exception("[%s] Benchmark simulation failed", resolved)
        raise HTTPException(status_code=500, detail=f"Benchmark simulation error: {exc}")


    return BenchmarkResponse(
        success=True,
        ticker=resolved,
        display_ticker=disp_ticker,
        currency_symbol=mkt.currency_symbol,
        period=BenchmarkPeriodModel(
            start=res.start_date,
            end=res.end_date,
            trading_days=res.trading_days,
        ),
        starting_capital=res.starting_capital,
        transaction_cost=res.transaction_cost,
        slippage=res.slippage,
        strategies=[
            StrategyMetricsModel(
                name=s.name,
                total_return=s.total_return,
                cagr=s.cagr,
                sharpe=s.sharpe,
                max_drawdown=s.max_drawdown,
                volatility=s.volatility,
                trades=s.trades,
                win_rate=s.win_rate,
            )
            for s in res.strategies
        ],
        equity_curve=res.equity_curve,
        cost_scenarios=[
            CostScenarioModel(
                cost_pct=cs.cost_pct,
                cost_label=cs.cost_label,
                total_return=cs.total_return,
                cagr=cs.cagr,
                sharpe=cs.sharpe,
                max_drawdown=cs.max_drawdown,
            )
            for cs in res.cost_scenarios
        ],
        disclaimer=_DISCLAIMER,
    )



# ---------------------------------------------------------------------------
# Live Watchlist & Live News Data Pipelines
# ---------------------------------------------------------------------------
_WATCHLIST_CACHE: Dict[str, Any] = {"timestamp": 0.0, "items": []}
_WATCHLIST_CACHE_TTL = 120.0  # 2 minutes server-side cache

_NEWS_CACHE: Dict[str, Any] = {"timestamp": 0.0, "articles": []}
_NEWS_CACHE_TTL = 300.0  # 5 minutes server-side cache

WATCHLIST_ASSETS = [
    {"ticker": "RELIANCE", "symbol": "RELIANCE.NS", "name": "Reliance Industries Limited", "exchange": "NSE", "sym": "₹"},
    {"ticker": "TCS", "symbol": "TCS.NS", "name": "Tata Consultancy Services", "exchange": "NSE", "sym": "₹"},
    {"ticker": "HDFCBANK", "symbol": "HDFCBANK.NS", "name": "HDFC Bank Limited", "exchange": "NSE", "sym": "₹"},
    {"ticker": "ICICIBANK", "symbol": "ICICIBANK.NS", "name": "ICICI Bank Limited", "exchange": "NSE", "sym": "₹"},
    {"ticker": "BHARTIARTL", "symbol": "BHARTIARTL.NS", "name": "Bharti Airtel Limited", "exchange": "NSE", "sym": "₹"},
    {"ticker": "NVDA", "symbol": "NVDA", "name": "NVIDIA Corporation", "exchange": "NASDAQ", "sym": "$"},
    {"ticker": "AAPL", "symbol": "AAPL", "name": "Apple Inc.", "exchange": "NASDAQ", "sym": "$"},
    {"ticker": "MSFT", "symbol": "MSFT", "name": "Microsoft Corporation", "exchange": "NASDAQ", "sym": "$"},
    {"ticker": "QQQ", "symbol": "QQQ", "name": "Invesco QQQ Trust", "exchange": "NASDAQ", "sym": "$"},
    {"ticker": "SPY", "symbol": "SPY", "name": "SPDR S&P 500 ETF Trust", "exchange": "NYSE Arca", "sym": "$"},
]

def fetch_live_watchlist_quotes() -> List[Dict[str, Any]]:
    global _WATCHLIST_CACHE
    now = time.time()
    if _WATCHLIST_CACHE["items"] and (now - _WATCHLIST_CACHE["timestamp"] < _WATCHLIST_CACHE_TTL):
        return _WATCHLIST_CACHE["items"]

    symbols = [a["symbol"] for a in WATCHLIST_ASSETS]
    results = []
    try:
        data = yf.download(symbols, period="5d", interval="1d", progress=False, group_by="ticker")
        for a in WATCHLIST_ASSETS:
            sym = a["symbol"]
            price_str = None
            chg_str = "+0.00%"
            chg_pos = True
            vr_str = "1.00x"
            rating = "Hold"

            try:
                df = data[sym].dropna(subset=["Close"]) if (hasattr(data, "__contains__") and sym in data) else None
                if df is not None and len(df) >= 1:
                    last_close = float(df["Close"].iloc[-1])
                    prev_close = float(df["Close"].iloc[-2]) if len(df) >= 2 else last_close
                    chg_pct = ((last_close - prev_close) / prev_close * 100.0) if prev_close > 0 else 0.0
                    vol = float(df["Volume"].iloc[-1]) if "Volume" in df and pd.notna(df["Volume"].iloc[-1]) else 0.0
                    avg_vol = float(df["Volume"].mean()) if "Volume" in df and len(df) > 0 else 1.0
                    vr = (vol / avg_vol) if avg_vol > 0 else 1.0

                    chg_pos = chg_pct >= 0
                    chg_str = f"{'+' if chg_pos else ''}{chg_pct:.2f}%"
                    vr_str = f"{vr:.2f}x"
                    
                    if a["sym"] == "₹":
                        price_str = f"₹{last_close:,.2f}"
                    else:
                        price_str = f"${last_close:,.2f}"

                    if chg_pct > 2.0:
                        rating = "Strong Buy"
                    elif chg_pct > 0.3:
                        rating = "Buy"
                    elif chg_pct > -1.5:
                        rating = "Hold"
                    else:
                        rating = "Underperform"
            except Exception as e:
                log.debug("Error processing watchlist quote for %s: %s", sym, e)

            if not price_str:
                price_str = f"{a['sym']}—"

            results.append({
                "ticker": a["ticker"],
                "name": a["name"],
                "exchange": a["exchange"],
                "price": price_str,
                "change": chg_str,
                "changePos": chg_pos,
                "volumeRatio": vr_str,
                "aiRating": rating,
            })

        if results and any(r["price"] != f"{WATCHLIST_ASSETS[0]['sym']}—" for r in results):
            _WATCHLIST_CACHE = {"timestamp": now, "items": results}
            return results
    except Exception as exc:
        log.warning("Live watchlist batch quote fetch failed: %s", exc)

    if _WATCHLIST_CACHE["items"]:
        return _WATCHLIST_CACHE["items"]
    return results or []

def _score_headline_sentiment(text: str) -> tuple[str, float]:
    """Calculate sentiment label and normalized score from headline keywords."""
    text_lower = text.lower()
    bullish_keywords = ["surge", "jump", "rally", "gain", "high", "record", "beats", "profit", "bull", "growth", "inflow", "up", "soar", "advance", "boost", "strong", "rebound"]
    bearish_keywords = ["fall", "drop", "slump", "plunge", "decline", "down", "loss", "bear", "warning", "probe", "cut", "inflation", "recession", "tumble", "lower", "weak", "selloff"]

    bull_count = sum(1 for kw in bullish_keywords if kw in text_lower)
    bear_count = sum(1 for kw in bearish_keywords if kw in text_lower)

    if bull_count > bear_count:
        score = min(0.95, 0.45 + (bull_count * 0.15))
        return "bullish", round(score, 2)
    elif bear_count > bull_count:
        score = max(-0.95, -0.45 - (bear_count * 0.15))
        return "bearish", round(score, 2)
    else:
        return "neutral", 0.50

def _relative_time_str(epoch_seconds: float) -> str:
    diff = time.time() - epoch_seconds
    if diff < 60:
        return "Just now"
    elif diff < 3600:
        return f"{int(diff // 60)}m ago"
    elif diff < 86400:
        return f"{int(diff // 3600)}h ago"
    else:
        return f"{int(diff // 86400)}d ago"

def fetch_live_market_news() -> List[Dict[str, Any]]:
    global _NEWS_CACHE
    now = time.time()
    if _NEWS_CACHE["articles"] and (now - _NEWS_CACHE["timestamp"] < _NEWS_CACHE_TTL):
        return _NEWS_CACHE["articles"]

    articles: List[Dict[str, Any]] = []
    seen_titles = set()
    query_symbols = ["^NSEI", "RELIANCE.NS", "SPY", "AAPL", "NVDA", "MSFT"]

    for sym in query_symbols:
        try:
            t = yf.Ticker(sym)
            raw_news = t.news
            if not raw_news:
                continue
            for item in raw_news[:4]:
                title = item.get("title") or (item.get("content", {}).get("title") if isinstance(item.get("content"), dict) else None)
                if not title or title in seen_titles:
                    continue
                seen_titles.add(title)

                pub = item.get("publisher") or (item.get("content", {}).get("provider", {}).get("displayName") if isinstance(item.get("content"), dict) else "Market News")
                url = item.get("link") or (item.get("content", {}).get("canonicalUrl", {}).get("url") if isinstance(item.get("content"), dict) else "https://finance.yahoo.com")
                
                pub_time = item.get("providerPublishTime") or (item.get("content", {}).get("pubDate") if isinstance(item.get("content"), dict) else None)
                epoch = now
                if isinstance(pub_time, (int, float)):
                    epoch = float(pub_time)
                elif isinstance(pub_time, str):
                    try:
                        dt = datetime.fromisoformat(pub_time.replace("Z", "+00:00"))
                        epoch = dt.timestamp()
                    except Exception:
                        epoch = now

                summary = item.get("summary") or (item.get("content", {}).get("summary") if isinstance(item.get("content"), dict) else title)
                sent_label, sent_score = _score_headline_sentiment(title + " " + str(summary))

                img_url = "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=600&q=80"
                if isinstance(item.get("content"), dict) and item["content"].get("thumbnail"):
                    thumb = item["content"]["thumbnail"]
                    if thumb.get("resolutions") and len(thumb["resolutions"]) > 0:
                        img_url = thumb["resolutions"][0].get("url", img_url)

                categories = ["market", "live"]
                if ".NS" in sym or sym == "^NSEI":
                    categories.append("india")
                else:
                    categories.append("us")
                if sent_label in ["bullish", "bearish"]:
                    categories.append(sent_label)

                clean_ticker = sym.replace(".NS", "").replace("^", "")

                articles.append({
                    "id": f"news-{len(articles) + 1}",
                    "headline": title,
                    "summary": str(summary)[:260] + ("..." if len(str(summary)) > 260 else ""),
                    "source": pub,
                    "publishedAt": _relative_time_str(epoch),
                    "url": url,
                    "sentiment": sent_label,
                    "sentimentScore": sent_score,
                    "category": categories,
                    "tickers": [clean_ticker],
                    "imageUrl": img_url
                })
                if len(articles) >= 12:
                    break
        except Exception as err:
            log.debug("Live news extract error for %s: %s", sym, err)
        if len(articles) >= 12:
            break

    if articles:
        _NEWS_CACHE = {"timestamp": now, "articles": articles}
        return articles

    return _NEWS_CACHE.get("articles") or []

@app.get("/api/watchlist/live", tags=["Market Data"])
def get_live_watchlist():
    """
    Returns the real-time top gainers and active market leaders across Indian and US equities.
    Cached server-side (120s TTL) for fast delivery and zero rate-limit fatigue.
    """
    _METRICS["total_requests"] += 1
    items = fetch_live_watchlist_quotes()
    return {
        "status": "ok",
        "timestamp": int(time.time()),
        "count": len(items),
        "items": items
    }

@app.get("/api/news/live", tags=["Market Data"])
def get_live_news():
    """
    Returns authentic live financial news articles and macro updates for Indian and global equities.
    Cached server-side (300s TTL) with sentiment scoring.
    """
    _METRICS["total_requests"] += 1
    articles = fetch_live_market_news()
    return {
        "status": "ok",
        "timestamp": int(time.time()),
        "count": len(articles),
        "articles": articles
    }

# ---------------------------------------------------------------------------
# Market Status Pipeline (Twelve Data + Exchange Schedule Fallback)
# ---------------------------------------------------------------------------
_MARKET_STATUS_CACHE: Dict[str, Any] = {"timestamp": 0.0, "data": {}}
_MARKET_STATUS_TTL = 60.0  # 60 seconds

def get_live_market_status() -> Dict[str, Any]:
    global _MARKET_STATUS_CACHE
    now = time.time()
    if _MARKET_STATUS_CACHE["data"] and (now - _MARKET_STATUS_CACHE["timestamp"] < _MARKET_STATUS_TTL):
        return _MARKET_STATUS_CACHE["data"]

    td_key = os.environ.get("TWELVE_DATA_API_KEY") or os.environ.get("TWELVEDATA_KEY") or os.environ.get("TWELVEDATA_API_KEY") or ""
    
    nse_info = {"name": "NSE / BSE (India)", "code": "XNSE", "is_open": False, "status": "Closed"}
    us_info = {"name": "US (NYSE / NASDAQ)", "code": "XNYS", "is_open": False, "status": "Closed"}

    if td_key:
        try:
            resp = requests.get(
                "https://api.twelvedata.com/market_state",
                params={"apikey": td_key},
                timeout=3.5
            )
            if resp.status_code == 200:
                states = resp.json()
                if isinstance(states, list):
                    for st in states:
                        code = st.get("code")
                        if code in ("XNSE", "XBOM"):
                            nse_info["is_open"] = bool(st.get("is_market_open"))
                            nse_info["status"] = "Open" if nse_info["is_open"] else "Closed"
                            nse_info["time_to_open"] = st.get("time_to_open")
                            nse_info["time_to_close"] = st.get("time_to_close")
                        elif code in ("XNYS", "XNAS"):
                            us_info["is_open"] = bool(st.get("is_market_open"))
                            us_info["status"] = "Open" if us_info["is_open"] else "Closed"
                            us_info["time_to_open"] = st.get("time_to_open")
                            us_info["time_to_close"] = st.get("time_to_close")
                    
                    res_data = {"status": "ok", "timestamp": int(now), "source": "Twelve Data", "nse": nse_info, "us": us_info}
                    _MARKET_STATUS_CACHE = {"timestamp": now, "data": res_data}
                    return res_data
        except Exception as e:
            log.debug("Twelve Data market_state query error: %s", e)

    # Fallback to precise exchange clock logic (accounts for UTC offsets)
    try:
        from zoneinfo import ZoneInfo
        ist_now = datetime.now(ZoneInfo("Asia/Kolkata"))
        ist_min = ist_now.hour * 60 + ist_now.minute
        # Mon-Fri: 9:15 AM (555 min) to 3:30 PM (930 min)
        nse_open = (ist_now.weekday() < 5) and (555 <= ist_min <= 930)
        nse_info["is_open"] = nse_open
        nse_info["status"] = "Open" if nse_open else "Closed"

        us_now = datetime.now(ZoneInfo("America/New_York"))
        us_min = us_now.hour * 60 + us_now.minute
        # Mon-Fri: 9:30 AM (570 min) to 4:00 PM (960 min)
        us_open = (us_now.weekday() < 5) and (570 <= us_min <= 960)
        us_info["is_open"] = us_open
        us_info["status"] = "Open" if us_open else "Closed"
    except Exception as e:
        log.warning("Timezone fallback error: %s", e)

    res_data = {
        "status": "ok",
        "timestamp": int(now),
        "source": "Exchange Schedule Engine",
        "nse": nse_info,
        "us": us_info
    }
    _MARKET_STATUS_CACHE = {"timestamp": now, "data": res_data}
    return res_data

@app.get("/api/market-status", tags=["Market Data"])
def get_market_status():
    """
    Returns authentic live trading session status for Indian (NSE/BSE) and US (NYSE/NASDAQ) markets.
    Cached server-side (60s TTL).
    """
    _METRICS["total_requests"] += 1
    return get_live_market_status()

@app.get("/api/metrics", tags=["Utility"])
def get_operational_metrics():
    """
    Operational monitoring metrics: uptime, request counts, cache hits/misses, and failure rates.
    """
    uptime_sec = time.time() - _METRICS["start_time"]
    return {
        "status": "ok",
        "uptime_seconds": round(uptime_sec, 1),
        "uptime_human": f"{int(uptime_sec // 3600)}h {int((uptime_sec % 3600) // 60)}m {int(uptime_sec % 60)}s",
        "total_requests": _METRICS["total_requests"],
        "recommend_requests": _METRICS["recommend_requests"],
        "cache_hits": _METRICS["cache_hits"],
        "cache_misses": _METRICS["cache_misses"],
        "cache_hit_ratio": round(_METRICS["cache_hits"] / max(1, _METRICS["recommend_requests"]), 3),
        "training_failures": _METRICS["training_failures"],
        "cached_tickers_count": len(_cache),
    }

@app.get("/api/health", tags=["Utility"])
def health():
    """Server health check."""
    return {
        "status":          "ok",
        "version":         "3.0.0",
        "cached_tickers":  list(_cache.keys()),
        "cache_ttl_hours": cfg.CACHE_TTL_HOURS,
        "markets":         ["India (NSE/BSE)", "US (NASDAQ/NYSE)"],
    }


@app.delete("/api/cache/{ticker}", tags=["Utility"])
def clear_cache(ticker: str):
    """Clear the cached model for a ticker, forcing retraining on next request."""
    ticker  = ticker.upper().strip()
    removed = _cache.pop(ticker, None) is not None
    return {"ticker": ticker, "removed": removed}


@app.get("/api/cache", tags=["Utility"])
def list_cache():
    """List all cached tickers and their metadata."""
    return {t: e.to_meta() for t, e in _cache.items()}


# ---------------------------------------------------------------------------
# Static file serving (frontend)
# ---------------------------------------------------------------------------
_FRONTEND_DIR = Path(__file__).parent.parent / "frontend"

@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    fav_path = _FRONTEND_DIR / "favicon.svg"
    if fav_path.exists():
        return FileResponse(str(fav_path), media_type="image/svg+xml")
    return JSONResponse(status_code=404, content={"detail": "Not found"})

if _FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIR), html=True), name="frontend")
    log.info("Frontend served from %s", _FRONTEND_DIR)

else:
    log.warning(
        "Frontend directory not found at %s. "
        "API endpoints are available but / will return 404.",
        _FRONTEND_DIR,
    )
