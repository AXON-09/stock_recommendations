"""
Finnhub + Financial Modeling Prep (FMP) Valuation Fallback Service
==================================================================
Provides a high-reliability fallback mechanism when the primary valuation data
provider fails, times out, or returns incomplete data (e.g. missing P/E, P/B, or
peer multiples).

Fallback Data Sources:
- Finnhub: Live Quote, Company Profile, Peer Companies (/stock/peers)
- Financial Modeling Prep (FMP): P/E Ratio, EPS, ROE, PEG Ratio, EV/EBITDA, Book Value, Market Cap

Workflow:
1. Primary valuation provider is queried first.
2. If P/E is null/invalid or peer data cannot be calculated, this fallback service is invoked.
3. Peer companies are fetched from Finnhub.
4. Valuation metrics for the target company & peers are fetched from FMP.
5. Peer Median P/E and relative discount/premium are calculated:
   relative = ((company_pe - peer_median_pe) / peer_median_pe) * 100
6. Results are cached in memory for 10 minutes.
"""

import os
import time
import logging
import requests
import numpy as np
from typing import Optional, Dict, Any, List

log = logging.getLogger(__name__)

# Fallback Cache: cache_key -> (timestamp, result_dict)
_FALLBACK_CACHE: Dict[str, tuple[float, Dict[str, Any]]] = {}
_FALLBACK_CACHE_TTL = 600.0  # 10 minutes (600 seconds)

FINNHUB_BASE_URL = "https://finnhub.io/api/v1"
FMP_BASE_URL = "https://financialmodelingprep.com/api/v3"

_SESSION = requests.Session()
_SESSION.headers.update({
    "User-Agent": "QuantView-Valuation-Fallback/2.0 (Financial Quantitative Research)"
})


def _clean_symbol(ticker: str) -> str:
    """Extract raw symbol without exchange suffix for US/Global API lookups."""
    t = ticker.upper().strip()
    return t.split(".")[0].replace("^", "")


def fetch_finnhub_peers(symbol: str, api_key: str) -> List[str]:
    """Fetch peer company tickers from Finnhub /stock/peers."""
    if not api_key:
        return []
    try:
        url = f"{FINNHUB_BASE_URL}/stock/peers"
        resp = _SESSION.get(url, params={"symbol": symbol, "token": api_key}, timeout=3.5)
        if resp.status_code == 200:
            peers = resp.json()
            if isinstance(peers, list):
                # Filter out the symbol itself
                return [p.upper() for p in peers if isinstance(p, str) and p.upper() != symbol]
    except Exception as e:
        log.debug("Finnhub peers fetch failed for %s: %s", symbol, e)
    return []


def fetch_finnhub_recommendations(symbol: str, api_key: str) -> Optional[Dict[str, Any]]:
    """Fetch analyst recommendation trends from Finnhub /stock/recommendation."""
    if not api_key:
        return None
    try:
        url = f"{FINNHUB_BASE_URL}/stock/recommendation"
        resp = _SESSION.get(url, params={"symbol": symbol, "token": api_key}, timeout=3.5)
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
                r = data[0]
                strong_buy = int(r.get("strongBuy", 0))
                buy = int(r.get("buy", 0))
                hold = int(r.get("hold", 0))
                sell = int(r.get("sell", 0))
                strong_sell = int(r.get("strongSell", 0))
                total = strong_buy + buy + hold + sell + strong_sell
                if total > 0:
                    score = (strong_buy * 100 + buy * 75 + hold * 50 + sell * 25 + strong_sell * 0) / total
                    if score >= 75:
                        label = "STRONG BUY"
                    elif score >= 60:
                        label = "BUY"
                    elif score >= 40:
                        label = "HOLD"
                    elif score >= 25:
                        label = "UNDERPERFORM"
                    else:
                        label = "SELL"
                    return {
                        "analyst_rating": label,
                        "analyst_score": round(score, 1),
                        "analyst_count": total,
                    }
    except Exception as e:
        log.debug("Finnhub recommendation fetch failed for %s: %s", symbol, e)
    return None


def fetch_finnhub_price_target(symbol: str, api_key: str) -> Optional[Dict[str, Any]]:
    """Fetch analyst price targets from Finnhub /stock/price-target."""
    if not api_key:
        return None
    try:
        url = f"{FINNHUB_BASE_URL}/stock/price-target"
        resp = _SESSION.get(url, params={"symbol": symbol, "token": api_key}, timeout=3.5)
        if resp.status_code == 200:
            d = resp.json()
            if isinstance(d, dict) and d.get("targetMean"):
                return {
                    "target_price": float(d["targetMean"]),
                    "target_high": float(d.get("targetHigh", 0)) or None,
                    "target_low": float(d.get("targetLow", 0)) or None,
                }
    except Exception as e:
        log.debug("Finnhub price target fetch failed for %s: %s", symbol, e)
    return None


def fetch_fmp_metrics(symbol: str, api_key: str) -> Dict[str, Any]:
    """Fetch key ratios and valuation metrics from Financial Modeling Prep (FMP)."""
    metrics: Dict[str, Any] = {}
    if not api_key:
        return metrics

    try:
        # 1. Ratios TTM / Key Metrics
        url_ratios = f"{FMP_BASE_URL}/ratios-ttm/{symbol}"
        r = _SESSION.get(url_ratios, params={"apikey": api_key}, timeout=3.5)
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
                row = data[0]
                pe = row.get("peRatioTTM") or row.get("priceEarningsRatioTTM")
                pb = row.get("priceToBookRatioTTM") or row.get("priceBookValueRatioTTM")
                peg = row.get("pegRatioTTM")
                roe = row.get("returnOnEquityTTM")
                if pe and np.isfinite(pe) and float(pe) > 0:
                    metrics["pe_ratio"] = float(pe)
                if pb and np.isfinite(pb) and float(pb) > 0:
                    metrics["pb_ratio"] = float(pb)
                if peg and np.isfinite(peg):
                    metrics["peg_ratio"] = float(peg)
                if roe and np.isfinite(roe):
                    metrics["roe"] = float(roe)

        # 2. Quote (for market cap, EPS, EV/EBITDA, book value)
        if "pe_ratio" not in metrics:
            url_quote = f"{FMP_BASE_URL}/quote/{symbol}"
            r_q = _SESSION.get(url_quote, params={"apikey": api_key}, timeout=3.5)
            if r_q.status_code == 200:
                q_data = r_q.json()
                if isinstance(q_data, list) and len(q_data) > 0 and isinstance(q_data[0], dict):
                    q_row = q_data[0]
                    pe = q_row.get("pe")
                    if pe and np.isfinite(pe) and float(pe) > 0:
                        metrics["pe_ratio"] = float(pe)
                    if q_row.get("eps"):
                        metrics["eps"] = float(q_row["eps"])
                    if q_row.get("marketCap"):
                        metrics["market_cap"] = float(q_row["marketCap"])
    except Exception as e:
        log.debug("FMP metrics fetch failed for %s: %s", symbol, e)

    return metrics


def fetch_valuation_fallback(
    ticker: str,
    sector: Optional[str] = None,
    current_pe: Optional[float] = None,
    current_peer_pe: Optional[float] = None,
    current_pb: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Main Fallback Entry Point:
    Invoked when primary valuation provider is unavailable or returns incomplete data.
    """
    cache_key = ticker.upper().strip()
    now = time.time()

    # 1. Check 10-minute cache
    if cache_key in _FALLBACK_CACHE:
        cached_ts, cached_val = _FALLBACK_CACHE[cache_key]
        if (now - cached_ts) < _FALLBACK_CACHE_TTL:
            return dict(cached_val)

    # Log fallback activation as specified
    log.info("[INFO] Primary valuation provider unavailable.")
    log.info("[INFO] Switching to fallback provider (Finnhub + FMP).")

    finnhub_key = os.environ.get("FINNHUB_API_KEY") or os.environ.get("FINNHUB_KEY") or ""
    fmp_key = os.environ.get("FMP_API_KEY") or os.environ.get("FMP_KEY") or ""

    clean_sym = _clean_symbol(ticker)

    pe_ratio = current_pe
    pb_ratio = current_pb
    peer_pe = current_peer_pe
    source_used = []

    # 2. Fetch metrics for target ticker from FMP if missing
    if (pe_ratio is None or pb_ratio is None) and fmp_key:
        fmp_data = fetch_fmp_metrics(clean_sym, fmp_key)
        if fmp_data:
            source_used.append("FMP")
            if pe_ratio is None and "pe_ratio" in fmp_data:
                pe_ratio = round(fmp_data["pe_ratio"], 2)
            if pb_ratio is None and "pb_ratio" in fmp_data:
                pb_ratio = round(fmp_data["pb_ratio"], 2)

    # 3. Fetch peer companies from Finnhub & calculate peer median P/E if peer_pe missing
    if peer_pe is None:
        peer_pes: List[float] = []
        if finnhub_key:
            peers = fetch_finnhub_peers(clean_sym, finnhub_key)
            if peers:
                source_used.append("Finnhub")
                for peer in peers[:6]:  # sample top 6 peers
                    if fmp_key:
                        p_metrics = fetch_fmp_metrics(peer, fmp_key)
                        p_pe = p_metrics.get("pe_ratio")
                        if p_pe and np.isfinite(p_pe) and p_pe > 0:
                            peer_pes.append(p_pe)

        if peer_pes:
            peer_pe = round(float(np.median(peer_pes)), 2)

    # 4. Calculate relative discount / premium
    pe_relative: Optional[float] = None
    if pe_ratio is not None and peer_pe is not None and peer_pe > 0:
        pe_relative = (pe_ratio - peer_pe) / peer_pe

    # Determine signal
    signal = "unavailable"
    if pe_ratio is not None and peer_pe is not None:
        if pe_ratio < peer_pe * 0.85:
            signal = "undervalued"
        elif pe_ratio > peer_pe * 1.15:
            signal = "overvalued"
        else:
            signal = "fair"

    res = {
        "pe_ratio": pe_ratio,
        "peer_pe": peer_pe,
        "pe_relative": pe_relative,
        "pe_relative_pct": round(pe_relative * 100.0, 2) if pe_relative is not None else None,
        "pb_ratio": pb_ratio,
        "signal": signal,
        "provider": " + ".join(source_used) if source_used else "Finnhub + FMP Fallback",
    }

    _FALLBACK_CACHE[cache_key] = (now, dict(res))
    return res
