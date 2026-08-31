"""
test_quote_provider.py - Tests for normalized live quote provider layer.
"""

import pytest
from fastapi.testclient import TestClient
from quote_provider import (
    LiveQuoteModel,
    BatchQuoteResponse,
    YahooQuoteProvider,
    CompositeQuoteProvider,
    quote_provider,
)
import main


@pytest.fixture
def client():
    return TestClient(main.app)


class TestQuoteProviderEngine:
    def test_live_quote_model_validation(self):
        q = LiveQuoteModel(
            ticker="AAPL",
            display_name="Apple Inc.",
            asset_type="EQUITY",
            exchange="NASDAQ",
            currency="USD",
            currency_symbol="$",
            timezone="America/New_York",
            exchange_timezone="EST",
            price=225.50,
            previous_close=224.00,
            change=1.50,
            change_percent=0.67,
            market_state="REGULAR",
            is_market_open=True,
            delay_status="REAL_TIME",
            quote_source="YAHOO_FAST_INFO",
            quote_freshness="LIVE",
        )
        assert q.ticker == "AAPL"
        assert q.price == 225.50
        assert q.is_market_open is True

    def test_quote_provider_batch_deduplication(self):
        provider = CompositeQuoteProvider([YahooQuoteProvider()])
        batch = provider.get_quotes_batch(["AAPL", "AAPL", "MSFT"])
        assert len(batch.quotes) <= 2
        assert "AAPL" in batch.quotes

    def test_batch_quote_max_cap_guard(self):
        provider = CompositeQuoteProvider([YahooQuoteProvider()])
        tickers = [f"SYM_{i}" for i in range(60)]
        batch = provider.get_quotes_batch(tickers, max_batch_size=50)
        assert len(batch.quotes) + len(batch.errors) <= 50

    def test_single_live_quote_api_endpoint(self, client):
        resp = client.get("/api/quote/live?ticker=AAPL")
        assert resp.status_code == 200
        data = resp.json()
        assert "ticker" in data
        assert "price" in data
        assert "currency_symbol" in data
        assert data["price"] > 0

    def test_batch_live_quotes_api_endpoint(self, client):
        resp = client.get("/api/quotes/live?tickers=AAPL,MSFT,^NSEI")
        assert resp.status_code == 200
        data = resp.json()
        assert "quotes" in data
        assert "AAPL" in data["quotes"] or "^NSEI" in data["quotes"]

    def test_watchlist_uses_normalized_quotes(self, client):
        resp = client.get("/api/watchlist/live")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert "items" in data
        assert len(data["items"]) > 0
        first = data["items"][0]
        assert "price" in first
        assert "change" in first
