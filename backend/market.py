"""
market.py - Market detection, ticker resolution, and peer valuation.

Supports:
  🇮🇳  NSE (suffix .NS), BSE (suffix .BO)
  🇺🇸  US markets (no suffix, or explicit .US-style)
  🌐  Other international tickers with explicit suffixes

Key public API
--------------
  resolve_ticker(user_input)      → resolved Yahoo Finance ticker string
  get_market_info(ticker, info)   → MarketInfo dataclass
  get_peer_pe(sector, market)     → Optional[float] — sector/peer median P/E
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import numpy as np
import requests
import yfinance as yf

log = logging.getLogger(__name__)

# Shared browser-like session to avoid Yahoo Finance 429/401 blocks on cloud IPs
_SESSION = requests.Session()
_SESSION.headers.update({
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like"
        " Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
})

# In-memory cache for peer median P/Es to avoid repeated network calls
_PEER_PE_CACHE: dict[str, Optional[float]] = {}

# ---------------------------------------------------------------------------
# Market metadata
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class MarketInfo:
    country:         str
    exchange:        str
    currency:        str
    currency_symbol: str
    is_india:        bool
    is_etf:          bool
    etf_category:    Optional[str] = None
    """
    Short human-readable ETF/fund category, e.g. "Gold ETF", "Broad Market
    Index ETF". Derived from yfinance metadata (category / longName /
    quoteType) — never fabricated. None for non-ETFs, or when yfinance
    doesn't supply enough metadata to classify the fund.
    """


# ---------------------------------------------------------------------------
# Well-known Indian tickers (bare symbols without suffix)
# These are probed as <SYMBOL>.NS first.
# ---------------------------------------------------------------------------
_KNOWN_NSE_TICKERS: frozenset = frozenset({
    "RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "SBIN",
    "AXISBANK", "LT", "ITC", "BHARTIARTL", "HINDUNILVR", "BAJFINANCE",
    "KOTAKBANK", "ASIANPAINT", "NESTLEIND", "WIPRO", "HCLTECH",
    "TECHM", "SUNPHARMA", "DRREDDY", "CIPLA", "DIVISLAB",
    "ADANIENT", "ADANIPORTS", "ULTRACEMCO", "TITAN", "EICHERMOT",
    "MARUTI", "M&M", "BAJAJ-AUTO", "JSWSTEEL", "TATASTEEL",
    "COALINDIA", "POWERGRID", "NTPC", "ONGC", "BPCL",
    "GRASIM", "TATAMOTORS", "INDUSINDBK", "HDFC", "HEROMOTOCO",
    # ETFs
    "NIFTYBEES", "BANKBEES", "JUNIORBEES", "GOLDBEES", "ICICIB22",
    "LIQUIDBEES", "CPSEETF", "BHARAT22ETF", "MOM100", "MOM50",
})

_INDIAN_SUFFIXES: frozenset = frozenset({".NS", ".BO"})

# US sector ETFs for peer P/E (US market only)
_US_SECTOR_ETFS: dict = {
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

# Indian sector peer universe for median P/E estimation
# Keys match yfinance sector strings for Indian companies.
INDIA_SECTOR_PEERS: dict = {
    "Technology": [
        "TCS.NS", "INFY.NS", "HCLTECH.NS", "WIPRO.NS", "TECHM.NS",
    ],
    "Financial Services": [
        "HDFCBANK.NS", "ICICIBANK.NS", "SBIN.NS", "AXISBANK.NS",
        "KOTAKBANK.NS", "INDUSINDBK.NS", "BAJFINANCE.NS",
    ],
    "Energy": [
        "RELIANCE.NS", "ONGC.NS", "BPCL.NS", "IOC.NS",
    ],
    "Healthcare": [
        "SUNPHARMA.NS", "DRREDDY.NS", "CIPLA.NS", "DIVISLAB.NS", "APOLLOHOSP.NS",
    ],
    "Consumer Defensive": [
        "HINDUNILVR.NS", "NESTLEIND.NS", "BRITANNIA.NS", "DABUR.NS",
    ],
    "Consumer Cyclical": [
        "MARUTI.NS", "TATAMOTORS.NS", "M&M.NS", "EICHERMOT.NS",
    ],
    "Industrials": [
        "LT.NS", "ADANIPORTS.NS", "SIEMENS.NS", "ABB.NS",
    ],
    "Materials": [
        "JSWSTEEL.NS", "TATASTEEL.NS", "HINDALCO.NS", "COALINDIA.NS",
    ],
    "Communication Services": [
        "BHARTIARTL.NS", "ITC.NS",
    ],
    "Utilities": [
        "POWERGRID.NS", "NTPC.NS", "TATAPOWER.NS",
    ],
    "Real Estate": [
        "DLF.NS", "GODREJPROP.NS", "PRESTIGE.NS",
    ],
}

# Known US ticker sector fallbacks
_US_KNOWN_SECTORS: dict[str, str] = {
    "AAPL": "Technology", "MSFT": "Technology", "NVDA": "Technology",
    "AVGO": "Technology", "ORCL": "Technology", "CSCO": "Technology",
    "AMZN": "Consumer Cyclical", "TSLA": "Consumer Cyclical", "HD": "Consumer Cyclical",
    "GOOG": "Communication Services", "GOOGL": "Communication Services", "META": "Communication Services", "NFLX": "Communication Services",
    "JNJ": "Healthcare", "UNH": "Healthcare", "PFE": "Healthcare", "LLY": "Healthcare", "ABBV": "Healthcare",
    "JPM": "Financial Services", "BAC": "Financial Services", "WFC": "Financial Services", "V": "Financial Services", "MA": "Financial Services",
    "XOM": "Energy", "CVX": "Energy", "COP": "Energy", "SLB": "Energy",
    "PG": "Consumer Defensive", "KO": "Consumer Defensive", "PEP": "Consumer Defensive", "WMT": "Consumer Defensive", "COST": "Consumer Defensive",
    "CAT": "Industrials", "GE": "Industrials", "HON": "Industrials", "UNP": "Industrials", "BA": "Industrials",
    "NEE": "Utilities", "DUK": "Utilities", "SO": "Utilities",
    "LIN": "Materials", "APD": "Materials", "SHW": "Materials",
    "PLD": "Real Estate", "AMT": "Real Estate", "EQIX": "Real Estate",
}

def lookup_sector_fallback(ticker: str) -> Optional[str]:
    """Return known sector when Yahoo Finance metadata is throttled or missing."""
    t_clean = ticker.upper().strip()
    # Check Indian sectors
    for sector, peers in INDIA_SECTOR_PEERS.items():
        for p in peers:
            if t_clean == p.upper() or t_clean == p.split(".")[0].upper() or t_clean.startswith(p.split(".")[0].upper()):
                return sector
    # Check US sectors
    base = t_clean.split(".")[0]
    if base in _US_KNOWN_SECTORS:
        return _US_KNOWN_SECTORS[base]
    return None



# ---------------------------------------------------------------------------
# Ticker resolution
# ---------------------------------------------------------------------------
def resolve_ticker(user_input: str) -> str:
    """
    Resolve a user-supplied ticker string to a valid Yahoo Finance symbol.

    Resolution rules
    ----------------
    1. If the input already has a known suffix (.NS, .BO, .L, .AX, etc.),
       use it directly — no modification.
    2. If the bare symbol matches a known NSE name (case-insensitive),
       try <SYMBOL>.NS first.  Fall back to .BO if .NS returns no data.
    3. Otherwise (likely a US ticker), use the bare symbol.

    The function does NOT make any network requests; it applies heuristics
    only.  Actual data availability is verified by fetch_raw_data().

    Returns
    -------
    str — Yahoo Finance ticker symbol to use.

    Raises
    ------
    ValueError — if the input is empty or clearly malformed.
    """
    raw = user_input.strip()
    if not raw:
        raise ValueError("Ticker symbol cannot be empty.")

    # Normalise: uppercase the symbol, preserve suffix case (.NS not .ns)
    # Strategy: split on the last dot
    if "." in raw:
        parts   = raw.rsplit(".", 1)
        symbol  = parts[0].upper()
        suffix  = "." + parts[1].upper()
        return symbol + suffix

    # No suffix — apply heuristics
    symbol = raw.upper()

    # Known Indian NSE tickers → try .NS
    if symbol in _KNOWN_NSE_TICKERS:
        log.debug("resolve_ticker: %s → %s.NS (known NSE)", raw, symbol)
        return f"{symbol}.NS"

    # Fall back: return as-is (US or other market)
    log.debug("resolve_ticker: %s → %s (assumed US/global)", raw, symbol)
    return symbol


def resolve_ticker_with_fallback(user_input: str) -> str:
    """
    Like resolve_ticker(), but also attempts to validate the resolved ticker
    by doing a lightweight yfinance probe.  If the primary resolution returns
    no data and the symbol looks Indian, also tries the .BO suffix.

    This makes one (or rarely two) network calls — only use for the initial
    request, not for every downstream call.

    Returns
    -------
    str — validated Yahoo Finance ticker.

    Raises
    ------
    ValueError — if no data could be found for any attempted symbol.
    """
    candidate = resolve_ticker(user_input)

    # Quick probe
    if _has_data(candidate):
        return candidate

    # If we tried .NS and it failed, try .BO
    if candidate.endswith(".NS"):
        bo_candidate = candidate[:-3] + ".BO"
        log.info("resolve_ticker_with_fallback: %s failed, trying %s", candidate, bo_candidate)
        if _has_data(bo_candidate):
            return bo_candidate

    # If we didn't try any suffix yet and it looks like an Indian ticker
    raw_upper = user_input.strip().upper()
    if not any(candidate.endswith(s) for s in _INDIAN_SUFFIXES):
        # Check if there's data with .NS
        ns_candidate = raw_upper + ".NS"
        if _has_data(ns_candidate):
            log.info("resolve_ticker_with_fallback: %s → %s (probed .NS)", user_input, ns_candidate)
            return ns_candidate

    if not _has_data(candidate):
        raise ValueError(
            f"No market data found for '{user_input}'. "
            "Please verify the ticker symbol. "
            "For Indian stocks, try adding .NS (e.g. RELIANCE.NS) or .BO (e.g. RELIANCE.BO)."
        )

    return candidate


def _has_data(ticker: str) -> bool:
    """Quick probe: return True if Yahoo Finance has at least 5 rows of data."""
    try:
        df = yf.Ticker(ticker).history(period="5d")
        return df is not None and not df.empty and len(df) >= 1
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Market info extraction
# ---------------------------------------------------------------------------
def get_market_info(ticker: str, yf_info: dict) -> MarketInfo:
    """
    Derive structured market metadata from the ticker symbol and yfinance info.

    Priority
    --------
    1. Explicit suffix (.NS → NSE/INR, .BO → BSE/INR)
    2. yfinance `currency` and `exchange` fields
    3. Sensible US defaults

    Parameters
    ----------
    ticker   : resolved Yahoo Finance ticker (e.g. "RELIANCE.NS" or "AAPL")
    yf_info  : dict from yf.Ticker(ticker).info

    Returns
    -------
    MarketInfo dataclass
    """
    ticker_upper = ticker.upper()
    quote_type   = str(yf_info.get("quoteType", "")).upper()
    is_etf       = quote_type in {"ETF", "MUTUALFUND"}
    etf_category = _derive_etf_category(yf_info) if is_etf else None

    # ── Indian markets ────────────────────────────────────────────────────
    if ticker_upper.endswith(".NS"):
        return MarketInfo(
            country="India", exchange="NSE",
            currency="INR", currency_symbol="₹",
            is_india=True, is_etf=is_etf, etf_category=etf_category,
        )
    if ticker_upper.endswith(".BO"):
        return MarketInfo(
            country="India", exchange="BSE",
            currency="INR", currency_symbol="₹",
            is_india=True, is_etf=is_etf, etf_category=etf_category,
        )

    # ── Derive from yfinance metadata ─────────────────────────────────────
    currency    = str(yf_info.get("currency", "USD") or "USD").upper()
    exchange_yf = str(yf_info.get("exchange", "") or "").upper()
    full_exch   = str(yf_info.get("fullExchangeName", "") or "")

    # Currency → symbol
    CURRENCY_SYMBOLS: dict = {
        "USD": "$", "EUR": "€", "GBP": "£", "INR": "₹",
        "JPY": "¥", "CAD": "C$", "AUD": "A$", "HKD": "HK$",
        "SGD": "S$", "CHF": "Fr", "CNY": "¥",
    }
    currency_symbol = CURRENCY_SYMBOLS.get(currency, currency + " ")

    # Exchange name cleanup
    EXCHANGE_NAMES: dict = {
        "NMS": "NASDAQ", "NGM": "NASDAQ", "NCM": "NASDAQ",
        "NYQ": "NYSE", "NYA": "NYSE",
        "PCX": "NYSE Arca",
        "BTS": "CBOE",
        "LSE": "LSE", "LON": "LSE",
    }
    exchange = EXCHANGE_NAMES.get(exchange_yf, full_exch or exchange_yf or "Unknown")

    # Country from currency/exchange heuristics
    CURRENCY_COUNTRY: dict = {
        "USD": "United States", "EUR": "Europe",
        "GBP": "United Kingdom", "INR": "India",
        "JPY": "Japan", "CAD": "Canada",
        "AUD": "Australia", "HKD": "Hong Kong",
        "SGD": "Singapore", "CHF": "Switzerland",
        "CNY": "China",
    }
    country = CURRENCY_COUNTRY.get(currency, "Global")

    return MarketInfo(
        country=country, exchange=exchange,
        currency=currency, currency_symbol=currency_symbol,
        is_india=(currency == "INR"),
        is_etf=is_etf, etf_category=etf_category,
    )


# ---------------------------------------------------------------------------
# ETF category classification (never fabricates the underlying asset)
# ---------------------------------------------------------------------------
# Keyword → category, checked against the fund's own name as reported by
# Yahoo Finance. This only *labels* what the fund's own name already says
# about itself (e.g. a fund literally named "Gold BeES" is labelled a
# "Gold ETF") — it never infers holdings that aren't stated.
_ETF_NAME_KEYWORDS: list = [
    ("GOLD",        "Gold ETF"),
    ("SILVER",      "Silver ETF"),
    ("NIFTY BANK",  "Banking Index ETF"),
    ("BANK",        "Banking Sector ETF"),
    ("NIFTY 50",    "Broad Market Index ETF (Nifty 50)"),
    ("NIFTY",       "Index ETF"),
    ("SENSEX",      "Broad Market Index ETF (Sensex)"),
    ("LIQUID",      "Liquid / Money Market ETF"),
    ("JUNIOR",      "Index ETF (Nifty Next 50)"),
    ("PSU",         "PSU / Public Sector ETF"),
    ("CPSE",        "PSU / Public Sector ETF"),
    ("BOND",        "Bond ETF"),
    ("S&P 500",     "Broad Market Index ETF (S&P 500)"),
    ("NASDAQ",      "Index ETF (Nasdaq)"),
    ("DIVIDEND",    "Dividend / Income ETF"),
    ("MOMENTUM",    "Factor / Momentum ETF"),
]


def _derive_etf_category(yf_info: dict) -> Optional[str]:
    """
    Best-effort ETF/fund category label. Never fabricates the underlying
    asset — only uses fields Yahoo Finance itself reports.

    Priority
    --------
    1. yfinance's own `category` field (e.g. "Commodities Focused",
       "India Equity"), when present and non-generic.
    2. Keyword match against the fund's own reported name (longName /
       shortName) — this only restates what the fund calls itself.
    3. None — if neither source gives a confident label, leave it unset
       rather than guessing.
    """
    raw_category = str(yf_info.get("category", "") or "").strip()
    if raw_category and raw_category.lower() not in {"n/a", "unknown", "none"}:
        return raw_category

    name = str(yf_info.get("longName", "") or yf_info.get("shortName", "") or "").upper()
    if name:
        for keyword, label in _ETF_NAME_KEYWORDS:
            if keyword in name:
                return label

    return None


# ---------------------------------------------------------------------------
# Peer / sector P/E lookup  (market-aware)
# ---------------------------------------------------------------------------
def get_peer_pe(sector: str, market: MarketInfo) -> Optional[float]:
    """
    Return an approximate sector/peer median P/E ratio.

    For Indian stocks
    -----------------
    Fetches trailing P/E from a curated peer list (INDIA_SECTOR_PEERS)
    and returns the median of available values.

    For US stocks
    -------------
    Fetches the sector ETF's reported trailing/forward P/E.

    For ETFs or unknown sectors
    ---------------------------
    Returns None.

    IMPORTANT: This is a LIVE snapshot, NOT a point-in-time historical value.
    Do not use as an ML training feature.
    """
    if market.is_etf:
        return None

    if market.is_india:
        return _india_peer_pe(sector)
    else:
        return _us_sector_pe(sector)


def _get_crumb() -> Optional[str]:
    try:
        _SESSION.get("https://fc.yahoo.com", allow_redirects=True, timeout=3)
        r = _SESSION.get("https://query2.finance.yahoo.com/v1/test/getcrumb", timeout=3)
        if r.status_code == 200 and r.text and not r.text.startswith("{"):
            return r.text.strip()
    except Exception:
        pass
    return None


def _india_peer_pe(sector: str) -> Optional[float]:
    """Median trailing P/E from the Indian peer universe for a given sector."""
    if sector in _PEER_PE_CACHE:
        return _PEER_PE_CACHE[sector]

    peers = INDIA_SECTOR_PEERS.get(sector)
    if not peers:
        _PEER_PE_CACHE[sector] = None
        return None

    pe_values: list[float] = []

    # Batch fetch in 1 single HTTP request using crumb
    crumb = _get_crumb()
    symbols_str = ",".join(peers)
    url = f"https://query2.finance.yahoo.com/v7/finance/quote?symbols={symbols_str}"
    if crumb:
        url += f"&crumb={crumb}"
    try:
        r = _SESSION.get(url, timeout=4)
        if r.status_code == 200:
            results = r.json().get("quoteResponse", {}).get("result", [])
            for q in results:
                pe = q.get("trailingPE") or q.get("forwardPE")
                if not pe and q.get("epsTrailingTwelveMonths") and q.get("regularMarketPrice"):
                    eps = q["epsTrailingTwelveMonths"]
                    price = q["regularMarketPrice"]
                    if eps and eps > 0 and price and price > 0:
                        pe = price / eps
                if pe and np.isfinite(pe) and 0 < pe < 500:
                    pe_values.append(float(pe))
    except Exception:
        pass

    if not pe_values:
        # Fallback default sector median approximations if Yahoo rate limits
        _SECTOR_DEFAULTS = {
            "Technology": 28.0,
            "Financial Services": 18.0,
            "Energy": 14.0,
            "Healthcare": 32.0,
            "Consumer Defensive": 42.0,
            "Consumer Cyclical": 30.0,
            "Basic Materials": 15.0,
            "Industrials": 25.0,
            "Utilities": 16.0,
            "Communication Services": 22.0,
        }
        val = _SECTOR_DEFAULTS.get(sector)
        _PEER_PE_CACHE[sector] = val
        return val

    median_pe = float(np.median(pe_values))
    _PEER_PE_CACHE[sector] = median_pe
    log.debug(
        "_india_peer_pe: sector='%s' peers_found=%d median_pe=%.1f",
        sector, len(pe_values), median_pe,
    )
    return median_pe


def _us_sector_pe(sector: str) -> Optional[float]:
    """Sector ETF P/E for US stocks."""
    if sector in _PEER_PE_CACHE:
        return _PEER_PE_CACHE[sector]

    etf = _US_SECTOR_ETFS.get(sector)
    if not etf:
        _PEER_PE_CACHE[sector] = None
        return None

    crumb = _get_crumb()
    url = f"https://query2.finance.yahoo.com/v7/finance/quote?symbols={etf}"
    if crumb:
        url += f"&crumb={crumb}"
    try:
        r = _SESSION.get(url, timeout=4)
        if r.status_code == 200:
            results = r.json().get("quoteResponse", {}).get("result", [])
            if results:
                q = results[0]
                val = q.get("trailingPE") or q.get("forwardPE")
                if val and np.isfinite(val) and 0 < val < 500:
                    res = float(val)
                    _PEER_PE_CACHE[sector] = res
                    return res
        _PEER_PE_CACHE[sector] = None
        return None
    except Exception:
        _PEER_PE_CACHE[sector] = None
        return None


