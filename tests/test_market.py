"""
tests/test_market.py - Unit tests for market.py

Tests:
  - Ticker resolution (US, Indian NSE, Indian BSE, suffix passthrough)
  - Market info extraction from ticker suffix
  - Currency symbol mapping
  - ETF detection
  - resolve_ticker edge cases
"""

import sys
from pathlib import Path
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from market import (
    resolve_ticker,
    get_market_info,
    MarketInfo,
    _KNOWN_NSE_TICKERS,
    _derive_etf_category,
)


# ---------------------------------------------------------------------------
# resolve_ticker tests (no network — heuristics only)
# ---------------------------------------------------------------------------
class TestResolveTicker:

    def test_explicit_ns_suffix_preserved(self):
        """Input with .NS suffix should be returned unchanged (uppercased)."""
        assert resolve_ticker("reliance.ns") == "RELIANCE.NS"
        assert resolve_ticker("RELIANCE.NS") == "RELIANCE.NS"

    def test_explicit_bo_suffix_preserved(self):
        """Input with .BO suffix should be returned unchanged (uppercased)."""
        assert resolve_ticker("reliance.bo") == "RELIANCE.BO"

    def test_other_suffix_preserved(self):
        """Arbitrary suffixes like .L (London) should be preserved."""
        assert resolve_ticker("HSBA.l") == "HSBA.L"

    def test_known_nse_ticker_gets_ns_suffix(self):
        """Known Indian tickers without a suffix should resolve to .NS."""
        for ticker in ["RELIANCE", "TCS", "INFY", "HDFCBANK"]:
            resolved = resolve_ticker(ticker)
            assert resolved.endswith(".NS"), (
                f"{ticker} should resolve to {ticker}.NS, got {resolved}"
            )

    def test_known_nse_ticker_lowercase(self):
        """Known Indian tickers in lowercase should still resolve correctly."""
        assert resolve_ticker("reliance") == "RELIANCE.NS"
        assert resolve_ticker("tcs")      == "TCS.NS"

    def test_us_ticker_unchanged(self):
        """Unknown bare symbols (US stocks) should be returned as-is (uppercase)."""
        assert resolve_ticker("AAPL")  == "AAPL"
        assert resolve_ticker("tsla")  == "TSLA"
        assert resolve_ticker("SPY")   == "SPY"
        assert resolve_ticker("nvda")  == "NVDA"

    def test_empty_ticker_raises(self):
        with pytest.raises(ValueError, match="cannot be empty"):
            resolve_ticker("")

    def test_whitespace_only_raises(self):
        with pytest.raises(ValueError, match="cannot be empty"):
            resolve_ticker("   ")

    def test_niftybees_known_nse(self):
        """NIFTYBEES is in the known NSE set."""
        assert resolve_ticker("NIFTYBEES") == "NIFTYBEES.NS"


# ---------------------------------------------------------------------------
# get_market_info tests (no network — uses ticker suffix)
# ---------------------------------------------------------------------------
class TestGetMarketInfo:

    def _info(self, quote_type="EQUITY"):
        return {"quoteType": quote_type, "currency": "INR", "exchange": "NSI"}

    def test_ns_suffix_detected_as_nse_india(self):
        info = get_market_info("RELIANCE.NS", {"quoteType": "EQUITY"})
        assert info.country == "India"
        assert info.exchange == "NSE"
        assert info.currency == "INR"
        assert info.currency_symbol == "₹"
        assert info.is_india is True
        assert info.is_etf is False

    def test_bo_suffix_detected_as_bse_india(self):
        info = get_market_info("RELIANCE.BO", {"quoteType": "EQUITY"})
        assert info.country == "India"
        assert info.exchange == "BSE"
        assert info.currency == "INR"
        assert info.is_india is True

    def test_us_ticker_defaults_to_usd(self):
        info = get_market_info("AAPL", {"quoteType": "EQUITY", "currency": "USD", "exchange": "NMS"})
        assert info.currency == "USD"
        assert info.currency_symbol == "$"
        assert info.is_india is False

    def test_etf_detected_from_quote_type(self):
        info = get_market_info("RELIANCE.NS", {"quoteType": "ETF"})
        assert info.is_etf is True

    def test_mutual_fund_detected(self):
        info = get_market_info("RELIANCE.NS", {"quoteType": "MUTUALFUND"})
        assert info.is_etf is True

    def test_equity_is_not_etf(self):
        info = get_market_info("AAPL", {"quoteType": "EQUITY", "currency": "USD"})
        assert info.is_etf is False

    def test_us_nasdaq_exchange_mapping(self):
        info = get_market_info("AAPL", {"quoteType": "EQUITY", "currency": "USD", "exchange": "NMS"})
        assert info.exchange == "NASDAQ"

    def test_us_nyse_exchange_mapping(self):
        info = get_market_info("SPY", {"quoteType": "ETF", "currency": "USD", "exchange": "NYQ"})
        assert info.exchange == "NYSE"

    def test_currency_symbol_euro(self):
        info = get_market_info("SIE.DE", {"quoteType": "EQUITY", "currency": "EUR", "exchange": "XETRA"})
        assert info.currency_symbol == "€"

    def test_currency_symbol_gbp(self):
        info = get_market_info("HSBA.L", {"quoteType": "EQUITY", "currency": "GBP", "exchange": "LSE"})
        assert info.currency_symbol == "£"

    def test_unknown_currency_has_fallback_symbol(self):
        info = get_market_info("UNKNOWN.X", {"quoteType": "EQUITY", "currency": "ZZZ", "exchange": "X"})
        # Falls back to "<currency> " format
        assert "ZZZ" in info.currency_symbol


# ---------------------------------------------------------------------------
# Market info dataclass immutability
# ---------------------------------------------------------------------------
class TestMarketInfoImmutability:

    def test_frozen_dataclass(self):
        info = MarketInfo(
            country="India", exchange="NSE",
            currency="INR", currency_symbol="₹",
            is_india=True, is_etf=False,
        )
        with pytest.raises(Exception):
            info.country = "US"   # frozen=True should raise


# ---------------------------------------------------------------------------
# Known NSE ticker set sanity
# ---------------------------------------------------------------------------
class TestKnownNSESet:

    def test_major_bluechips_present(self):
        for ticker in ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK"]:
            assert ticker in _KNOWN_NSE_TICKERS, f"{ticker} should be in known NSE set"

    def test_us_tickers_absent(self):
        for ticker in ["AAPL", "TSLA", "SPY", "MSFT", "AMZN"]:
            assert ticker not in _KNOWN_NSE_TICKERS, f"{ticker} should NOT be in NSE set"


# ---------------------------------------------------------------------------
# ETF category classification (never fabricates the underlying asset)
# ---------------------------------------------------------------------------
class TestETFCategory:

    def test_uses_yfinance_category_field_when_present(self):
        """A real 'category' field from yfinance is trusted directly."""
        info = get_market_info("GOLDBEES.NS", {"quoteType": "ETF", "category": "Commodities Focused"})
        assert info.etf_category == "Commodities Focused"

    def test_falls_back_to_name_keyword_for_gold_etf(self):
        """No 'category' field, but the fund's own name says 'Gold' -> Gold ETF."""
        info = get_market_info("GOLDBEES.NS", {"quoteType": "ETF", "longName": "Nippon India ETF Gold BeES"})
        assert info.etf_category == "Gold ETF"

    def test_falls_back_to_name_keyword_for_nifty_index_etf(self):
        info = get_market_info("NIFTYBEES.NS", {"quoteType": "ETF", "longName": "Nippon India ETF Nifty 50 BeES"})
        assert "Nifty 50" in info.etf_category

    def test_no_category_and_no_recognisable_name_is_none(self):
        """Genuinely insufficient metadata -> None, never a guessed label."""
        info = get_market_info("XYZBEES.NS", {"quoteType": "ETF", "longName": "Some Unrecognised Fund"})
        assert info.etf_category is None

    def test_generic_unknown_category_value_is_not_trusted_verbatim(self):
        """yfinance sometimes reports category as 'Unknown' — that's not usable, fall through to name matching."""
        info = get_market_info("GOLDBEES.NS", {"quoteType": "ETF", "category": "Unknown", "longName": "Gold BeES ETF"})
        assert info.etf_category == "Gold ETF"

    def test_non_etf_has_no_category(self):
        info = get_market_info("RELIANCE.NS", {"quoteType": "EQUITY"})
        assert info.etf_category is None

    def test_derive_etf_category_never_fabricates_holdings(self):
        """A fund with an opaque name and no category field should get None, not a guess."""
        assert _derive_etf_category({"quoteType": "ETF", "longName": "Acme Structured Fund IV"}) is None
