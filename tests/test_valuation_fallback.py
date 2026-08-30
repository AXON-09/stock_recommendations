"""
Unit tests for Finnhub + FMP Valuation Fallback Service
"""

import os
import pytest
import numpy as np
from unittest.mock import patch, MagicMock
from services.valuation_fallback import (
    fetch_valuation_fallback,
    fetch_finnhub_peers,
    fetch_fmp_metrics,
    _clean_symbol,
    _FALLBACK_CACHE,
)


def test_clean_symbol():
    assert _clean_symbol("AAPL") == "AAPL"
    assert _clean_symbol("RELIANCE.NS") == "RELIANCE"
    assert _clean_symbol("^BSESN") == "BSESN"
    assert _clean_symbol("TCS.BO") == "TCS"


def test_fallback_with_existing_values():
    _FALLBACK_CACHE.clear()
    res = fetch_valuation_fallback(
        ticker="AAPL",
        sector="Technology",
        current_pe=28.5,
        current_peer_pe=25.0,
        current_pb=8.2,
    )
    assert res["pe_ratio"] == 28.5
    assert res["peer_pe"] == 25.0
    assert res["pb_ratio"] == 8.2
    assert res["pe_relative_pct"] == pytest.approx(14.0, 0.1)
    assert res["signal"] == "fair"


def test_fallback_fmp_mock_metrics():
    _FALLBACK_CACHE.clear()
    mock_ratios = [
        {
            "peRatioTTM": 32.4,
            "priceToBookRatioTTM": 12.5,
            "pegRatioTTM": 1.8,
            "returnOnEquityTTM": 0.45,
        }
    ]

    with patch("services.valuation_fallback._SESSION.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = mock_ratios
        mock_get.return_value = mock_resp

        metrics = fetch_fmp_metrics("MSFT", "mock_fmp_key")
        assert metrics["pe_ratio"] == 32.4
        assert metrics["pb_ratio"] == 12.5
        assert metrics["peg_ratio"] == 1.8
        assert metrics["roe"] == 0.45


def test_fallback_peer_calculation():
    _FALLBACK_CACHE.clear()
    # Peers: AAPL, GOOGL, NVDA with P/Es: 30, 24, 45 -> Median: 30
    with patch("services.valuation_fallback.fetch_finnhub_peers", return_value=["GOOGL", "NVDA"]):
        with patch("services.valuation_fallback.fetch_fmp_metrics") as mock_fmp:
            def side_effect(sym, key):
                if sym == "GOOGL":
                    return {"pe_ratio": 24.0}
                elif sym == "NVDA":
                    return {"pe_ratio": 46.0}
                return {}
            mock_fmp.side_effect = side_effect

            with patch.dict(os.environ, {"FINNHUB_API_KEY": "test", "FMP_API_KEY": "test"}):
                res = fetch_valuation_fallback(
                    ticker="MSFT",
                    sector="Technology",
                    current_pe=35.0,
                    current_peer_pe=None,
                    current_pb=10.0,
                )
                assert res["pe_ratio"] == 35.0
                assert res["peer_pe"] == 35.0  # Median of 24 and 46 is 35.0
                assert res["pe_relative_pct"] == pytest.approx(0.0, 0.1)


def test_fallback_graceful_on_missing_keys():
    _FALLBACK_CACHE.clear()
    with patch.dict(os.environ, {}, clear=True):
        res = fetch_valuation_fallback(
            ticker="UNKNOWN",
            sector="Unknown",
            current_pe=None,
            current_peer_pe=None,
            current_pb=None,
        )
        assert res["pe_ratio"] is None
        assert res["peer_pe"] is None
        assert res["signal"] == "unavailable"
