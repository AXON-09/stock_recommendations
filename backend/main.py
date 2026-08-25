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
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

# Allow imports from backend/ when run from project root
sys.path.insert(0, str(Path(__file__).parent))

import config as cfg
from engine import (
    AssetFeatures,
    FEATURE_COLS,
    REGIME_CODE,
    SEQUENCE_LEN,
    build_feature_matrix,
    extract_features,
)
from market import resolve_ticker_with_fallback, MarketInfo
from models import StockRecommender

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)
log = logging.getLogger(__name__)

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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# In-memory cache  {resolved_ticker → CacheEntry}
# ---------------------------------------------------------------------------
class CacheEntry:
    def __init__(self, model: StockRecommender, X: pd.DataFrame, df: pd.DataFrame):
        self.model    = model
        self.X        = X       # feature matrix (for LSTM sequence)
        self.df       = df      # full DataFrame (for forward-return stats)
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


class RecommendationResponse(BaseModel):
    success:          bool = True
    ticker:           str
    display_ticker:   str
    market:           MarketInfoModel
    price:            float
    sector:           str
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
    "Not applicable for ETFs. This is an ETF or index fund — P/E, peer P/E, "
    "and relative P/E describe a single company's earnings multiple, which "
    "doesn't have a meaningful equivalent for a basket of holdings."
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
    raw_ticker = ticker.strip()
    log.info("[%s] Request received (refresh=%s)", raw_ticker, refresh)
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

    if not cache_hit:
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
            _cache[resolved] = CacheEntry(rec, X, df)
            log.info("[%s] Training complete in %.1fs", resolved, time.perf_counter() - t0)
        except (ValueError, RuntimeError) as exc:
            raise HTTPException(status_code=404, detail=str(exc))
        except Exception as exc:
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

    # ── Assemble response ─────────────────────────────────────────────────
    bm = result.backtest_metrics
    cc = result.confidence_components
    lr = result.lstm_result
    mkt = features.market

    lstm_excluded = lr.probability is None  # True when LSTM unavailable

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
        ),
        price=features.price,
        sector=features.sector,
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
        disclaimer=_DISCLAIMER,
    )


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

if _FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(_FRONTEND_DIR), html=True), name="frontend")
    log.info("Frontend served from %s", _FRONTEND_DIR)
else:
    log.warning(
        "Frontend directory not found at %s. "
        "API endpoints are available but / will return 404.",
        _FRONTEND_DIR,
    )
