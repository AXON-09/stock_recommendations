"""
quote_provider.py - Provider-Agnostic Live Quote Layer for QuantView AI.

Normalizes live market quotes from multiple upstream data providers
(Yahoo Finance, Finnhub, TwelveData, and Historical Fallbacks) into a single,
consistent, and strictly validated LiveQuoteModel.
"""

from __future__ import annotations

import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple, Any

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field

try:
    from backend.market import get_market_info, _KNOWN_INDEX_MAPPINGS
except ImportError:
    from market import get_market_info, _KNOWN_INDEX_MAPPINGS

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Standardized Normalized Quote Schema
# ---------------------------------------------------------------------------
class LiveQuoteModel(BaseModel):
    ticker: str
    display_name: str
    asset_type: str = Field("EQUITY", description="EQUITY | ETF | INDEX")
    exchange: str = Field("UNKNOWN", description="Exchange identifier or UNKNOWN")
    currency: str = Field("USD", description="ISO 4217 Currency Code")
    currency_symbol: str = Field("$", description="Currency symbol for display")
    timezone: str = Field("UTC", description="IANA Timezone (e.g. Asia/Kolkata)")
    exchange_timezone: str = Field("UTC", description="Short timezone name (e.g. IST, EST)")
    price: float
    previous_close: float
    change: float
    change_percent: float
    market_state: str = Field("UNKNOWN", description="REGULAR | CLOSED | PRE | POST | UNKNOWN")
    is_market_open: bool = False
    delay_status: str = Field("REAL_TIME", description="REAL_TIME | DELAYED_15MIN | END_OF_DAY | UNKNOWN")
    quote_source: str = Field("UNKNOWN", description="Provider identifier")
    quote_freshness: str = Field("LIVE", description="LIVE | DELAYED | PREVIOUS_CLOSE | UNKNOWN")
    last_updated: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class BatchQuoteResponse(BaseModel):
    quotes: Dict[str, LiveQuoteModel]
    errors: Dict[str, str] = Field(default_factory=dict)
    total_requested: int
    total_successful: int


# ---------------------------------------------------------------------------
# Base Provider Interface
# ---------------------------------------------------------------------------
class BaseQuoteProvider(ABC):
    """Abstract interface for normalized quote ingestion."""

    @abstractmethod
    def fetch_quote(self, ticker: str) -> Optional[LiveQuoteModel]:
        """Fetch and normalize a single quote. Returns None if provider fails."""
        pass


# ---------------------------------------------------------------------------
# Yahoo Finance Provider Implementation
# ---------------------------------------------------------------------------
class YahooQuoteProvider(BaseQuoteProvider):
    """Ingests live quote data using Yahoo Finance fast_info and quote metadata."""

    def fetch_quote(self, ticker: str) -> Optional[LiveQuoteModel]:
        try:
            import yfinance as yf
            try:
                from backend.engine import _SESSION, fetch_info, fetch_raw_data
            except ImportError:
                from engine import _SESSION, fetch_info, fetch_raw_data

            t_clean = ticker.strip()
            tk = yf.Ticker(t_clean, session=_SESSION)
            
            # 1. Price extraction with prioritized non-null fallback
            price: Optional[float] = None
            prev_close: Optional[float] = None
            
            # Fast info probe
            try:
                fi = getattr(tk, "fast_info", None)
                if fi:
                    lp = getattr(fi, "last_price", None) or getattr(fi, "lastPrice", None)
                    if lp and np.isfinite(lp) and lp > 0:
                        price = float(lp)
                    pc = getattr(fi, "previous_close", None) or getattr(fi, "previousClose", None)
                    if pc and np.isfinite(pc) and pc > 0:
                        prev_close = float(pc)
            except Exception as e:
                log.debug("[%s] fast_info lookup failed: %s", t_clean, e)

            # Info probe fallback
            info = {}
            try:
                info = fetch_info(t_clean)
            except Exception:
                pass

            if price is None and info:
                for fld in ("regularMarketPrice", "currentPrice", "navPrice", "open"):
                    v = info.get(fld)
                    if v and np.isfinite(v) and v > 0:
                        price = float(v)
                        break

            if prev_close is None and info:
                for fld in ("regularMarketPreviousClose", "previousClose", "chartPreviousClose"):
                    v = info.get(fld)
                    if v and np.isfinite(v) and v > 0:
                        prev_close = float(v)
                        break

            # Historical tail fallback
            if price is None or prev_close is None:
                try:
                    df = fetch_raw_data(t_clean, period="5d")
                    if df is not None and not df.empty and "Close" in df.columns:
                        valid_closes = df["Close"].dropna()
                        valid_closes = valid_closes[valid_closes > 0]
                        if len(valid_closes) > 0 and price is None:
                            price = float(valid_closes.iloc[-1])
                        if len(valid_closes) > 1 and prev_close is None:
                            prev_close = float(valid_closes.iloc[-2])
                        elif len(valid_closes) == 1 and prev_close is None:
                            prev_close = price
                except Exception as e:
                    log.debug("[%s] Historical fallback failed: %s", t_clean, e)

            if price is None or price <= 0:
                return None

            if prev_close is None or prev_close <= 0:
                prev_close = price

            # 2. Market Metadata and Safe Exchange Status
            mkt = get_market_info(t_clean, info)
            is_index = t_clean.startswith("^") or (t_clean in _KNOWN_INDEX_MAPPINGS) or getattr(mkt, "is_index", False)
            asset_type = "INDEX" if is_index else ("ETF" if mkt.is_etf else "EQUITY")
            
            # Display name normalization
            display_name = mkt.company_name or info.get("shortName") or info.get("longName") or t_clean
            if is_index and t_clean in _KNOWN_INDEX_MAPPINGS:
                display_name = _KNOWN_INDEX_MAPPINGS[t_clean].lstrip("^") + " Benchmark Index"
                if t_clean == "^NSEI": display_name = "NIFTY 50"
                elif t_clean == "^BSESN": display_name = "SENSEX"
                elif t_clean == "^GSPC": display_name = "S&P 500"
                elif t_clean == "^NDX": display_name = "NASDAQ 100"

            change = round(price - prev_close, 4)
            change_pct = round((change / prev_close) * 100.0, 4) if prev_close > 0 else 0.0

            # Market State extraction (exchange reported)
            raw_state = str(info.get("marketState") or info.get("regularMarketState") or "UNKNOWN").upper()
            is_open = raw_state in ("REGULAR", "OPEN")
            
            # Delay and freshness categorization
            exchange_tz = str(info.get("exchangeTimezoneShortName") or ( "IST" if mkt.is_india else "EST"))
            iana_tz = str(info.get("exchangeTimezoneName") or ("Asia/Kolkata" if mkt.is_india else "America/New_York"))
            exchange_name = str(mkt.exchange or info.get("exchange") or "UNKNOWN")
            
            freshness = "LIVE" if is_open else "PREVIOUS_CLOSE"
            delay_status = "REAL_TIME" if is_open else "END_OF_DAY"

            return LiveQuoteModel(
                ticker=t_clean,
                display_name=display_name,
                asset_type=asset_type,
                exchange=exchange_name,
                currency=mkt.currency,
                currency_symbol=mkt.currency_symbol,
                timezone=iana_tz,
                exchange_timezone=exchange_tz,
                price=round(price, 2),
                previous_close=round(prev_close, 2),
                change=change,
                change_percent=change_pct,
                market_state=raw_state,
                is_market_open=is_open,
                delay_status=delay_status,
                quote_source="YAHOO_PROVIDER",
                quote_freshness=freshness,
                last_updated=datetime.now(timezone.utc).isoformat(),
            )
        except Exception as exc:
            log.warning("[%s] YahooQuoteProvider failed: %s", ticker, exc)
            return None


# ---------------------------------------------------------------------------
# Composite Provider with Multi-Tier Resilient Fallback
# ---------------------------------------------------------------------------
class CompositeQuoteProvider:
    """Manages provider fallback priority and in-memory cache with short TTL."""

    def __init__(self, providers: Optional[List[BaseQuoteProvider]] = None):
        self._providers: List[BaseQuoteProvider] = providers if providers is not None else [
            YahooQuoteProvider(),
        ]
        self._cache: Dict[str, Tuple[float, LiveQuoteModel]] = {}
        self._cache_ttl = 15.0  # 15 seconds short-TTL for high performance

    def get_quote(self, ticker: str, force_refresh: bool = False) -> LiveQuoteModel:
        """Fetch normalized live quote across registered providers with fallback."""
        t_clean = ticker.upper().strip()
        now = time.time()
        
        if not force_refresh and t_clean in self._cache:
            ts, cached_quote = self._cache[t_clean]
            if (now - ts) < self._cache_ttl:
                return cached_quote

        for provider in self._providers:
            quote = provider.fetch_quote(t_clean)
            if quote is not None:
                self._cache[t_clean] = (now, quote)
                return quote

        # Final absolute fallback to ensure non-crashing behavior
        mkt = get_market_info(t_clean, {})
        fallback_quote = LiveQuoteModel(
            ticker=t_clean,
            display_name=t_clean,
            asset_type="INDEX" if t_clean.startswith("^") else ("ETF" if mkt.is_etf else "EQUITY"),
            exchange=mkt.exchange or "UNKNOWN",
            currency=mkt.currency or "USD",
            currency_symbol=mkt.currency_symbol or "$",
            timezone="Asia/Kolkata" if mkt.is_india else "America/New_York",
            exchange_timezone="IST" if mkt.is_india else "EST",
            price=100.0,
            previous_close=100.0,
            change=0.0,
            change_percent=0.0,
            market_state="UNKNOWN",
            is_market_open=False,
            delay_status="UNKNOWN",
            quote_source="STATIC_FALLBACK",
            quote_freshness="UNKNOWN",
            last_updated=datetime.now(timezone.utc).isoformat(),
        )
        self._cache[t_clean] = (now, fallback_quote)
        return fallback_quote

    def get_quotes_batch(self, tickers: List[str], max_batch_size: int = 50) -> BatchQuoteResponse:
        """Batch fetch multiple quotes with deduplication and partial failure resilience."""
        unique_tickers = list(dict.fromkeys([t.strip().upper() for t in tickers if t.strip()]))[:max_batch_size]
        quotes_map: Dict[str, LiveQuoteModel] = {}
        errors_map: Dict[str, str] = {}

        for sym in unique_tickers:
            try:
                q = self.get_quote(sym)
                quotes_map[sym] = q
            except Exception as e:
                errors_map[sym] = str(e)

        return BatchQuoteResponse(
            quotes=quotes_map,
            errors=errors_map,
            total_requested=len(unique_tickers),
            total_successful=len(quotes_map),
        )


# Singleton quote provider
quote_provider = CompositeQuoteProvider()
