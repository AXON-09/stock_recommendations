"""
tests/test_features.py - Unit tests for feature engineering.

Tests:
- RSI calculation correctness
- ATR calculation
- Volatility-adjusted RSI thresholds
- Regime detection
- Confidence score components
- Recommendation thresholds
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

import config as cfg
from engine import (
    AssetFeatures,
    compute_indicators,
    detect_regime,
    volatility_adjusted_rsi_thresholds,
)
from market import MarketInfo
from models import StockRecommender, ConfidenceComponents, LSTMResult, _trend_signal


# ---------------------------------------------------------------------------
# Helper: synthetic OHLCV DataFrame
# ---------------------------------------------------------------------------
def _make_ohlcv(n: int = 300, seed: int = 42) -> pd.DataFrame:
    np.random.seed(seed)
    close  = 100 * np.cumprod(1 + np.random.normal(0, 0.01, n))
    high   = close * (1 + np.abs(np.random.normal(0, 0.005, n)))
    low    = close * (1 - np.abs(np.random.normal(0, 0.005, n)))
    open_  = close * (1 + np.random.normal(0, 0.003, n))
    volume = np.random.randint(1_000_000, 10_000_000, n).astype(float)
    idx    = pd.date_range("2020-01-01", periods=n, freq="B")
    return pd.DataFrame(
        {"Open": open_, "High": high, "Low": low, "Close": close, "Volume": volume},
        index=idx,
    )


# ---------------------------------------------------------------------------
# RSI tests
# ---------------------------------------------------------------------------
class TestRSI:

    def test_rsi_bounds(self):
        df = compute_indicators(_make_ohlcv())
        rsi = df["rsi"].dropna()
        assert (rsi >= 0).all() and (rsi <= 100).all(), "RSI must be in [0, 100]"

    def test_rsi_rising_market(self):
        """In a strongly rising market RSI should be high (> 50)."""
        np.random.seed(0)
        n     = 250
        # Uptrend with meaningful noise to ensure some losing days (avg_loss > 0)
        # so the RSI formula has a valid denominator.
        trend = np.arange(n, dtype=float) * 0.5
        noise = np.random.normal(0, 0.3, n)   # std=0.3 > daily step, ensures losing days
        close = 100 + trend + noise
        high  = close + 0.4
        low   = close - 0.4
        idx   = pd.date_range("2020-01-01", periods=n, freq="B")
        df    = pd.DataFrame({
            "Open": close - 0.1, "High": high,
            "Low": low, "Close": close,
            "Volume": np.ones(n) * 1e6,
        }, index=idx)
        out      = compute_indicators(df)
        rsi_vals = out["rsi"].dropna()
        assert len(rsi_vals) > 0, "RSI should not be all-NaN (losing days must be present)"
        assert rsi_vals.iloc[-1] > 55, (
            f"RSI should be high in a strong uptrend, got {rsi_vals.iloc[-1]:.1f}. "
            "Check that the trend signal dominates noise."
        )

    def test_rsi_falling_market(self):
        """In a strongly falling market RSI should be low (< 40)."""
        n     = 250
        close = 200 - np.arange(n, dtype=float) * 0.5
        high  = close + 0.3
        low   = close - 0.3
        idx   = pd.date_range("2020-01-01", periods=n, freq="B")
        df    = pd.DataFrame({
            "Open": close + 0.1, "High": high,
            "Low": low, "Close": close,
            "Volume": np.ones(n) * 1e6,
        }, index=idx)
        out = compute_indicators(df)
        assert out["rsi"].dropna().iloc[-1] < 40, "RSI should be low in a downtrend"


# ---------------------------------------------------------------------------
# ATR tests
# ---------------------------------------------------------------------------
class TestATR:

    def test_atr_positive(self):
        df = compute_indicators(_make_ohlcv())
        atr = df["atr"].dropna()
        assert (atr > 0).all(), "ATR must always be positive"

    def test_atr_pct_in_range(self):
        df = compute_indicators(_make_ohlcv())
        atr_pct = df["atr_pct"].dropna()
        # For a typical stock, ATR% should be between 0.1% and 10%
        assert (atr_pct > 0.001).all() and (atr_pct < 0.20).all()


# ---------------------------------------------------------------------------
# SMA tests
# ---------------------------------------------------------------------------
class TestSMAs:

    def test_sma50_less_than_200_warmup(self):
        """SMA200 should be NaN for the first 199 rows."""
        df  = compute_indicators(_make_ohlcv(300))
        assert df["sma200"].iloc[:199].isna().all()

    def test_sma200_approximately_mean(self):
        """SMA200 at row 200 should equal the mean of the first 200 closes."""
        df    = _make_ohlcv(300)
        out   = compute_indicators(df)
        idx   = 199
        expected = df["Close"].iloc[: idx + 1].mean()
        actual   = out["sma200"].iloc[idx]
        assert abs(actual - expected) < 1e-6


# ---------------------------------------------------------------------------
# Volatility-adjusted RSI threshold tests
# ---------------------------------------------------------------------------
class TestVolatilityRSI:

    def test_high_vol_widens_band(self):
        """High-volatility asset should have a wider RSI band."""
        buy_lo, sell_lo = volatility_adjusted_rsi_thresholds(0.005)   # ~8% ann vol
        buy_hi, sell_hi = volatility_adjusted_rsi_thresholds(0.03)    # ~48% ann vol
        assert buy_hi < buy_lo,   "Higher vol → lower buy threshold (wider band)"
        assert sell_hi > sell_lo, "Higher vol → higher sell threshold (wider band)"

    def test_thresholds_bounded(self):
        """Thresholds must never exceed their hard bounds regardless of input."""
        for std in [0.0, 0.001, 0.05, 0.5, 10.0]:
            buy, sell = volatility_adjusted_rsi_thresholds(std)
            assert 15.0 <= buy  <= 45.0, f"Buy threshold {buy} out of [15, 45]"
            assert 55.0 <= sell <= 85.0, f"Sell threshold {sell} out of [55, 85]"

    def test_baseline_vol_no_adjustment(self):
        """At RSI_VOL_BASELINE (10% ann vol) adjustment should be ~0."""
        std_baseline = cfg.RSI_VOL_BASELINE / np.sqrt(252)
        buy, sell = volatility_adjusted_rsi_thresholds(std_baseline)
        assert abs(buy  - cfg.RSI_BASE_BUY)  < 2.0
        assert abs(sell - cfg.RSI_BASE_SELL) < 2.0


# ---------------------------------------------------------------------------
# Regime detection tests
# ---------------------------------------------------------------------------
class TestRegimeDetection:

    def test_trending_up(self):
        regime, strength = detect_regime(
            adx=35, adx_pos=30, adx_neg=10,
            price_vs_sma200=0.05, sma200_slope=0.002
        )
        assert regime == "trending_up"
        assert 0 < strength <= 1

    def test_trending_down(self):
        regime, strength = detect_regime(
            adx=35, adx_pos=10, adx_neg=30,
            price_vs_sma200=-0.05, sma200_slope=-0.002
        )
        assert regime == "trending_down"
        assert 0 < strength <= 1

    def test_choppy_low_adx(self):
        regime, strength = detect_regime(
            adx=15, adx_pos=12, adx_neg=10,
            price_vs_sma200=0.01, sma200_slope=0.0
        )
        assert regime == "choppy"

    def test_choppy_conflicting_signals(self):
        """High ADX but conflicting direction signals → choppy."""
        regime, _ = detect_regime(
            adx=30, adx_pos=28, adx_neg=5,   # +DI dominant
            price_vs_sma200=-0.03,             # but price below SMA200
            sma200_slope=0.0                   # and flat slope
        )
        assert regime == "choppy"

    def test_strength_at_zero_adx(self):
        _, strength = detect_regime(0, 0, 0, 0, 0)
        assert strength == 1.0, "At ADX=0, choppy regime should have max clarity"

    def test_strength_saturates(self):
        _, strength = detect_regime(
            adx=100, adx_pos=80, adx_neg=10,
            price_vs_sma200=0.1, sma200_slope=0.01
        )
        assert strength <= 1.0


# ---------------------------------------------------------------------------
# Trend signal tests (regression test for the bull_votes bug)
# ---------------------------------------------------------------------------
def _make_features(price_vs_sma50=0.0, price_vs_sma200=0.0, sma200_slope=0.0) -> AssetFeatures:
    """Build a minimal AssetFeatures snapshot with only the trend-relevant
    fields varied; everything else is a neutral/benign placeholder."""
    return AssetFeatures(
        ticker="TEST", display_ticker="TEST", price=100.0, sector="Technology",
        market=MarketInfo(
            country="United States", exchange="NASDAQ", currency="USD",
            currency_symbol="$", is_india=False, is_etf=False,
        ),
        atr=1.0, atr_pct=0.01, rolling_std_20=0.01, ann_vol=0.16,
        sma50=100.0, sma200=100.0,
        price_vs_sma50=price_vs_sma50, price_vs_sma200=price_vs_sma200,
        sma200_slope=sma200_slope,
        macd=0.0, macd_signal=0.0, macd_diff=0.0,
        rsi=50.0, rsi_adj_buy_threshold=30.0, rsi_adj_sell_threshold=70.0,
        momentum_20d=0.0, momentum_20d_normalized=0.0,
        adx=20.0, adx_pos=20.0, adx_neg=20.0,
        regime="choppy", regime_strength=0.5,
        pe_ratio=None, peer_pe=None, pe_relative=None, pb_ratio=None,
        bb_upper=105.0, bb_lower=95.0, bb_pct=0.5,
        volume_ratio=1.0, data_completeness=1.0,
    )


class TestTrendSignal:
    """
    Regression tests for the bull_votes classification bug.

    The original implementation was:
        if bull_votes >= 2: return "bullish"
        if bull_votes <= 1: return "bearish"
        return "neutral"
    Since bull_votes in {0,1,2,3}, the first two branches are exhaustive
    and "neutral" could never be reached. These tests prove all three
    states are genuinely reachable with the fixed (unanimous-vote) logic.
    """

    def test_all_three_votes_bullish_is_bullish(self):
        f = _make_features(price_vs_sma50=0.05, price_vs_sma200=0.05, sma200_slope=0.01)
        assert _trend_signal(f) == "bullish"

    def test_all_three_votes_bearish_is_bearish(self):
        f = _make_features(price_vs_sma50=-0.05, price_vs_sma200=-0.05, sma200_slope=-0.01)
        assert _trend_signal(f) == "bearish"

    def test_split_two_bullish_one_bearish_is_neutral(self):
        f = _make_features(price_vs_sma50=0.05, price_vs_sma200=0.05, sma200_slope=-0.01)
        assert _trend_signal(f) == "neutral"

    def test_split_one_bullish_two_bearish_is_neutral(self):
        f = _make_features(price_vs_sma50=0.05, price_vs_sma200=-0.05, sma200_slope=-0.01)
        assert _trend_signal(f) == "neutral"

    def test_neutral_is_reachable(self):
        """Direct regression check: neutral must be a genuinely reachable state."""
        reachable = set()
        for a in (0.05, -0.05):
            for b in (0.05, -0.05):
                for c in (0.01, -0.01):
                    reachable.add(_trend_signal(_make_features(a, b, c)))
        assert reachable == {"bullish", "bearish", "neutral"}, (
            f"Expected all three trend states reachable, got {reachable}"
        )


# ---------------------------------------------------------------------------
# Recommendation threshold tests
# ---------------------------------------------------------------------------
class TestRecommendationThresholds:

    def _make_result(self, ens_p: float) -> str:
        """Apply recommendation logic from config."""
        if   ens_p >= cfg.BUY_THRESHOLD:  return "Buy"
        elif ens_p <= cfg.SELL_THRESHOLD: return "Sell"
        else:                             return "Hold"

    def test_buy_at_threshold(self):
        assert self._make_result(cfg.BUY_THRESHOLD) == "Buy"

    def test_buy_just_above_threshold(self):
        assert self._make_result(cfg.BUY_THRESHOLD + 0.001) == "Buy"

    def test_hold_just_below_buy_threshold(self):
        assert self._make_result(cfg.BUY_THRESHOLD - 0.001) == "Hold"

    def test_sell_at_threshold(self):
        assert self._make_result(cfg.SELL_THRESHOLD) == "Sell"

    def test_sell_just_below_threshold(self):
        assert self._make_result(cfg.SELL_THRESHOLD - 0.001) == "Sell"

    def test_hold_just_above_sell_threshold(self):
        assert self._make_result(cfg.SELL_THRESHOLD + 0.001) == "Hold"

    def test_hold_in_middle(self):
        mid = (cfg.BUY_THRESHOLD + cfg.SELL_THRESHOLD) / 2
        assert self._make_result(mid) == "Hold"

    def test_buy_above_threshold(self):
        assert self._make_result(0.99) == "Buy"

    def test_sell_below_threshold(self):
        assert self._make_result(0.01) == "Sell"


# ---------------------------------------------------------------------------
# Confidence score tests
# ---------------------------------------------------------------------------
class TestConfidenceScore:

    def test_weights_sum_to_one(self):
        total = (
            cfg.CONF_WEIGHT_BOUNDARY +
            cfg.CONF_WEIGHT_VOLATILITY +
            cfg.CONF_WEIGHT_DATA_QUALITY +
            cfg.CONF_WEIGHT_REGIME +
            cfg.CONF_WEIGHT_AGREEMENT
        )
        assert abs(total - 1.0) < 1e-9, f"Weights sum to {total}, expected 1.0"

    def test_confidence_bounds(self):
        """Confidence must always be in [5, 95]."""
        # Simulate extreme inputs
        for prob_strength in [0.0, 0.5, 1.0]:
            for vol in [0.0, 0.5, 1.0]:
                for data_q in [0.0, 1.0]:
                    raw = (
                        prob_strength * cfg.CONF_WEIGHT_BOUNDARY  +
                        vol           * cfg.CONF_WEIGHT_VOLATILITY +
                        data_q        * cfg.CONF_WEIGHT_DATA_QUALITY +
                        0.5           * cfg.CONF_WEIGHT_REGIME     +
                        0.5           * cfg.CONF_WEIGHT_AGREEMENT
                    )
                    confidence = float(np.clip(raw * 100, 5, 95))
                    assert 5 <= confidence <= 95

    def test_high_prob_distance_increases_confidence(self):
        """Larger distance from 0.5 → higher confidence (all else equal)."""
        def conf(prob_strength):
            raw = (
                prob_strength * cfg.CONF_WEIGHT_BOUNDARY  +
                0.5           * cfg.CONF_WEIGHT_VOLATILITY +
                1.0           * cfg.CONF_WEIGHT_DATA_QUALITY +
                0.5           * cfg.CONF_WEIGHT_REGIME     +
                1.0           * cfg.CONF_WEIGHT_AGREEMENT
            )
            return float(np.clip(raw * 100, 5, 95))

        assert conf(0.8) > conf(0.2)

    def test_all_components_normalised(self):
        """All non-None confidence components must be in [0, 1]."""
        comps = ConfidenceComponents(
            probability_strength=0.7,
            volatility=0.5,
            data_quality=1.0,
            regime_clarity=0.8,
            model_agreement=0.9,
        )
        for field_name, val in vars(comps).items():
            if val is not None:
                assert 0.0 <= val <= 1.0, f"Component {field_name}={val} out of [0, 1]"

    def test_model_agreement_can_be_none(self):
        """model_agreement must be None when LSTM is unavailable."""
        comps = ConfidenceComponents(
            probability_strength=0.7,
            volatility=0.5,
            data_quality=1.0,
            regime_clarity=0.8,
            model_agreement=None,
        )
        assert comps.model_agreement is None

    def test_lstm_result_unavailable(self):
        """LSTMResult.probability must be None (not 0.5) when unavailable."""
        lr = LSTMResult(available=False, probability=None, reason="PyTorch unavailable")
        assert lr.probability is None, "LSTM probability must be None, never a fake value like 0.5"
        assert not lr.available
