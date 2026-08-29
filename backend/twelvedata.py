"""
twelvedata.py - Twelve Data Integration Client for Institutional & Fundamental Intelligence.

Primary data provider for:
  1. Analyst Consensus & Recommendations
  2. Analyst Target Price
  3. Revenue Forecast & Estimates
  4. P/S Valuation & Statistics
  5. Live Trading Volume
  6. Gross Profit & Revenue Margins

Supports:
  - 🇮🇳 NSE & BSE (India) - formatted in ₹ INR
  - 🇺🇸 US Markets (NYSE, NASDAQ) - formatted in $ USD
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass
from typing import Optional, Dict, Any, Tuple

import requests
import numpy as np

log = logging.getLogger(__name__)

# Twelve Data base URL
TWELVE_DATA_BASE_URL = "https://api.twelvedata.com"

# Cache dictionary: key -> (timestamp, data)
_TD_CACHE: Dict[str, Tuple[float, Any]] = {}
CACHE_TTL_SECONDS = 3600  # 1 hour cache


def get_twelve_data_api_key() -> Optional[str]:
    """Retrieve the Twelve Data API key from environment variables or .env."""
    return (
        os.environ.get("TWELVE_DATA_API_KEY")
        or os.environ.get("TWELVEDATA_API_KEY")
        or os.environ.get("TWELVEDATA_KEY")
        or os.environ.get("TWELVE_DATA_KEY")
    )


def _resolve_twelve_data_params(ticker: str, is_india: bool) -> Tuple[str, Optional[str], str]:
    """
    Resolve ticker into Twelve Data (symbol, exchange, currency_symbol).
    """
    t = ticker.upper().strip()
    
    if t.endswith(".NS"):
        symbol = t[:-3]
        return symbol, "NSE", "₹"
    elif t.endswith(".BO"):
        symbol = t[:-3]
        return symbol, "BSE", "₹"
    elif is_india:
        return t, "NSE", "₹"
    elif t.startswith("^"):
        index_map = {
            "^GSPC": ("SPX", "SNP", "$"),
            "^IXIC": ("IXIC", "NASDAQ", "$"),
            "^DJI": ("DJI", "DJI", "$"),
            "^NSEI": ("NIFTY 50", "NSE", "₹"),
            "^BSESN": ("SENSEX", "BSE", "₹"),
        }
        if t in index_map:
            return index_map[t]
        return t.replace("^", ""), None, "$"
    else:
        clean_symbol = t.split(".")[0]
        return clean_symbol, None, "$"


def _call_twelve_data(endpoint: str, params: Dict[str, Any], api_key: str) -> Optional[Dict[str, Any]]:
    """Execute a request to Twelve Data with caching and error handling."""
    cache_key = f"{endpoint}:{sorted(params.items())}"
    now = time.time()
    
    if cache_key in _TD_CACHE:
        ts, data = _TD_CACHE[cache_key]
        if now - ts < CACHE_TTL_SECONDS:
            return data

    req_params = dict(params)
    req_params["apikey"] = api_key

    url = f"{TWELVE_DATA_BASE_URL}/{endpoint}"
    try:
        r = requests.get(url, params=req_params, timeout=6)
        if r.status_code == 200:
            res = r.json()
            if isinstance(res, dict) and res.get("status") == "error":
                log.info("Twelve Data returned info/error for %s: %s", endpoint, res.get("message"))
                return None
            _TD_CACHE[cache_key] = (now, res)
            return res
        else:
            log.warning("Twelve Data %s returned HTTP %s", endpoint, r.status_code)
            return None
    except Exception as e:
        log.warning("Twelve Data connection error on %s: %s", endpoint, e)
        return None


def fetch_twelve_data_institutional(
    ticker: str,
    is_india: bool,
    volume_ratio: float,
) -> Optional[Dict[str, Any]]:
    """
    Fetch all 6 fundamental & institutional cards from Twelve Data as primary source.
    """
    api_key = get_twelve_data_api_key()
    if not api_key:
        return None

    symbol, exchange, curr_sym = _resolve_twelve_data_params(ticker, is_india)
    base_params = {"symbol": symbol}
    if exchange:
        base_params["exchange"] = exchange

    # 1. Analyst Recommendations
    rec_res = _call_twelve_data("recommendations", base_params, api_key) or _call_twelve_data("analyst_ratings/recommendations", base_params, api_key)
    
    # 2. Target Price
    target_res = _call_twelve_data("price_target", base_params, api_key) or _call_twelve_data("analyst_ratings/price_target", base_params, api_key)
    
    # 3. Statistics (P/S, Market Cap)
    stats_res = _call_twelve_data("statistics", base_params, api_key)
    
    # 4. Income Statement (Gross Profit, Total Revenue)
    income_res = _call_twelve_data("income_statement", base_params, api_key)
    
    # 5. Earnings Estimates (Revenue Forecast)
    earn_res = _call_twelve_data("earnings_estimate", base_params, api_key) or _call_twelve_data("revenue_estimate", base_params, api_key)
    
    # 6. Quote (Live Volume)
    quote_res = _call_twelve_data("quote", base_params, api_key)

    if not any([rec_res, target_res, stats_res, income_res, quote_res]):
        return None

    # Parse 1: Analyst Consensus
    rating_str = "Not Covered"
    rating_score = 50.0
    analyst_count = 0
    if rec_res and isinstance(rec_res, dict):
        trends = rec_res.get("trends") or rec_res.get("recommendations") or []
        if isinstance(trends, list) and len(trends) > 0:
            latest = trends[0] if isinstance(trends[0], dict) else {}
            sb = int(latest.get("strong_buy", 0) or 0)
            b = int(latest.get("buy", 0) or 0)
            h = int(latest.get("hold", 0) or 0)
            s = int(latest.get("sell", 0) or 0)
            ss = int(latest.get("strong_sell", 0) or 0)
            total = sb + b + h + s + ss
            if total > 0:
                analyst_count = total
                weighted_score = (sb * 100.0 + b * 75.0 + h * 50.0 + s * 25.0 + ss * 0.0) / total
                rating_score = round(weighted_score, 1)
                if rating_score >= 80:
                    rating_str = "STRONG BUY"
                elif rating_score >= 60:
                    rating_str = "BUY"
                elif rating_score >= 40:
                    rating_str = "HOLD"
                elif rating_score >= 20:
                    rating_str = "SELL"
                else:
                    rating_str = "STRONG SELL"

    # Parse 2: Target Price
    target_price = None
    target_high = None
    target_low = None
    target_analysts = analyst_count
    if target_res and isinstance(target_res, dict):
        t_mean = target_res.get("target_mean") or target_res.get("target_price") or target_res.get("price_target")
        if t_mean and np.isfinite(float(t_mean)) and float(t_mean) > 0:
            target_price = round(float(t_mean), 2)
        t_high = target_res.get("target_high") or target_res.get("high")
        if t_high and np.isfinite(float(t_high)):
            target_high = round(float(t_high), 2)
        t_low = target_res.get("target_low") or target_res.get("low")
        if t_low and np.isfinite(float(t_low)):
            target_low = round(float(t_low), 2)
        t_count = target_res.get("analysts_count") or target_res.get("number_of_analysts")
        if t_count and int(t_count) > 0:
            target_analysts = int(t_count)

    # Parse 3: Revenue Forecast & Period
    rev_forecast = "N/A"
    rev_period = "Next quarter"
    rev_growth_pct = None
    if earn_res and isinstance(earn_res, dict):
        estimates = earn_res.get("estimates") or earn_res.get("revenue_estimates") or []
        if isinstance(estimates, list) and len(estimates) > 0:
            latest_est = estimates[0]
            rev_growth = latest_est.get("revenue_growth") or latest_est.get("growth")
            period_str = latest_est.get("period") or latest_est.get("date")
            if period_str:
                rev_period = str(period_str)
            if rev_growth is not None and np.isfinite(float(rev_growth)):
                rev_growth_pct = round(float(rev_growth) * 100.0, 2)
                if rev_growth_pct > 1.0:
                    rev_forecast = "↑ Growing"
                elif rev_growth_pct < -1.0:
                    rev_forecast = "↓ Declining"
                else:
                    rev_forecast = "→ Stable"

    # Parse 4: P/S Valuation (Price-to-Sales)
    ps_ratio = None
    val_label = "N/A"
    if stats_res and isinstance(stats_res, dict):
        val_data = stats_res.get("valuations_metrics") or stats_res
        raw_ps = val_data.get("price_to_sales_trailing_12_months") or val_data.get("price_to_sales")
        if raw_ps and np.isfinite(float(raw_ps)) and float(raw_ps) > 0:
            ps_ratio = round(float(raw_ps), 2)
        elif val_data.get("market_capitalization") and val_data.get("revenue"):
            try:
                mcap = float(val_data["market_capitalization"])
                rev = float(val_data["revenue"])
                if rev > 0:
                    ps_ratio = round(mcap / rev, 2)
            except Exception:
                pass

    if ps_ratio is not None:
        if ps_ratio < 3.0:
            val_label = "Low P/S"
        elif ps_ratio < 8.0:
            val_label = "Fair P/S"
        else:
            val_label = "High P/S"

    # Parse 5: Trading Volume (Absolute + Relative)
    live_volume = None
    vol_status = "Normal"
    vol_rat = round(float(volume_ratio), 2) if np.isfinite(volume_ratio) else 1.0
    if vol_rat >= 1.25:
        vol_status = "High"
    elif vol_rat < 0.8:
        vol_status = "Low"

    if quote_res and isinstance(quote_res, dict):
        q_vol = quote_res.get("volume")
        if q_vol and np.isfinite(float(q_vol)) and float(q_vol) > 0:
            live_volume = int(float(q_vol))

    # Parse 6: Gross Profit & Margins
    gross_margin_pct = None
    prof_label = "N/A"
    if income_res and isinstance(income_res, dict):
        inc_list = income_res.get("income_statement") or []
        if isinstance(inc_list, list) and len(inc_list) > 0:
            latest_inc = inc_list[0]
            gp = latest_inc.get("gross_profit")
            rev = latest_inc.get("total_revenue") or latest_inc.get("revenue")
            if gp is not None and rev is not None:
                try:
                    gp_val = float(gp)
                    rev_val = float(rev)
                    if rev_val > 0:
                        gross_margin_pct = round((gp_val / rev_val) * 100.0, 2)
                except Exception:
                    pass

    if gross_margin_pct is not None:
        if gross_margin_pct >= 40.0:
            prof_label = "High Gross Margin"
        elif gross_margin_pct >= 20.0:
            prof_label = "Moderate Gross Margin"
        else:
            prof_label = "Low Gross Margin"

    return {
        "analyst_rating": rating_str,
        "analyst_score": rating_score,
        "analyst_count": analyst_count,
        "target_price": target_price,
        "target_high": target_high,
        "target_low": target_low,
        "target_currency": "INR" if is_india else "USD",
        "currency_symbol": curr_sym,
        "revenue_forecast": rev_forecast,
        "revenue_period": rev_period,
        "revenue_growth_pct": rev_growth_pct,
        "valuation_label": val_label,
        "ps_ratio": ps_ratio,
        "trading_volume": live_volume,
        "volume_status": vol_status,
        "volume_ratio": vol_rat,
        "profitability_label": prof_label,
        "gross_margin_pct": gross_margin_pct,
        "provider": "Twelve Data",
    }
