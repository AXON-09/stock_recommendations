"""
tests/test_api.py - Structural and logic tests for the API response shape.

Uses FastAPI's TestClient + extensive mocking to avoid network calls.
Validates:
  - Response schema correctness (all required fields present)
  - Currency symbol propagation (₹ for India, $ for US)
  - LSTM unavailability honest reporting (probability=None, not 0.5)
  - Confidence renormalisation when LSTM is unavailable
  - Ticker resolution integration (RELIANCE → RELIANCE.NS)
  - ETF valuation short-circuit (is_etf=True → signal="not_applicable")
  - Error handling (invalid ticker returns 404)
"""

from __future__ import annotations

import sys
from pathlib import Path
from dataclasses import dataclass
from typing import Any, Optional
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

# ── Minimal stubs so importing main.py doesn't fail ───────────────────────────
import config as cfg
from market import MarketInfo


# ---------------------------------------------------------------------------
# Synthetic OHLCV helper
# ---------------------------------------------------------------------------
def _make_ohlcv(n: int = 700, seed: int = 0) -> pd.DataFrame:
    np.random.seed(seed)
    close  = 100.0 * np.cumprod(1 + np.random.normal(0, 0.012, n))
    high   = close * (1 + np.abs(np.random.normal(0, 0.005, n)))
    low    = close * (1 - np.abs(np.random.normal(0, 0.005, n)))
    volume = np.random.randint(1_000_000, 5_000_000, n).astype(float)
    idx    = pd.date_range("2021-01-01", periods=n, freq="B")
    return pd.DataFrame(
        {"Open": close, "High": high, "Low": low, "Close": close, "Volume": volume},
        index=idx,
    )


# ---------------------------------------------------------------------------
# Fixtures / helpers for patching yfinance
# ---------------------------------------------------------------------------
def _make_yf_ticker_mock(ohlcv: pd.DataFrame, info: dict):
    mock = MagicMock()
    mock.history.return_value = ohlcv
    mock.info = info
    return mock


_US_INFO = {
    "quoteType": "EQUITY",
    "sector":    "Technology",
    "currency":  "USD",
    "exchange":  "NMS",
    "trailingPE": 28.5,
    "priceToBook": 8.2,
}
_INDIA_INFO = {
    "quoteType": "EQUITY",
    "sector":    "Energy",
    "currency":  "INR",
    "exchange":  "NSI",
    "trailingPE": 22.0,
    "priceToBook": 2.5,
}
_ETF_INFO = {
    "quoteType": "ETF",
    "sector":    "Unknown",
    "currency":  "INR",
    "exchange":  "NSI",
}


def _mock_yf(info: dict, ohlcv: Optional[pd.DataFrame] = None):
    """Return a patch target for yfinance.Ticker that uses synthetic data."""
    if ohlcv is None:
        ohlcv = _make_ohlcv()
    ticker_obj = _make_yf_ticker_mock(ohlcv, info)
    return patch("yfinance.Ticker", return_value=ticker_obj)


# ---------------------------------------------------------------------------
# Test client factory
# ---------------------------------------------------------------------------
def _make_client_patched(info: dict, ohlcv: Optional[pd.DataFrame] = None,
                          resolved_ticker: str = "AAPL"):
    """
    Creates a FastAPI TestClient with yfinance and ticker-resolution mocked.
    Returns (client, patch_context_managers).
    """
    from main import app
    with (
        patch("market.resolve_ticker_with_fallback", return_value=resolved_ticker),
        _mock_yf(info, ohlcv),
    ):
        client = TestClient(app, raise_server_exceptions=False)
    return client


# ---------------------------------------------------------------------------
# Response schema validation helper
# ---------------------------------------------------------------------------
REQUIRED_TOP_LEVEL = {
    "success", "ticker", "display_ticker", "market", "price", "sector",
    "recommendation", "probability", "forecast_horizon",
    "regime", "volatility", "valuation", "signals", "models",
    "confidence", "backtest", "cache", "disclaimer",
}

REQUIRED_MARKET_FIELDS = {"country", "exchange", "currency", "currency_symbol", "is_india", "is_etf"}
REQUIRED_VOLATILITY_FIELDS = {"rsi", "annualized", "atr", "atr_percent", "rsi_buy_threshold", "rsi_sell_threshold"}
REQUIRED_MODELS_FIELDS = {"xgb_probability", "lstm", "ensemble_probability"}
REQUIRED_LSTM_FIELDS = {"available", "probability", "reason"}
REQUIRED_CONFIDENCE_FIELDS = {"score", "label", "lstm_excluded_from_agreement", "components"}
REQUIRED_BACKTEST_FIELDS = {"accuracy", "precision", "recall", "f1", "roc_auc", "brier_score",
                             "oof_samples", "forecast_horizon_days", "purge_period_days",
                             "lstm_available", "lstm_used_in_stacking"}


def _assert_schema(data: dict):
    missing_top = REQUIRED_TOP_LEVEL - set(data.keys())
    assert not missing_top, f"Missing top-level keys: {missing_top}"

    missing_mkt = REQUIRED_MARKET_FIELDS - set(data["market"].keys())
    assert not missing_mkt, f"Missing market keys: {missing_mkt}"

    missing_vol = REQUIRED_VOLATILITY_FIELDS - set(data["volatility"].keys())
    assert not missing_vol, f"Missing volatility keys: {missing_vol}"

    missing_mod = REQUIRED_MODELS_FIELDS - set(data["models"].keys())
    assert not missing_mod, f"Missing models keys: {missing_mod}"

    missing_lstm = REQUIRED_LSTM_FIELDS - set(data["models"]["lstm"].keys())
    assert not missing_lstm, f"Missing lstm keys: {missing_lstm}"

    missing_conf = REQUIRED_CONFIDENCE_FIELDS - set(data["confidence"].keys())
    assert not missing_conf, f"Missing confidence keys: {missing_conf}"

    missing_bt = REQUIRED_BACKTEST_FIELDS - set(data["backtest"].keys())
    assert not missing_bt, f"Missing backtest keys: {missing_bt}"


# ---------------------------------------------------------------------------
# Functional tests using real StockRecommender (offline data)
# ---------------------------------------------------------------------------
class TestAPIResponseSchema:

    @pytest.fixture(autouse=True)
    def clear_cache(self):
        """Clear the in-memory model cache before each test."""
        import main
        main._cache.clear()
        yield
        main._cache.clear()

    def _get_recommendation(self, ticker: str, info: dict, ohlcv=None) -> dict:
        ohlcv = ohlcv or _make_ohlcv()
        from main import app
        with (
            patch("market.resolve_ticker_with_fallback", return_value=ticker),
            patch("yfinance.Ticker", return_value=_make_yf_ticker_mock(ohlcv, info)),
        ):
            client = TestClient(app, raise_server_exceptions=True)
            resp   = client.get(f"/api/recommend?ticker={ticker}")

        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:300]}"
        return resp.json()

    def test_us_ticker_schema_complete(self):
        """Full response schema present for a US equity."""
        data = self._get_recommendation("AAPL", _US_INFO)
        _assert_schema(data)
        assert data["success"] is True
        assert data["ticker"] == "AAPL"

    def test_recommendation_is_valid(self):
        """Recommendation must be one of Buy/Sell/Hold."""
        data = self._get_recommendation("AAPL", _US_INFO)
        assert data["recommendation"] in {"Buy", "Sell", "Hold"}

    def test_probability_in_bounds(self):
        """Ensemble probability must be in [0, 1]."""
        data = self._get_recommendation("AAPL", _US_INFO)
        p = data["probability"]
        assert 0.0 <= p <= 1.0, f"Probability {p} out of [0, 1]"

    def test_confidence_score_in_bounds(self):
        """Confidence score must be in [5, 95]."""
        data = self._get_recommendation("AAPL", _US_INFO)
        score = data["confidence"]["score"]
        assert 5 <= score <= 95, f"Confidence {score} out of [5, 95]"

    def test_rsi_in_volatility_section(self):
        """The RSI value must be present in the volatility section."""
        data = self._get_recommendation("AAPL", _US_INFO)
        rsi = data["volatility"]["rsi"]
        assert rsi is not None
        assert 0 <= rsi <= 100, f"RSI {rsi} out of [0, 100]"

    def test_lstm_honest_when_unavailable(self):
        """When PyTorch is unavailable, lstm.probability must be null (not 0.5)."""
        # TORCH_AVAILABLE is False in most CI envs without PyTorch
        data = self._get_recommendation("AAPL", _US_INFO)
        lstm = data["models"]["lstm"]
        if not lstm["available"]:
            assert lstm["probability"] is None, (
                f"LSTM probability must be null when unavailable, got {lstm['probability']}"
            )

    def test_confidence_agreement_null_when_lstm_unavailable(self):
        """model_agreement confidence component must be null when LSTM is unavailable."""
        data = self._get_recommendation("AAPL", _US_INFO)
        lstm = data["models"]["lstm"]
        if not lstm["available"]:
            agreement = data["confidence"]["components"]["model_agreement"]
            assert agreement is None, (
                f"model_agreement must be null when LSTM unavailable, got {agreement}"
            )
            assert data["confidence"]["lstm_excluded_from_agreement"] is True

    def test_lstm_excluded_flag_consistent(self):
        """lstm_excluded_from_agreement flag must be consistent with lstm.available."""
        data = self._get_recommendation("AAPL", _US_INFO)
        excluded = data["confidence"]["lstm_excluded_from_agreement"]
        available = data["models"]["lstm"]["available"]
        if not available:
            assert excluded is True, "excluded flag must be True when LSTM unavailable"
        else:
            assert excluded is False, "excluded flag must be False when LSTM available"

    def test_us_currency_symbol_dollar(self):
        """US tickers must use $ as currency symbol."""
        data = self._get_recommendation("AAPL", _US_INFO)
        assert data["market"]["currency_symbol"] == "$"
        assert data["market"]["currency"] == "USD"
        assert data["market"]["is_india"] is False

    def test_india_currency_symbol_rupee(self):
        """Indian tickers must use ₹ as currency symbol."""
        data = self._get_recommendation("RELIANCE.NS", _INDIA_INFO)
        assert data["market"]["currency_symbol"] == "₹"
        assert data["market"]["currency"] == "INR"
        assert data["market"]["is_india"] is True
        assert data["market"]["exchange"] == "NSE"

    def test_india_display_ticker_without_suffix(self):
        """RELIANCE.NS display_ticker should be RELIANCE."""
        data = self._get_recommendation("RELIANCE.NS", _INDIA_INFO)
        assert data["display_ticker"] == "RELIANCE"

    def test_us_display_ticker_unchanged(self):
        """AAPL display_ticker should be AAPL."""
        data = self._get_recommendation("AAPL", _US_INFO)
        assert data["display_ticker"] == "AAPL"

    def test_etf_valuation_not_applicable(self):
        """ETF valuation signal must be 'not_applicable' and is_etf=True."""
        data = self._get_recommendation("NIFTYBEES.NS", _ETF_INFO)
        val = data["valuation"]
        assert val["is_etf"] is True
        assert val["signal"] == "not_applicable"

    def test_etf_valuation_metrics_are_null_not_fabricated(self):
        """P/E, peer P/E, and relative P/E must be null for ETFs end-to-end,
        never a stray number the frontend would have to explain."""
        data = self._get_recommendation("NIFTYBEES.NS", _ETF_INFO)
        val = data["valuation"]
        assert val["pe_ratio"] is None
        assert val["peer_pe"] is None
        assert val["pe_relative_pct"] is None

    def test_etf_category_present_when_name_is_recognisable(self):
        """A recognisable fund name (e.g. containing 'Gold') should surface a
        real etf_category in market info, not a bare 'Unknown'."""
        gold_etf_info = dict(_ETF_INFO, longName="Nippon India ETF Gold BeES")
        data = self._get_recommendation("GOLDBEES.NS", gold_etf_info)
        assert data["market"]["is_etf"] is True
        assert data["market"]["etf_category"] == "Gold ETF"

    def test_etf_category_null_when_genuinely_unclassifiable(self):
        """No category field and an unrecognisable name -> None, never a guess."""
        opaque_etf_info = dict(_ETF_INFO, longName="Opaque Fund IV")
        data = self._get_recommendation("XYZBEES.NS", opaque_etf_info)
        assert data["market"]["is_etf"] is True
        assert data["market"]["etf_category"] is None

    def test_non_etf_has_null_etf_category(self):
        data = self._get_recommendation("AAPL", _US_INFO)
        assert data["market"]["is_etf"] is False
        assert data["market"]["etf_category"] is None

    def test_backtest_has_horizon(self):
        """Backtest must report the correct forecast horizon."""
        data = self._get_recommendation("AAPL", _US_INFO)
        assert data["backtest"]["forecast_horizon_days"] == cfg.FORECAST_HORIZON

    def test_backtest_has_purge_days(self):
        """Backtest purge_period_days must equal PURGE_PERIOD config."""
        data = self._get_recommendation("AAPL", _US_INFO)
        assert data["backtest"]["purge_period_days"] == cfg.PURGE_PERIOD

    def test_disclaimer_present(self):
        """Disclaimer must be a non-empty string."""
        data = self._get_recommendation("AAPL", _US_INFO)
        assert isinstance(data["disclaimer"], str) and len(data["disclaimer"]) > 20

    def test_cache_hit_on_second_call(self):
        """Second call within TTL must return cache.hit=True."""
        import main
        main._cache.clear()

        ohlcv = _make_ohlcv()
        from main import app
        with (
            patch("market.resolve_ticker_with_fallback", return_value="AAPL"),
            patch("yfinance.Ticker", return_value=_make_yf_ticker_mock(ohlcv, _US_INFO)),
        ):
            client = TestClient(app, raise_server_exceptions=True)
            resp1 = client.get("/api/recommend?ticker=AAPL")
            resp2 = client.get("/api/recommend?ticker=AAPL")

        assert resp1.status_code == 200
        assert resp2.status_code == 200
        assert resp2.json()["cache"]["hit"] is True


# ---------------------------------------------------------------------------
# Error handling tests
# ---------------------------------------------------------------------------
class TestAPIErrorHandling:

    @pytest.fixture(autouse=True)
    def clear_cache(self):
        import main
        main._cache.clear()
        yield
        main._cache.clear()

    def test_invalid_ticker_returns_404(self):
        """A ticker with no data must return HTTP 404."""
        from main import app
        with (
            patch("market.resolve_ticker_with_fallback",
                  side_effect=ValueError("No market data found for 'INVALID_XXXX'")),
        ):
            client = TestClient(app, raise_server_exceptions=False)
            resp   = client.get("/api/recommend?ticker=INVALID_XXXX")

        assert resp.status_code == 404

    def test_health_endpoint(self):
        """Health endpoint must return status=ok."""
        from main import app
        client = TestClient(app, raise_server_exceptions=True)
        resp   = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "cached_tickers" in data
        assert "markets" in data

    def test_cache_list_endpoint(self):
        """Cache list endpoint must return a dict."""
        from main import app
        client = TestClient(app, raise_server_exceptions=True)
        resp   = client.get("/api/cache")
        assert resp.status_code == 200
        assert isinstance(resp.json(), dict)

    def test_empty_ticker_returns_404(self):
        """An empty or whitespace ticker query must return HTTP 404 or 422."""
        from main import app
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.get("/api/recommend?ticker=%20%20")
        assert resp.status_code in (400, 404, 422)

    def test_institutional_intelligence_present(self):
        """Institutional intelligence must be structured in recommendation response."""
        from main import app
        ohlcv = _make_ohlcv()
        with (
            patch("market.resolve_ticker_with_fallback", return_value="AAPL"),
            patch("yfinance.Ticker", return_value=_make_yf_ticker_mock(ohlcv, _US_INFO)),
        ):
            client = TestClient(app, raise_server_exceptions=True)
            resp = client.get("/api/recommend?ticker=AAPL")
        
        assert resp.status_code == 200
        data = resp.json()
        assert "institutional_intelligence" in data
        inst = data["institutional_intelligence"]
        assert inst is not None
        assert "analyst_rating" in inst
        assert "target_price" in inst
        assert "revenue_forecast" in inst
        assert "ps_ratio" in inst
        assert "trading_volume_str" in inst
        assert "gross_margin_pct" in inst
