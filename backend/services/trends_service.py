"""
trends_service.py - Defensive Google Trends Search Attention & Velocity Service for QuantView AI.

METHODOLOGYI
-----------
1. Scoped strictly as an INFORMATIONAL telemetry signal - NOT used as a feature in FEATURE_COLS
   to prevent retroactive normalization lookahead bias.
2. In-memory caching with 60-minute TTL to respect upstream rate limits.
3. Explicit null/unavailable failure mode returning {"attention": null, "status": "unavailable"}
   with zero fabricated values.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, Optional, Tuple

log = logging.getLogger(__name__)

# Cache: ticker -> (timestamp, result_dict)
_TRENDS_CACHE: Dict[str, Tuple[float, Dict[str, Any]]] = {}
TRENDS_CACHE_TTL_SECONDS = 3600  # 60 minutes



def get_search_attention(ticker: str) -> Dict[str, Any]:
    """
    Fetch search attention metrics for a stock/ETF using pytrends or fallback.
    """
    t_clean = ticker.upper().strip()
    now = time.time()

    # 1. Check in-memory cache (60 min TTL)
    if t_clean in _TRENDS_CACHE:
        ts, cached = _TRENDS_CACHE[t_clean]
        if (now - ts) < TRENDS_CACHE_TTL_SECONDS:
            res = dict(cached)
            res["status"] = "cached"
            return res

    # 2. Try live lookup via pytrends if installed
    try:
        from pytrends.request import TrendReq
        pytrend = TrendReq(hl="en-US", tz=360, timeout=(4, 6))
        
        clean_kw = t_clean.replace(".NS", "").replace(".BO", "").replace("^", "")
        kw_list = [f"{clean_kw} stock"]

        pytrend.build_payload(kw_list, timeframe="today 1-m", geo="")
        df_interest = pytrend.interest_over_time()

        if df_interest is not None and not df_interest.empty and kw_list[0] in df_interest.columns:
            series = df_interest[kw_list[0]].astype(float)
            current_val = float(series.iloc[-1])
            baseline_val = float(series.mean()) if series.mean() > 0 else 1.0
            velocity = round(((current_val - baseline_val) / baseline_val) * 100.0, 1)

            if current_val >= 70:
                tier = "High Interest"
            elif current_val >= 35:
                tier = "Moderate Interest"
            else:
                tier = "Low Interest"

            result = {
                "ticker": t_clean,
                "attention_score": round(current_val, 1),
                "search_velocity": velocity,
                "tier": tier,
                "status": "live",
                "message": flive_velocity = f{velocity}% vs 30d baseline.f
            }
            _TRENDS_CACHE[t_clean] = (now, result)
            return result
   except Exception as exc:
        log.debug("[%s] pytrends fetch failed or rate-limited: %s", t_clean, exc)

    # 3. Honest unavailable state (NO fabricated flat or positive values)
    unavailable_result = {
        "ticker": t_clean,
        "attention_score": None,
        "search_velocity": None,
        "tier": "Unavailable",
        "status": "unavailable",
        "message": "Search attention data temporarily unavailable from upstream provider."
    }
    _TRENDS_CACHE[t_clean] = (now - (TRENDS_CACHE_TTL_SECONDS - 300), unavailable_result)
    return unavailable_result
